import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { readPolicyVersion } = require("../policy");

describe("readPolicyVersion", () => {
  it.each(["2026-10-31", "2024-02-29", "1999-01-01"])("accepts the date %s", (version) => {
    expect(readPolicyVersion(version)).toBe(version);
  });

  it.each([
    ["a date that does not exist", "2026-02-30"],
    ["a leap day in a year without one", "2025-02-29"],
    ["a month that does not exist", "2026-13-01"],
    ["a day that does not exist", "2026-01-00"],
    ["a date with the wrong separators", "2026/10/31"],
    ["a date written the other way round", "31-10-2026"],
    ["a date with a time", "2026-10-31T00:00:00Z"],
    ["a date with spaces around it", " 2026-10-31 "],
    ["text", "latest"],
    ["an empty string", ""],
    ["a very long string", "2026-10-31".repeat(1000)],
    ["a number", 20261031],
    ["null", null],
    ["nothing", undefined],
    ["an object", { version: "2026-10-31" }],
    ["a list", ["2026-10-31"]]
  ])("refuses %s", (_title, value) => {
    expect(readPolicyVersion(value)).toBeNull();
  });
});
