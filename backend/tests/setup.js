import { createRequire } from "node:module";
import { beforeEach, vi } from "vitest";

/* Source files are CommonJS and load through Node's require cache. Tests must load them with this
   require too (not with import), or they'd get a different copy than the one the services use */
const require = createRequire(import.meta.url);
const db = require("../src/config/db");

// Stands in for any database call a test forgot to mock
function blockedDatabaseCall() {
  throw new Error("Unmocked database call in a test. Mock it with vi.spyOn(db, \"query\").");
}

// Stands in for any outside request a test forgot to mock
function blockedNetworkCall(input) {
  throw new Error(`Unmocked network call in a test: ${String(input?.url ?? input)}`);
}

if (!db.isLocalDatabase(process.env.DATABASE_URL)) {
  throw new Error("Refusing to run tests: DATABASE_URL does not point at this machine.");
}

db.query = blockedDatabaseCall;
db.connect = blockedDatabaseCall;

beforeEach(() => {
  vi.stubGlobal("fetch", blockedNetworkCall);
});
