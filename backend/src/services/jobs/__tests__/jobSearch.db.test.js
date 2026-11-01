import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createUser } from "../../../../tests/db/helpers";

const require = createRequire(import.meta.url);
const db = require("../../../config/db");
const jobSearch = require("../jobSearch");

// Adds a number of jobs for a user with scores counting down from the top
async function addJobs(userId, count, { source = "search", state = "new", hidden = false, prefix = "Job" } = {}) {
  await db.query(
    `INSERT INTO jobs (user_id, source, company, position, url, state, hidden, match_score)
     SELECT $1::bigint, $2::text, $3::text || n::text, 'Engineer', 'https://example.com/' || $3::text || n::text,
            $4::text, $5::boolean, 100 - (n % 100)
     FROM generate_series(1, $6::int) AS n`,
    [userId, source, prefix, state, hidden, count]
  );
}

describe("trimFound", () => {
  it("dismisses the weakest new search jobs beyond the cap", async () => {
    const user = await createUser({ email: "dana@example.com" });

    await addJobs(user.id, jobSearch.MAX_FOUND_JOBS + 5);
    await jobSearch.trimFound(user.id);

    const { rows } = await db.query("SELECT state, COUNT(*)::int AS count, MIN(match_score) AS lowest FROM jobs GROUP BY state ORDER BY state");
    const kept = rows.find((row) => row.state === "new");
    const dismissed = rows.find((row) => row.state === "dismissed");

    expect(kept.count).toBe(jobSearch.MAX_FOUND_JOBS);
    expect(dismissed.count).toBe(5);
    expect(dismissed.lowest).toBeLessThanOrEqual(kept.lowest);
  });

  it("leaves hand-added, applied, hidden and other users' jobs alone", async () => {
    const user = await createUser({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });

    await addJobs(user.id, jobSearch.MAX_FOUND_JOBS);
    await addJobs(user.id, 3, { source: "manual", prefix: "Manual" });
    await addJobs(user.id, 3, { state: "applied", prefix: "Applied" });
    await addJobs(user.id, 3, { hidden: true, prefix: "Hidden" });
    await addJobs(other.id, jobSearch.MAX_FOUND_JOBS + 3);
    await jobSearch.trimFound(user.id);

    const { rows } = await db.query("SELECT user_id, state, COUNT(*)::int AS count FROM jobs GROUP BY user_id, state ORDER BY user_id, state");
    const countFor = (userId, state) => rows.find((row) => String(row.user_id) === String(userId) && row.state === state)?.count ?? 0;

    expect(countFor(user.id, "dismissed")).toBe(0);
    expect(countFor(user.id, "new")).toBe(jobSearch.MAX_FOUND_JOBS + 6);
    expect(countFor(user.id, "applied")).toBe(3);
    expect(countFor(other.id, "dismissed")).toBe(0);
  });

  it("does nothing when the user is under the cap", async () => {
    const user = await createUser({ email: "dana@example.com" });

    await addJobs(user.id, 10);
    await jobSearch.trimFound(user.id);

    expect((await db.query("SELECT COUNT(*)::int AS count FROM jobs WHERE state = 'new'")).rows[0].count).toBe(10);
  });
});
