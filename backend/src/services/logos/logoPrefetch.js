const db = require("../../config/db");
const logos = require("./logoService");

const CONCURRENCY = 3;
let running = false;

/* Finds the companies in the job postings that have no recent logo or miss, newest first, each with the posting that introduced it.
   Boards that came from users' links are left out: anyone can make a board of their own, with any company name and title,
   and the lookup is shared by all users */
async function companiesToLookUp() {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (LOWER(p.company)) p.company, p.title, p.location, p.url, p.first_seen_at
     FROM job_postings p
     JOIN job_boards b ON b.id = p.board_id
     WHERE b.source <> 'user'
     ORDER BY LOWER(p.company), p.first_seen_at DESC`
  );
  const byKey = new Map();

  for (const row of rows) {
    const key = logos.normalizeCompany(row.company);
    const known = byKey.get(key);

    if (key && (!known || row.first_seen_at > known.first_seen_at)) {
      byKey.set(key, row);
    }
  }

  const keys = [...byKey.keys()];

  if (keys.length === 0) {
    return [];
  }

  const done = new Set([
    ...(await db.query(
      "SELECT name_key FROM company_logos WHERE name_key = ANY($1) AND fetched_at > NOW() - make_interval(days => $2)",
      [keys, logos.LOGO_DAYS]
    )).rows.map((row) => row.name_key),
    ...(await db.query(
      "SELECT name_key FROM feed_logo_misses WHERE name_key = ANY($1) AND fetched_at > NOW() - make_interval(days => $2)",
      [keys, logos.MISS_DAYS]
    )).rows.map((row) => row.name_key)
  ]);

  return [...byKey.entries()]
    .filter(([key]) => !done.has(key))
    .map(([, row]) => row)
    .sort((a, b) => b.first_seen_at - a.first_seen_at);
}

// Looks up the logos of companies in the job postings, a few at a time, until they are done, the feed's daily allowance runs out or lookups are paused
async function prefetchLogos() {
  if (running || !logos.isConfigured()) {
    return null;
  }

  running = true;

  try {
    const companies = await companiesToLookUp();
    const results = { found: 0, missed: 0, skipped: 0, failed: 0, limit: 0, paused: 0 };
    let next = 0;
    let stopped = false;

    // Looks up companies until none are left, the allowance is used up or lookups are paused
    const worker = async () => {
      while (!stopped && next < companies.length) {
        const row = companies[next++];
        const result = await logos.prefetchLogo(row.company, { position: row.title, location: row.location, job_url: row.url });

        results[result] += 1;
        stopped = result === "limit" || result === "paused";
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    return results;
  } finally {
    running = false;
  }
}

module.exports = { prefetchLogos, companiesToLookUp };
