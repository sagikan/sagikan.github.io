import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createUser } from "../../../../tests/db/helpers";

const require = createRequire(import.meta.url);
const db = require("../../../config/db");
const feeds = require("../jobFeeds");

const OLD = new Date(Date.now() - 100 * 24 * 3600 * 1000);
const RECENT = new Date(Date.now() - 10 * 24 * 3600 * 1000);

// Adds a job for a user and returns its ID
async function addJob(userId, { source = "search", state = "new", hidden = false, url = null, postedAt = OLD } = {}) {
  const { rows } = await db.query(
    `INSERT INTO jobs (user_id, source, company, position, url, state, hidden, posted_at)
     VALUES ($1, $2, 'Acme', 'Engineer', $3, $4, $5, $6)
     RETURNING id`,
    [userId, source, url, state, hidden, postedAt]
  );

  return rows[0].id;
}

// Adds a posting that is still in the feed
async function addPosting(url) {
  const board = await db.query(
    `INSERT INTO job_boards (provider, token, source) VALUES ('greenhouse', 'acme', 'seed') RETURNING id`
  );

  await db.query(
    `INSERT INTO job_postings (board_id, external_id, company, title, url) VALUES ($1, $2, 'Acme', 'Engineer', $2)`,
    [board.rows[0].id, url]
  );
}

describe("removeOldPostings", () => {
  it("removes old untouched found jobs and old dismissed ones, and keeps everything the user still has", async () => {
    const user = await createUser();
    const keptManual = await addJob(user.id, { source: "manual" });
    const keptApplied = await addJob(user.id, { state: "applied" });
    const keptArchived = await addJob(user.id, { state: "applied", hidden: true });
    const keptRecent = await addJob(user.id, { state: "dismissed", postedAt: RECENT });
    const keptListed = await addJob(user.id, { state: "dismissed", url: "https://boards.example.com/acme/1" });

    await addPosting("https://boards.example.com/acme/1");
    await addJob(user.id);
    await addJob(user.id, { state: "dismissed", url: "https://boards.example.com/acme/2" });
    await addJob(user.id, { source: "manual", state: "dismissed" });

    const removed = await feeds.removeOldPostings();
    const { rows } = await db.query("SELECT id FROM jobs ORDER BY id");

    expect(removed).toBe(3);
    expect(rows.map((row) => row.id)).toEqual([keptManual, keptApplied, keptArchived, keptRecent, keptListed]);
  });
});
