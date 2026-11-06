import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseSchema, describeSchema } = require("../schemaTool");

const SQL = `
-- users of the site
CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS jobs (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    status TEXT CHECK (status IN (
        'new',
        'applied'
    )),
    UNIQUE (user_id, id)
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE jobs ADD CONSTRAINT jobs_old_check CHECK (id > 0);
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_old_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_id_check CHECK (id > 1);
ALTER TABLE jobs ADD CONSTRAINT jobs_id_check CHECK (id > 2);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_user_idx
    ON jobs(user_id)
    WHERE hidden = FALSE;
`;

describe("parseSchema", () => {
  it("reads columns, table constraints and indexes", () => {
    const { jobs } = parseSchema(SQL);

    expect(jobs.columns).toEqual([
      "id BIGINT PRIMARY KEY",
      "user_id BIGINT NOT NULL REFERENCES users(id)",
      "status TEXT CHECK (status IN ('new', 'applied'))",
      "hidden BOOLEAN NOT NULL DEFAULT FALSE"
    ]);
    expect(jobs.indexes).toEqual(["UNIQUE jobs_user_idx ON jobs(user_id) WHERE hidden = FALSE"]);
  });

  it("applies later ALTER statements, replacing and dropping constraints", () => {
    const { jobs } = parseSchema(SQL);

    expect(jobs.constraints).toEqual(["UNIQUE (user_id, id)", "CONSTRAINT jobs_id_check CHECK (id > 2)"]);
  });

  it("removes an inline CHECK when a later ALTER replaces its constraint", () => {
    const { boards } = parseSchema(`
      CREATE TABLE boards (kind TEXT NOT NULL CHECK (kind IN ('a', 'b')), id INT);
      ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_kind_check;
      ALTER TABLE boards ADD CONSTRAINT boards_kind_check CHECK (kind IN ('a', 'b', 'c'));
    `);

    expect(boards.columns).toEqual(["kind TEXT NOT NULL", "id INT"]);
    expect(boards.constraints).toEqual(["CONSTRAINT boards_kind_check CHECK (kind IN ('a', 'b', 'c'))"]);
  });

  it("ignores comments", () => {
    expect(Object.keys(parseSchema(SQL))).toEqual(["users", "jobs"]);
  });
});

describe("describeSchema", () => {
  it("lists every table with its column names when no table is given", () => {
    expect(describeSchema(SQL)).toBe("users: id, email\njobs: id, user_id, status, hidden");
  });

  it("describes one table in full", () => {
    const output = describeSchema(SQL, "users");

    expect(output).toBe("users\n  id BIGINT PRIMARY KEY\n  email TEXT NOT NULL UNIQUE");
  });

  it("includes constraints and indexes for a table that has them", () => {
    const output = describeSchema(SQL, "jobs");

    expect(output).toContain("constraints:\n  UNIQUE (user_id, id)");
    expect(output).toContain("indexes:\n  UNIQUE jobs_user_idx");
  });

  it("returns the table names for an unknown table", () => {
    expect(describeSchema(SQL, "nope")).toBe("Unknown table \"nope\". Tables: users, jobs");
  });
});
