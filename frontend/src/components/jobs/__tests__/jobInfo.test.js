import { describe, expect, it } from "vitest";
import { isFreshJob } from "../jobInfo";

const NOW = new Date("2026-11-02T12:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;
const FOUND = { state: "new", source: "search", created_at: new Date(NOW - 2 * HOUR).toISOString() };

describe("isFreshJob", () => {
  it("accepts a new search result found within the last day", () => {
    expect(isFreshJob(FOUND, NOW)).toBe(true);
  });

  it.each([
    ["found a day or more ago", { created_at: new Date(NOW - 24 * HOUR).toISOString() }],
    ["already applied to", { state: "applied" }],
    ["added by hand", { source: "manual" }]
  ])("rejects a job %s", (_, change) => {
    expect(isFreshJob({ ...FOUND, ...change }, NOW)).toBe(false);
  });
});
