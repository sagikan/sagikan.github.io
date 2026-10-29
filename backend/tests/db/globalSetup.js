import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { assertSafeDatabaseUrl, assertTestDatabase, startupError } from "./guard.js";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const SCHEMA = new URL("../../schema.sql", import.meta.url);

// Checks the test database is safe to use, then rebuilds it from schema.sql
export default async function setup() {
  assertSafeDatabaseUrl(process.env.TEST_DATABASE_URL);

  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });

  await client.connect();

  try {
    const schema = readFileSync(SCHEMA, "utf8");

    await assertTestDatabase(client);
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await client.query(schema);
    // Applied a second time, since every deploy re-applies it to the real database
    await client.query(schema);
  } catch (error) {
    throw error.startup ? error : startupError(`Could not set up the test database: ${error.message}`);
  } finally {
    await client.end();
  }
}
