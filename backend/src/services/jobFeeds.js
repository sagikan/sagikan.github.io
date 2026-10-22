const db = require("../config/db");
const claude = require("./anthropic");
const { htmlToText } = require("./htmlText");
const { areasFor, areaScore, tidyLocation } = require("./locations");

const REFRESH_HOURS = 6;
const DISCOVERY_HOURS = 24;
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

function workplaceFrom(text) {
  if (/\bremote\b/i.test(text || "")) return "Remote";
  if (/\bhybrid\b/i.test(text || "")) return "Hybrid";
  return null;
}

function prettyName(token) {
  return token
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => (word === word.toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function toDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

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
  }
};

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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

async function harvestUserBoards() {
  const { rows } = await db.query(
    `SELECT job_url AS url FROM applications WHERE job_url IS NOT NULL
     UNION SELECT url FROM jobs WHERE url IS NOT NULL AND source = 'manual'`
  );
  await addBoards(boardsIn(rows.map((row) => row.url).join("\n")), "user");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "JobTracker/1.0" },
    signal: AbortSignal.timeout(20_000)
  });

  if (response.status === 404) {
    return { gone: true };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return { data: await response.json() };
}

async function wantedAreas() {
  const { rows } = await db.query(`SELECT preferences FROM cv_profiles`);
  const locations = rows.flatMap((row) => row.preferences?.locations || []);
  return locations.length ? areasFor(locations) : null;
}

// Removes closed postings from users' job lists. Jobs they applied to stay, since those are tied
// to their applications, and so do jobs they added themselves.
async function removeClosedJobs(urls) {
  if (urls.length === 0) {
    return 0;
  }

  const removed = await db.query(
    `DELETE FROM jobs WHERE source = 'search' AND state <> 'applied' AND url = ANY($1::text[])`,
    [urls]
  );
  return removed.rowCount;
}

async function refreshBoard(board, areas = null) {
  const provider = PROVIDERS[board.provider];
  const startedAt = new Date();

  try {
    const { gone, data } = await fetchJson(provider.url(board.token));

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
        return { ...job, location: tidy.location, workplace: job.workplace || tidy.workplace };
      });
    const openIds = open.map((job) => String(job.externalId).slice(0, 200));
    const postings = open.filter((job) =>
      !areas || areaScore(job.location, areas) > 0 || (job.workplace === "Remote" && !job.location)
    );
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
          column((job) => String(job.title).trim().slice(0, 300)),
          column((job) => String(job.location || "").slice(0, 300)),
          column((job) => job.workplace),
          column((job) => String(job.url).slice(0, 1000)),
          column((job) => String(job.description || "").slice(0, DESCRIPTION_LIMIT)),
          column((job) => job.postedAt),
          startedAt
        ]
      );
    }

    const closed = await db.query(
      `DELETE FROM job_postings
       WHERE board_id = $1 AND seen_at < $2 AND NOT (external_id = ANY($3::text[]))
       RETURNING url`,
      [board.id, startedAt, openIds]
    );
    await removeClosedJobs(closed.rows.map((row) => row.url));

    await db.query(`DELETE FROM job_postings WHERE board_id = $1 AND seen_at < $2`, [board.id, startedAt]);
    await db.query(
      `UPDATE job_boards SET failures = 0, last_fetched_at = NOW(), company = COALESCE($2, company) WHERE id = $1`,
      [board.id, postings[0]?.company || null]
    );
    return postings.length;
  } catch (err) {
    console.error(`Job board ${board.provider}/${board.token} failed:`, err.message);
    await db.query(
      `UPDATE job_boards SET failures = failures + 1, active = failures + 1 < $2, last_fetched_at = NOW() WHERE id = $1`,
      [board.id, MAX_FAILURES]
    );
    return 0;
  }
}

async function refreshStaleBoards() {
  const { rows: boards } = await db.query(
    `SELECT id, provider, token, company FROM job_boards
     WHERE active AND (last_fetched_at IS NULL OR last_fetched_at < NOW() - make_interval(hours => $1))`,
    [REFRESH_HOURS]
  );

  const areas = await wantedAreas();
  let next = 0;
  const worker = async () => {
    while (next < boards.length) {
      await refreshBoard(boards[next++], areas);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, boards.length) }, worker));
  return boards.length;
}

async function isDue(key, hours) {
  const { rows } = await db.query(`SELECT updated_at FROM feed_state WHERE key = $1`, [key]);
  return !rows[0] || rows[0].updated_at < new Date(Date.now() - hours * 3600 * 1000);
}

function markDone(key) {
  return db.query(
    `INSERT INTO feed_state (key, updated_at) VALUES ($1, NOW())
     ON CONFLICT (key) DO UPDATE SET updated_at = NOW()`,
    [key]
  );
}

async function discover() {
  const { rows } = await db.query(`SELECT preferences FROM cv_profiles`);
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

async function ensureFresh() {
  const client = await db.connect();

  try {
    const { rows } = await client.query(`SELECT pg_try_advisory_lock($1) AS locked`, [LOCK_KEY]);

    if (!rows[0].locked) {
      return;
    }

    try {
      await addBoards(SEED_BOARDS.map(([provider, token]) => ({ provider, token })), "seed");
      await harvestUserBoards();

      if (claude.isConfigured() && await isDue("discovery", DISCOVERY_HOURS)) {
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

module.exports = { ensureFresh };
