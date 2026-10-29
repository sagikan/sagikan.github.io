import { createRequire } from "node:module";
import { afterAll, beforeEach, vi } from "vitest";
import { assertSafeDatabaseUrl, assertTestDatabase } from "./guard.js";

const require = createRequire(import.meta.url);
const db = require("../../src/config/db");
const limiters = require("../../src/middleware/rateLimit");
const LOCAL_ADDRESSES = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

assertSafeDatabaseUrl(process.env.DATABASE_URL);

// Stands in for any outside request a test forgot to mock
function blockedNetworkCall(input) {
  throw new Error(`Unmocked network call in a test: ${String(input?.url ?? input)}`);
}

beforeEach(async () => {
  vi.stubGlobal("fetch", blockedNetworkCall);

  await assertTestDatabase(db);

  const { rows } = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");

  /* IDs keep counting up instead of restarting, so every test gets users with new IDs.
     That keeps per-user rate limits (keyed by user ID) from carrying over between tests */
  await db.query(`TRUNCATE ${rows.map((row) => `"${row.tablename}"`).join(", ")} CASCADE`);

  for (const limiter of Object.values(limiters).filter((value) => typeof value?.resetKey === "function")) {
    LOCAL_ADDRESSES.forEach((address) => limiter.resetKey(address));
  }
});

afterAll(async () => {
  await db.end();
});
