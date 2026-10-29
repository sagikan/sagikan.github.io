const db = require("../../config/db");
const claude = require("../ai/anthropic");
const dev = require("../shared/devMode");
const { htmlToText } = require("../shared/htmlText");
const { areasFor, areaScore, tidyLocation } = require("./locations");

const REFRESH_HOURS = 6;
const DISCOVERY_HOURS = 24;
const MAX_AGE_DAYS = 90;
const MAX_LINK = 500;
const AGGREGATOR_UNSEEN_DAYS = 14;
const JSEARCH_HOURS = 24;
const JSEARCH_MAX_QUERIES = Math.max(1, Number(process.env.JSEARCH_MAX_QUERIES) || 6);
const JSEARCH_PAGES = Math.min(5, Math.max(1, Number(process.env.JSEARCH_PAGES) || 1));
const JSEARCH_HOST = "jsearch.p.rapidapi.com";
const JSEARCH_GAP_MS = 1500;
const JSEARCH_RETRY_MS = 5000;
const JSEARCH_RETRY_HOURS = 1;
const TRACKING_PARAMS = /^(utm_\w+|trk|trkInfo|refId|trackingId|src|source|ref|referrer|lipi|position|pageNum|from|tk|vjk|gclid|fbclid)$/i;
const MAX_FAILURES = 3;
const CONCURRENCY = 8;
const DESCRIPTION_LIMIT = 6000;
const LOCK_KEY = 73_514_201;
const TOKEN = /^[A-Za-z0-9._-]{1,80}$/;
const SEED_BOARDS = [
  ["greenhouse", "melio"], ["greenhouse", "atbayjobs"], ["greenhouse", "bringg"], ["greenhouse", "similarweb"],
  ["greenhouse", "descope"], ["greenhouse", "via"], ["lever", "lendbuzz"], ["lever", "emilabs"],
  ["lever", "appnation"], ["lever", "walkme"], ["lever", "tonkean"], ["ashby", "moonactive"],
  ["ashby", "HUMAN"], ["ashby", "wynd-labs"]
];
const BOARD_PATTERNS = [
  ["greenhouse", /(?:job-boards|boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/gi],
  ["lever", /jobs\.lever\.co\/([A-Za-z0-9._-]+)/gi],
  ["ashby", /jobs\.ashbyhq\.com\/([A-Za-z0-9._%-]+)/gi]
];
const NOT_TOKENS = new Set(["embed", "v1", "api", "jobs", "boards", "job_board"]);
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRY_CODES = {
  israel: "il", "united states": "us", usa: "us", us: "us", "united kingdom": "gb", uk: "gb", england: "gb",
  germany: "de", france: "fr", netherlands: "nl", canada: "ca", ireland: "ie", spain: "es", poland: "pl",
  portugal: "pt", italy: "it", india: "in", australia: "au", singapore: "sg", switzerland: "ch", sweden: "se"
};
const PROVIDERS = {
  greenhouse: {
    url: (token) => `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
    parse: (data, board) => (data?.jobs || []).map((job) => ({
      externalId: String(job.id),
      company: job.company_name || board.company,
      title: job.title,
      location: job.location?.name || "",
      workplace: workplaceFrom(job.location?.name),
      url: job.absolute_url,
      description: htmlToText(job.content),
      postedAt: toDate(job.first_published || job.updated_at)
    }))
  },
  lever: {
    url: (token) => `https://api.lever.co/v0/postings/${token}?mode=json`,
    parse: (data, board) => (Array.isArray(data) ? data : []).map((job) => ({
      externalId: job.id,
      company: board.company,
      title: job.text,
      location: (job.categories?.allLocations || [job.categories?.location]).filter(Boolean).join(" / "),
      workplace: { onsite: "On-site", hybrid: "Hybrid", remote: "Remote" }[job.workplaceType] || workplaceFrom(job.categories?.location),
      url: job.hostedUrl,
      description: [
        job.descriptionPlain,
        ...(job.lists || []).map((list) => `${list.text}\n${htmlToText(list.content)}`),
        job.additionalPlain
      ].filter(Boolean).join("\n\n"),
      postedAt: toDate(job.createdAt)
    }))
  },
  ashby: {
    url: (token) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=false`,
    parse: (data, board) => (data?.jobs || []).filter((job) => job.isListed !== false).map((job) => ({
      externalId: job.id,
      company: board.company,
      title: job.title,
      location: [job.location, ...(job.secondaryLocations || []).map((other) => other.location)].filter(Boolean).join(" / "),
      workplace: { OnSite: "On-site", Hybrid: "Hybrid", Remote: "Remote" }[job.workplaceType] || (job.isRemote ? "Remote" : null),
      url: job.jobUrl,
      description: job.descriptionPlain || htmlToText(job.descriptionHtml),
      postedAt: toDate(job.publishedAt)
    }))
  },
  jsearch: {
    aggregator: true,
    url: (token) => {
      const [query, country] = token.split("|");
      const params = new URLSearchParams({ query, page: "1", num_pages: String(JSEARCH_PAGES), date_posted: "month" });
      if (country) params.set("country", country);

      return `https://${JSEARCH_HOST}/search-v2?${params}`;
    },
    headers: () => ({ "X-RapidAPI-Key": process.env.JSEARCH_API_KEY, "X-RapidAPI-Host": JSEARCH_HOST }),
    // /search-v2 returns the jobs in data.jobs; the old /search returned them in data
    parse: (data) => [data?.data?.jobs, data?.data].find(Array.isArray)?.map((job) => ({
      externalId: job.job_id,
      company: job.employer_name,
      title: job.job_title,
      location: [job.job_city, job.job_state, countryName(job.job_country)].filter(Boolean).join(", ") || job.job_location || "",
      workplace: job.job_is_remote ? "Remote" : workplaceFrom(job.job_title),
      url: jsearchLink(job),
      description: unwrap(job.job_description),
      expiresAt: toDate(job.job_offer_expiration_datetime_utc ||
        (job.job_offer_expiration_timestamp && job.job_offer_expiration_timestamp * 1000)),
      postedAt: toDate(job.job_posted_at_datetime_utc || (job.job_posted_at_timestamp && job.job_posted_at_timestamp * 1000))
    })) || []
  }
};
const ENTRY_WORDS = /\b(junior|jr|entry|graduate|intern|internship|student)\b/i;

// Detects a remote or hybrid workplace from text
function workplaceFrom(text) {
  if (/\bremote\b/i.test(text || "")) return "Remote";
  if (/\bhybrid\b/i.test(text || "")) return "Hybrid";

  return null;
}

// Turns a board token into a company name
function prettyName(token) {
  return token
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => (word === word.toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

// Turns a date value into an ISO string, or null
function toDate(value) {
  const date = value ? new Date(value) : null;

  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

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

// Turns a country code into its English name
function countryName(code) {
  try {
    return code ? countryNames.of(String(code).toUpperCase()) : "";
  } catch {
    return code || "";
  }
}

// Finds the country code of a place name
function countryCode(place) {
  const country = String(place || "").split(",").pop().trim().toLowerCase();

  return COUNTRY_CODES[country] || null;
}

// Joins words split across lines and removes empty lines
function unwrap(text) {
  return String(text || "")
    .replace(/([a-z])(?:\r?\n)+\r?([a-z])/g, "$1$2")
    .replace(/(?:\r?\n\r?)+/g, "\n")
    .trim();
}

// Picks the best apply link for a JSearch job
function jsearchLink(job) {
  const direct = (job.apply_options || []).find((option) => option?.is_direct && option.apply_link);

  return direct?.apply_link || job.job_apply_link || job.job_google_link;
}

// Checks whether JSearch can be called
function jsearchEnabled() {
  return !dev.offline && Boolean(process.env.JSEARCH_API_KEY);
}

// Decodes a URL-encoded value, keeping it as-is if invalid
function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Finds job board links in text
function boardsIn(text) {
  const found = new Map();

  for (const [provider, pattern] of BOARD_PATTERNS) {
    for (const match of String(text || "").matchAll(pattern)) {
      const token = decoded(match[1]);

      if (TOKEN.test(token) && !NOT_TOKENS.has(token.toLowerCase())) {
        found.set(`${provider}:${token.toLowerCase()}`, { provider, token });
      }
    }
  }

  return [...found.values()];
}

// Saves new job boards
async function addBoards(boards, source) {
  for (const { provider, token } of boards) {
    await db.query(
      `INSERT INTO job_boards (provider, token, company, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, LOWER(token)) DO NOTHING`,
      [provider, token, prettyName(token), source]
    );
  }
}

// Adds job boards found in users' application and job links
async function harvestUserBoards() {
  const { rows } = await db.query(
    `SELECT job_url AS url FROM applications WHERE job_url IS NOT NULL
     UNION SELECT url FROM jobs WHERE url IS NOT NULL AND source = 'manual'`
  );
  await addBoards(boardsIn(rows.map((row) => row.url).join("\n")), "user");
}

// Fetches JSON, reporting a 404 as gone
async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "ApplicantZero/1.0", ...headers },
    signal: AbortSignal.timeout(20_000)
  });

  if (response.status === 404) {
    return { gone: true };
  }

  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  }

  return { data: await response.json() };
}

// Waits for the given number of milliseconds
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetches from an aggregator, retrying once when rate limited
async function fetchAggregator(url, headers) {
  try {
    return await fetchJson(url, headers);
  } catch (err) {
    if (err.status !== 429) throw err;
    await sleep(JSEARCH_RETRY_MS);

    return fetchJson(url, headers);
  }
}

// Returns the areas from all users' preferred locations
async function wantedAreas() {
  const { rows } = await db.query(`SELECT preferences FROM cv_profiles`);
  const locations = rows.flatMap((row) => row.preferences?.locations || []);

  return locations.length ? areasFor(locations) : null;
}

// Removes found jobs whose postings closed
async function removeClosedJobs(urls) {
  if (urls.length === 0) {
    return 0;
  }

  const removed = await db.query(
    `DELETE FROM jobs WHERE source = 'search' AND state = 'new' AND url = ANY($1::text[])`,
    [urls]
  );

  return removed.rowCount;
}

// Removes postings that are too old or no longer listed
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
  const removed = await db.query(
    `DELETE FROM jobs
     WHERE source = 'search' AND state = 'new' AND COALESCE(posted_at, created_at) < NOW() - make_interval(days => $1)`,
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
    const fetcher = provider.aggregator ? fetchAggregator : fetchJson;
    const { gone, data } = await fetcher(provider.url(board.token), provider.headers?.());

    if (gone && provider.aggregator) {
      throw new Error("HTTP 404");
    }

    if (gone) {
      await db.query(`UPDATE job_boards SET active = FALSE, last_fetched_at = NOW() WHERE id = $1`, [board.id]);
      const closed = await db.query(`DELETE FROM job_postings WHERE board_id = $1 RETURNING url`, [board.id]);
      await removeClosedJobs(closed.rows.map((row) => row.url));

      return 0;
    }

    const open = provider.parse(data, board)
      .filter((job) => job.externalId && job.title && /^https?:\/\//.test(job.url || ""))
      .map((job) => {
        const tidy = tidyLocation(job.location);

        return { ...job, url: cleanUrl(job.url), location: tidy.location, workplace: job.workplace || tidy.workplace };
      })
      .filter((job) => job.url.length <= MAX_LINK);
    const openIds = open.map((job) => String(job.externalId).slice(0, 200));
    const closedUrls = provider.aggregator ? await knownClosed(open.map((job) => job.url)) : new Set();
    const postings = open.filter((job) =>
      !isTooOld(job.postedAt) &&
      !closedUrls.has(job.url) &&
      !(job.expiresAt && new Date(job.expiresAt) < startedAt) &&
      (!areas || areaScore(job.location, areas) > 0 || (job.workplace === "Remote" && !job.location))
    );

    // Returns one field from every posting
    const column = (pick) => postings.map(pick);

    if (postings.length) {
      await db.query(
        `INSERT INTO job_postings
           (board_id, external_id, company, title, location, workplace_model, url, description, posted_at, seen_at)
         SELECT $1, x.external_id, x.company, x.title, x.location, x.workplace_model, x.url, x.description, x.posted_at, $10
         FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::timestamptz[])
           AS x(external_id, company, title, location, workplace_model, url, description, posted_at)
         ON CONFLICT (board_id, external_id) DO UPDATE SET
           company = EXCLUDED.company, title = EXCLUDED.title, location = EXCLUDED.location,
           workplace_model = EXCLUDED.workplace_model, url = EXCLUDED.url, description = EXCLUDED.description,
           posted_at = EXCLUDED.posted_at, seen_at = EXCLUDED.seen_at`,
        [
          board.id,
          column((job) => String(job.externalId).slice(0, 200)),
          column((job) => String(job.company || board.company || board.token).slice(0, 200)),
          column((job) => String(job.title).trim().slice(0, 200)),
          column((job) => String(job.location || "").slice(0, 200)),
          column((job) => job.workplace),
          column((job) => String(job.url).slice(0, MAX_LINK)),
          column((job) => String(job.description || "").slice(0, DESCRIPTION_LIMIT)),
          column((job) => job.postedAt),
          startedAt
        ]
      );
    }

    if (provider.aggregator) {
      await addBoards(boardsIn(open.map((job) => job.url).join("\n")), "discovered");
      await db.query(
        `DELETE FROM job_postings WHERE board_id = $1 AND seen_at < NOW() - make_interval(days => $2)`,
        [board.id, AGGREGATOR_UNSEEN_DAYS]
      );
    } else {
      const closed = await db.query(
        `DELETE FROM job_postings
         WHERE board_id = $1 AND seen_at < $2 AND NOT (external_id = ANY($3::text[]))
         RETURNING url`,
        [board.id, startedAt, openIds]
      );
      await removeClosedJobs(closed.rows.map((row) => row.url));

      await db.query(`DELETE FROM job_postings WHERE board_id = $1 AND seen_at < $2`, [board.id, startedAt]);
    }

    await db.query(
      `UPDATE job_boards SET failures = 0, last_fetched_at = NOW(), company = COALESCE($2, company) WHERE id = $1`,
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

    await db.query(
      `UPDATE job_boards SET failures = failures + 1, active = failures + 1 < $2, last_fetched_at = NOW() WHERE id = $1`,
      [board.id, MAX_FAILURES]
    );

    return 0;
  }
}

// Refreshes boards that weren't fetched recently
async function refreshStaleBoards() {
  const { rows: boards } = await db.query(
    `SELECT id, provider, token, company FROM job_boards
     WHERE active AND (provider <> 'jsearch' OR $3::boolean)
       AND (last_fetched_at IS NULL OR last_fetched_at < NOW() - make_interval(
         hours => CASE WHEN provider = 'jsearch' THEN $2::int ELSE $1::int END))`,
    [REFRESH_HOURS, JSEARCH_HOURS, jsearchEnabled()]
  );
  const areas = await wantedAreas();
  const searches = boards.filter((board) => PROVIDERS[board.provider].aggregator);
  const companyBoards = boards.filter((board) => !PROVIDERS[board.provider].aggregator);
  let next = 0;

  // Refreshes company boards until none are left
  const worker = async () => {
    while (next < companyBoards.length) {
      await refreshBoard(companyBoards[next++], areas);
    }
  };

  // Runs the JSearch searches one at a time with a gap between them
  const searchOneByOne = async () => {
    for (const [index, board] of searches.entries()) {
      if (index > 0) await sleep(JSEARCH_GAP_MS);
      await refreshBoard(board, areas);
    }
  };

  await Promise.all([
    searchOneByOne(),
    ...Array.from({ length: Math.min(CONCURRENCY, companyBoards.length) }, worker)
  ]);

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

// Asks Claude for new company boards that match users' preferences
async function discover() {
  const { rows } = await db.query(`SELECT preferences FROM cv_profiles`);

  // Sorts the items by how often they appear
  const count = (lists) => {
    const tally = new Map();
    lists.flat().filter(Boolean).forEach((item) => tally.set(item, (tally.get(item) || 0) + 1));

    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([item]) => item);
  };

  const roles = count(rows.map((row) => row.preferences?.roles || [])).slice(0, 3);
  const places = count(rows.map((row) => (row.preferences?.locations || []).map((place) => place.split(",").pop().trim())));
  const place = places[0] || "Israel";
  const sites = ["job-boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"];
  const queries = [
    ...sites.map((site) => `site:${site} ${place}`),
    ...roles.flatMap((role) => sites.map((site) => `site:${site} "${role}" ${place}`))
  ].slice(0, 10);
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
  await addBoards(boards, "discovered");

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

// Keeps JSearch boards in sync with users' roles and locations
async function syncSearchBoards() {
  const { rows } = await db.query(`SELECT preferences FROM cv_profiles`);
  const tally = new Map();

  for (const row of rows) {
    const roles = searchRoles(row.preferences?.roles || [], row.preferences?.seniority);
    const locations = (row.preferences?.locations || []).slice(0, 2).map((place) => String(place).trim());
    const country = locations[0]?.includes(",") ? locations[0].split(",").pop().trim() : null;
    const places = [...new Set([...locations, country].filter(Boolean))];

    for (const role of roles) {
      for (const place of places.length ? places : ["Israel"]) {
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
       ON CONFLICT (provider, LOWER(token)) DO UPDATE SET active = TRUE`,
      [token]
    );
  }

  await db.query(
    `UPDATE job_boards SET active = FALSE
     WHERE provider = 'jsearch' AND NOT (LOWER(token) = ANY($1::text[]))`,
    [wanted.map((token) => token.toLowerCase())]
  );
}

// Refreshes the job feeds, unless another server is already doing it
async function ensureFresh() {
  const client = await db.connect();

  try {
    const { rows } = await client.query(`SELECT pg_try_advisory_lock($1) AS locked`, [LOCK_KEY]);

    if (!rows[0].locked) {
      return;
    }

    try {
      await removeOldPostings();
      await addBoards(SEED_BOARDS.map(([provider, token]) => ({ provider, token })), "seed");
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

      await refreshStaleBoards();
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

module.exports = { ensureFresh, removeOldPostings, markClosed, refreshBoard, PROVIDERS, boardsIn, cleanUrl, prettyName, searchRoles, MAX_AGE_DAYS };
