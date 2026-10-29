import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { assertSafeDatabaseUrl, assertTestDatabase } from "./guard.js";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const SCHEMA = new URL("../../schema.sql", import.meta.url);

// Checks the test database is safe to use, then rebuilds it from schema.sql
export default async function setup() {
  assertSafeDatabaseUrl(process.env.TEST_DATABASE_URL);

  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });

  await client.connect();

  try {
    await assertTestDatabase(client);
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await client.query(readFileSync(SCHEMA, "utf8"));
  } finally {
    await client.end();
  }
}
