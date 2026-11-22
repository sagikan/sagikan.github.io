import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { createUser } from "../../../../tests/db/helpers";
import { jsonResponse } from "../../../../tests/helpers/network";

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

describe("refreshBoard", () => {
  it("keeps a stored description that the board's list leaves out, and switches a board that was off back on", async () => {
    const board = await db.query(
      `INSERT INTO job_boards (provider, token, source, active, failures)
       VALUES ('smartrecruiters', 'Acme', 'techmap', FALSE, 3)
       RETURNING id, provider, token, company`
    );
    const { id } = board.rows[0];
    await db.query(
      `INSERT INTO job_postings (board_id, external_id, company, title, url, description)
       VALUES ($1, '1', 'Acme', 'Engineer', 'https://jobs.smartrecruiters.com/Acme/1', 'Build things')`,
      [id]
    );
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      offset: 0,
      totalFound: 1,
      content: [{ id: "1", name: "Senior Engineer", company: { identifier: "Acme", name: "Acme" }, location: { city: "Tel Aviv", country: "il" } }]
    })));

    const stored = await feeds.refreshBoard(board.rows[0]);
    const posting = await db.query(`SELECT title, description FROM job_postings WHERE board_id = $1`, [id]);
    const after = await db.query(`SELECT active, failures FROM job_boards WHERE id = $1`, [id]);

    expect(stored).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    expect(posting.rows).toEqual([{ title: "Senior Engineer", description: "Build things" }]);
    expect(after.rows[0]).toEqual({ active: true, failures: 0 });
  });
});
