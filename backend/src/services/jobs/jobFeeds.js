const db = require("../../config/db");
const claude = require("../ai/anthropic");
const logoPrefetch = require("../logos/logoPrefetch");
const dev = require("../shared/devMode");
const { eachLimited } = require("../shared/eachLimited");
const techmap = require("./techmap");
const { PROVIDERS, fetchData, fetchPostings, sleep } = require("./boardProviders");
const { boardsIn, prettyName } = require("./boardLinks");
const { FEED_AREAS, FEED_REGIONS, areaScore, countryCode, inFeedRegions, tidyLocation } = require("./locations");
const { boardIn, boardMoveSet, canMove, inStates } = require("./jobStates");

const REFRESH_HOURS = 12;
const DISCOVERY_HOURS = 72;
const DISCOVERY_QUERIES = 10;
// The sites Claude's web search looks on for boards, from the systems' entries
const DISCOVERY_SITES = Object.values(PROVIDERS).map((entry) => entry.discoverySite).filter(Boolean);
const TECHMAP_HOURS = 24;
// A search refreshes the feeds itself only when the background refresh (every 3 hours) hasn't run for this long
const SEARCH_REFRESH_HOURS = 3;
const RETRY_DAYS = 30;
const MAX_BOARDS_PER_REFRESH = 300;
const DETAILS_LIMIT = 40;
const MAX_AGE_DAYS = 90;
const MAX_LINK = 500;
const AGGREGATOR_UNSEEN_DAYS = 14;
const SEEN_DAYS = 7;
const JSEARCH_HOURS = 24;
const JSEARCH_MAX_QUERIES = Math.max(1, Number(process.env.JSEARCH_MAX_QUERIES) || 5);
const JSEARCH_GAP_MS = 1500;
const JSEARCH_RETRY_HOURS = 1;
// Hours between fetches for the systems that wait longer than REFRESH_HOURS: JSearch's quota, and providers that set their own
const SLOWER_REFRESH = {
  ...Object.fromEntries(Object.entries(PROVIDERS).flatMap(([name, provider]) => (provider.refreshHours ? [[name, provider.refreshHours]] : []))),
  jsearch: JSEARCH_HOURS
};
const TRACKING_PARAMS = /^(utm_\w+|trk|trkInfo|refId|trackingId|src|source|ref|referrer|lipi|position|pageNum|from|tk|vjk|gclid|fbclid)$/i;
const MAX_FAILURES = 3;
const CONCURRENCY = 12;
const DETAILS_CONCURRENCY = 4;
const DESCRIPTION_LIMIT = 6000;
const LOCK_KEY = 73_514_201;
const ENTRY_WORDS = /\b(junior|jr|entry|graduate|intern|internship|student)\b/i;

// Removes tracking parameters and the hash from a URL
function cleanUrl(value) {
  try {
    const url = new URL(value);
    [...url.searchParams.keys()].filter((key) => TRACKING_PARAMS.test(key)).forEach((key) => url.searchParams.delete(key));
    url.hash = "";

    return url.toString();
  } catch {
    return value;
  }
}

// Checks whether JSearch can be called
function jsearchEnabled() {
  return !dev.offline && Boolean(process.env.JSEARCH_API_KEY);
}

// Saves new job boards in one statement, leaving ones already known as they are
async function addBoards(boards, source) {
  if (boards.length === 0) {
    return;
  }

  await db.query(
    `INSERT INTO job_boards (provider, token, company, source)
     SELECT x.provider, x.token, x.company, $4 FROM UNNEST($1::text[], $2::text[], $3::text[]) AS x(provider, token, company)
     ON CONFLICT (provider, LOWER(token)) DO NOTHING`,
    [boards.map((board) => board.provider), boards.map((board) => board.token), boards.map((board) => board.company || prettyName(board.token)), source]
  );
}

// Adds job boards found in users' application and job links
async function harvestUserBoards() {
  const { rows } = await db.query(
    `SELECT job_url AS url FROM applications WHERE job_url IS NOT NULL
     UNION SELECT url FROM jobs WHERE url IS NOT NULL AND source = 'manual'`
  );
  await addBoards(boardsIn(rows.map((row) => row.url).join("\n")), "user");
}

// Fetches the descriptions that a board's list leaves out, for postings not yet stored with one
async function addDetails(provider, board, postings) {
  const { rows } = await db.query(
    `SELECT external_id FROM job_postings WHERE board_id = $1 AND description <> ''`,
    [board.id]
  );
  const stored = new Set(rows.map((row) => row.external_id));
  const missing = postings
    .filter((job) => !job.description && !stored.has(String(job.externalId).slice(0, 200)))
    .slice(0, DETAILS_LIMIT);

  await eachLimited(missing, DETAILS_CONCURRENCY, async (job) => {
    try {
      const { data } = await fetchData(provider.details.url(job, board), provider.details.options);

      if (data) {
        job.description = provider.details.parse(data);
      }
    } catch {
      // The description stays empty and is fetched on the next refresh
    }
  });
}

/* Gives postings with no location the board's usual place, when most of its located postings are in the wanted areas.
   Company boards often leave the location out of a posting in the same office as the rest */
function fillLocations(jobs, areas) {
  const located = jobs.filter((job) => job.location);
  const wanted = located.filter((job) => !/^\s*remote\s*$/i.test(job.location) && areaScore(job.location, areas) > 0);

  if (wanted.length === 0 || wanted.length * 2 < located.length) {
    return jobs;
  }

  const tally = new Map();
  wanted.forEach((job) => tally.set(job.location, (tally.get(job.location) || 0) + 1));
  const usual = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];

  return jobs.map((job) => (job.location || job.workplace === "Remote" ? job : { ...job, location: usual }));
}

// Removes found jobs whose postings closed
async function removeClosedJobs(urls) {
  if (urls.length === 0) {
    return 0;
  }

  const removed = await db.query(
    `DELETE FROM jobs WHERE source = 'search' AND ${canMove("close")} AND url = ANY($1::text[])`,
    [urls]
  );

  return removed.rowCount;
}

// Removes postings that are too old or no longer listed, and the jobs that go with them
async function removeOldPostings() {
  await db.query(
    `DELETE FROM job_postings WHERE COALESCE(posted_at, first_seen_at) < NOW() - make_interval(days => $1)`,
    [MAX_AGE_DAYS]
  );
  await db.query(
    `DELETE FROM job_postings WHERE seen_at < NOW() - make_interval(days => $1)`,
    [AGGREGATOR_UNSEEN_DAYS]
  );
  await db.query(
    `DELETE FROM closed_postings WHERE closed_at < NOW() - make_interval(days => $1)`,
    [MAX_AGE_DAYS]
  );
  /* Untouched found jobs go with their postings. A dismissed job goes too, but only once its posting is gone from the
     feed (a posting seen again gets a new first-seen date), so a search can't bring it back. Hand-added jobs stay
     until the user acts on them */
  const removed = await db.query(
    `DELETE FROM jobs
     WHERE ${canMove("expire")} AND (source = 'search' OR ${inStates(["dismissed"])})
       AND COALESCE(posted_at, created_at) < NOW() - make_interval(days => $1)
       AND NOT (${inStates(["dismissed"])} AND EXISTS (SELECT 1 FROM job_postings p WHERE p.url = jobs.url))`,
    [MAX_AGE_DAYS]
  );

  return removed.rowCount;
}

// Returns the URLs already known to be closed
async function knownClosed(urls) {
  const { rows } = await db.query(`SELECT url FROM closed_postings WHERE url = ANY($1::text[])`, [urls]);

  return new Set(rows.map((row) => row.url));
}

// Records closed posting URLs
async function markClosed(urls) {
  if (urls.length === 0) {
    return;
  }

  await db.query(
    `INSERT INTO closed_postings (url) SELECT UNNEST($1::text[]) ON CONFLICT (url) DO NOTHING`,
    [urls]
  );
  await db.query(`DELETE FROM job_postings WHERE url = ANY($1::text[])`, [urls]);
  await removeClosedJobs(urls);
}

// Checks whether a posting is older than the maximum age
function isTooOld(postedAt) {
  return Boolean(postedAt) && new Date(postedAt) < new Date(Date.now() - MAX_AGE_DAYS * 86_400_000);
}

// Fetches a board's postings and stores them
async function refreshBoard(board, areas = null) {
  const provider = PROVIDERS[board.provider];
  const startedAt = new Date();

  try {
    const { gone, jobs } = await fetchPostings(provider, board, areas);

    if (gone && provider.aggregator) {
      throw new Error("HTTP 404");
    }

    if (gone) {
      await db.query(`UPDATE job_boards SET ${boardMoveSet("vanish")}, last_fetched_at = NOW() WHERE id = $1`, [board.id]);
      const closed = await db.query(`DELETE FROM job_postings WHERE board_id = $1 RETURNING url`, [board.id]);
      await removeClosedJobs(closed.rows.map((row) => row.url));

      return 0;
    }

    const tidied = jobs
      .filter((job) => job.externalId && job.title && /^https?:\/\//.test(job.url || ""))
      .map((job) => {
        const tidy = tidyLocation(job.location);

        return { ...job, url: cleanUrl(job.url), location: tidy.location, workplace: job.workplace || tidy.workplace };
      })
      .filter((job) => job.url.length <= MAX_LINK);
    const open = areas && !provider.aggregator ? fillLocations(tidied, areas) : tidied;
    const openIds = open.map((job) => String(job.externalId).slice(0, 200));
    const closedUrls = provider.aggregator ? await knownClosed(open.map((job) => job.url)) : new Set();
    const postings = open.filter((job) =>
      !isTooOld(job.postedAt) &&
      !closedUrls.has(job.url) &&
      !(job.expiresAt && new Date(job.expiresAt) < startedAt) &&
      (!areas || areaScore(job.location, areas) > 0 || (job.workplace === "Remote" && !job.location))
    );

    if (provider.details && postings.length) {
      await addDetails(provider, board, postings);
    }

    // Returns one field from every posting
    const column = (pick) => postings.map(pick);
    const storedIds = column((job) => String(job.externalId).slice(0, 200));

    /* A posting that hasn't changed is rewritten only to mark it seen, at most every SEEN_DAYS, which is well inside the
       AGGREGATOR_UNSEEN_DAYS after which an unseen posting is removed. That saves the database most of the writes */
    if (postings.length) {
      await db.query(
        `INSERT INTO job_postings
           (board_id, external_id, company, title, location, workplace_model, url, description, posted_at, seen_at)
         SELECT $1, x.external_id, x.company, x.title, x.location, x.workplace_model, x.url, x.description, x.posted_at, $10
         FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::timestamptz[])
           AS x(external_id, company, title, location, workplace_model, url, description, posted_at)
         ON CONFLICT (board_id, external_id) DO UPDATE SET
           company = EXCLUDED.company, title = EXCLUDED.title, location = EXCLUDED.location,
           workplace_model = EXCLUDED.workplace_model, url = EXCLUDED.url,
           description = CASE WHEN EXCLUDED.description = '' THEN job_postings.description ELSE EXCLUDED.description END,
           posted_at = EXCLUDED.posted_at, seen_at = EXCLUDED.seen_at
         WHERE (job_postings.company, job_postings.title, job_postings.location, job_postings.workplace_model,
                job_postings.url, job_postings.posted_at)
             IS DISTINCT FROM (EXCLUDED.company, EXCLUDED.title, EXCLUDED.location, EXCLUDED.workplace_model,
                EXCLUDED.url, EXCLUDED.posted_at)
           OR (EXCLUDED.description <> '' AND EXCLUDED.description IS DISTINCT FROM job_postings.description)
           OR job_postings.seen_at < $10 - make_interval(days => $11)`,
        [
          board.id,
          storedIds,
          column((job) => String(job.company || board.company || board.token).slice(0, 200)),
          column((job) => String(job.title).trim().slice(0, 200)),
          column((job) => String(job.location || "").slice(0, 200)),
          column((job) => job.workplace),
          column((job) => String(job.url).slice(0, MAX_LINK)),
          column((job) => String(job.description || "").slice(0, DESCRIPTION_LIMIT)),
          column((job) => job.postedAt),
          startedAt,
          SEEN_DAYS
        ]
      );
    }

    if (provider.aggregator) {
      await addBoards(boardsIn(open.map((job) => job.url).join("\n")), "jsearch");
      await db.query(
        `DELETE FROM job_postings WHERE board_id = $1 AND seen_at < NOW() - make_interval(days => $2)`,
        [board.id, AGGREGATOR_UNSEEN_DAYS]
      );
    } else {
      // Postings gone from the board closed; ones still listed but no longer kept (too old, elsewhere) are just dropped
      const closed = await db.query(
        `DELETE FROM job_postings WHERE board_id = $1 AND NOT (external_id = ANY($2::text[])) RETURNING url`,
        [board.id, openIds]
      );
      await removeClosedJobs(closed.rows.map((row) => row.url));

      await db.query(`DELETE FROM job_postings WHERE board_id = $1 AND NOT (external_id = ANY($2::text[]))`, [board.id, storedIds]);
    }

    await db.query(
      `UPDATE job_boards SET failures = 0, ${boardMoveSet("succeed")}, last_fetched_at = NOW(), company = COALESCE($2, company)
       WHERE id = $1`,
      [board.id, postings[0]?.company || null]
    );

    return postings.length;
  } catch (err) {
    console.error(`Job board ${board.provider}/${board.token} failed:`, err.message);

    if (provider.aggregator) {
      await db.query(
        `UPDATE job_boards SET failures = failures + 1,
           last_fetched_at = NOW() - make_interval(hours => $2::int) + make_interval(hours => $3::int)
         WHERE id = $1`,
        [board.id, JSEARCH_HOURS, JSEARCH_RETRY_HOURS]
      );

      return 0;
    }

    // A rate-limited board isn't broken (Workday turns some automated requests away): it waits for its next refresh
    if (err.status === 429) {
      await db.query(`UPDATE job_boards SET last_fetched_at = NOW() WHERE id = $1`, [board.id]);

      return 0;
    }

    await db.query(
      `UPDATE job_boards
       SET failures = failures + 1, ${boardMoveSet("fail", { stay: "failures + 1 < $2" })}, last_fetched_at = NOW()
       WHERE id = $1`,
      [board.id, MAX_FAILURES]
    );

    return 0;
  }
}

/* Refreshes boards that weren't fetched recently, oldest first and at most MAX_BOARDS_PER_REFRESH at a time.
   A company board that was switched off is tried again after RETRY_DAYS, since the company may hire again */
async function refreshStaleBoards() {
  const { rows: boards } = await db.query(
    `SELECT id, provider, token, company FROM job_boards
     WHERE (${boardIn(["on"])}
         OR (provider <> 'jsearch' AND ${boardIn(["off"])} AND last_fetched_at < NOW() - make_interval(days => $3)))
       AND (provider <> 'jsearch' OR $2::boolean)
       AND (last_fetched_at IS NULL OR last_fetched_at < NOW() - make_interval(
         hours => COALESCE(($6::int[])[array_position($5::text[], provider)], $1::int)))
     ORDER BY last_fetched_at NULLS FIRST
     LIMIT $4`,
    [REFRESH_HOURS, jsearchEnabled(), RETRY_DAYS, MAX_BOARDS_PER_REFRESH, Object.keys(SLOWER_REFRESH), Object.values(SLOWER_REFRESH)]
  );
  const areas = FEED_AREAS;
  const searches = boards.filter((board) => PROVIDERS[board.provider].aggregator);
  const companyBoards = boards.filter((board) => !PROVIDERS[board.provider].aggregator);
  const stored = [];

  // Runs the JSearch searches one at a time with a gap between them
  const searchOneByOne = async () => {
    for (const [index, board] of searches.entries()) {
      if (index > 0) await sleep(JSEARCH_GAP_MS);
      stored.push(await refreshBoard(board, areas));
    }
  };

  await Promise.all([
    searchOneByOne(),
    eachLimited(companyBoards, CONCURRENCY, async (board) => {
      stored.push(await refreshBoard(board, areas));
    })
  ]);

  if (boards.length) {
    const postings = stored.reduce((sum, count) => sum + count, 0);
    const empty = stored.filter((count) => count === 0).length;

    console.info(`[feeds] Refreshed ${boards.length} boards: ${postings} postings in the wanted areas, ${empty} boards with none (or failed)`);
  }

  return boards.length;
}

// Checks whether a periodic task is due
async function isDue(key, hours) {
  const { rows } = await db.query(`SELECT updated_at FROM feed_state WHERE key = $1`, [key]);

  return !rows[0] || rows[0].updated_at < new Date(Date.now() - hours * 3600 * 1000);
}

// Records that a periodic task ran
function markDone(key) {
  return db.query(
    `INSERT INTO feed_state (key, updated_at) VALUES ($1, NOW())
     ON CONFLICT (key) DO UPDATE SET updated_at = NOW()`,
    [key]
  );
}

// Lists the discovery searches for the users' roles and their places in the feed regions (the regions themselves if none)
function discoveryQueries(rows) {
  // Sorts the items by how often they appear
  const count = (lists) => {
    const tally = new Map();
    lists.flat().filter(Boolean).forEach((item) => tally.set(item, (tally.get(item) || 0) + 1));

    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([item]) => item);
  };

  const roles = count(rows.map((row) => row.preferences?.roles || [])).slice(0, 6);
  const places = count(rows.map((row) => (row.preferences?.locations || []).map((place) => place.split(",").pop().trim()).filter(inFeedRegions)));

  return (places.length ? places.slice(0, 2) : FEED_REGIONS).flatMap((place) => [
    ...DISCOVERY_SITES.map((site) => `site:${site} ${place}`),
    ...roles.flatMap((role) => DISCOVERY_SITES.map((site) => `site:${site} "${role}" ${place}`))
  ]);
}

// Picks this run's share of the searches, so that the runs take turns covering them all
function queriesForRun(queries) {
  const size = Math.min(DISCOVERY_QUERIES, queries.length);
  const run = Math.floor(Date.now() / (DISCOVERY_HOURS * 3_600_000));
  const start = (run * size) % queries.length;

  return [...queries, ...queries].slice(start, start + size);
}

// Asks Claude for new company boards that match users' preferences
async function discover() {
  const { rows } = await db.query(`SELECT preferences FROM cv_profiles`);
  const queries = queriesForRun(discoveryQueries(rows));
  const messages = [{
    role: "user",
    content: `Run each of these web searches once, then reply "done".\n${queries.map((query) => `- ${query}`).join("\n")}`
  }];
  const urls = [];

  for (let turn = 0; turn < 3; turn++) {
    const message = await claude.send(
      {
        model: claude.model("ANTHROPIC_DISCOVERY_MODEL", claude.CHEAP_MODEL),
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: queries.length }],
        messages
      },
      { fallback: false, timeoutMs: 3 * 60 * 1000 }
    );

    for (const block of message.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        block.content.forEach((result) => result?.url && urls.push(result.url));
      }
    }

    if (message.stop_reason !== "pause_turn") {
      break;
    }

    messages.push({ role: "assistant", content: message.content });
  }

  const boards = boardsIn(urls.join("\n"));
  await addBoards(boards, "claude");

  return boards.length;
}

// Builds the JSearch queries for the user's roles
function searchRoles(roles, seniority) {
  const seen = new Set();
  const result = [];

  for (const raw of roles) {
    const role = String(raw).trim();
    let query = role;

    if (!ENTRY_WORDS.test(role) && seniority === "Junior") query = `Junior ${role}`;
    if (!ENTRY_WORDS.test(role) && seniority === "Student") query = `${role} Student`;

    const key = query.toLowerCase().replace(/developer|programmer/g, "engineer").replace(/[^a-z]+/g, " ").trim();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(query);
    }
  }

  return result.slice(0, 3);
}

// Adds the company boards found through the tech map
async function importTechmap() {
  const { listed, careers, probed } = await techmap.findBoards();
  await addBoards(listed, "techmap");
  await addBoards(careers, "careers");
  await addBoards(probed, "probe");

  console.info(`[feeds] Tech map import: ${listed.length} boards from its lists and files, ${careers.length} from careers pages, ${probed.length} found by name`);
}

// Keeps JSearch boards in sync with users' roles and their places in the feed regions (the regions themselves if none)
async function syncSearchBoards() {
  const { rows } = await db.query(`SELECT preferences FROM cv_profiles`);
  const tally = new Map();

  for (const row of rows) {
    const roles = searchRoles(row.preferences?.roles || [], row.preferences?.seniority);
    const locations = (row.preferences?.locations || []).map((place) => String(place).trim()).filter(inFeedRegions).slice(0, 2);
    const country = locations[0]?.includes(",") ? locations[0].split(",").pop().trim() : null;
    const places = [...new Set([...locations, country].filter(Boolean))];

    for (const role of roles) {
      for (const place of places.length ? places : FEED_REGIONS) {
        const token = `${String(role).trim()} in ${String(place).trim()}|${countryCode(place) || ""}`.slice(0, 200);
        tally.set(token, (tally.get(token) || 0) + 1);
      }
    }
  }

  const wanted = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, JSEARCH_MAX_QUERIES).map(([token]) => token);

  for (const token of wanted) {
    await db.query(
      `INSERT INTO job_boards (provider, token, company, source)
       VALUES ('jsearch', $1, 'LinkedIn, Indeed and more', 'search')
       ON CONFLICT (provider, LOWER(token)) DO UPDATE SET ${boardMoveSet("want", { table: "job_boards" })}`,
      [token]
    );
  }

  await db.query(
    `UPDATE job_boards SET ${boardMoveSet("unwant")}
     WHERE provider = 'jsearch' AND NOT (LOWER(token) = ANY($1::text[]))`,
    [wanted.map((token) => token.toLowerCase())]
  );
}

/* Refreshes the job feeds, unless another server is already doing it. A search passes onlyWhenStale, so it skips the
   pass when the background refresh ran within SEARCH_REFRESH_HOURS. Old postings are removed by the daily cleanup */
async function ensureFresh({ onlyWhenStale = false } = {}) {
  if (onlyWhenStale && !(await isDue("refresh", SEARCH_REFRESH_HOURS))) {
    return;
  }

  const client = await db.connect();

  try {
    const { rows } = await client.query(`SELECT pg_try_advisory_lock($1) AS locked`, [LOCK_KEY]);

    if (!rows[0].locked) {
      return;
    }

    try {
      await harvestUserBoards();

      if (jsearchEnabled()) {
        await syncSearchBoards();
      }

      if (!dev.offline && claude.isConfigured() && await isDue("discovery", DISCOVERY_HOURS)) {
        try {
          await discover();
        } catch (err) {
          console.error("Job board discovery failed:", err.message);
        }

        await markDone("discovery");
      }

      /* Runs in the background, since the first runs read hundreds of files; the boards it adds are fetched next time.
         A failed import is marked as not done, so the next refresh tries again (as when a new server starts before its
         schema is applied) */
      if (!dev.offline && FEED_REGIONS.includes(techmap.REGION) && await isDue("techmap", TECHMAP_HOURS)) {
        await markDone("techmap");
        importTechmap().catch(async (err) => {
          console.error("Tech map import failed:", err.message);
          await db.query(`DELETE FROM feed_state WHERE key = $1`, ["techmap"]).catch(() => {});
        });
      }

      await refreshStaleBoards();
      await markDone("refresh");

      // Runs in the background, so the refresh (and the search waiting for it) doesn't wait for logos
      logoPrefetch.prefetchLogos().catch((err) => console.error("Logo prefetch failed:", err.message));
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

module.exports = {
  ensureFresh, removeOldPostings, markClosed, refreshBoard, PROVIDERS, cleanUrl, searchRoles, discoveryQueries,
  queriesForRun, MAX_AGE_DAYS
};
