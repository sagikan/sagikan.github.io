import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const db = require("../../../config/db");
const logos = require("../logoService");
const { companiesToLookUp, prefetchLogos } = require("../logoPrefetch");

const DAY = 24 * 60 * 60 * 1000;

// Builds a posting row as the database returns it
function posting(company, daysAgo, extra = {}) {
  return { company, title: `Engineer at ${company}`, location: "Haifa", url: `https://careers.${company.toLowerCase().replace(/\W/g, "")}.com/1`, first_seen_at: new Date(Date.now() - daysAgo * DAY), ...extra };
}

// Mocks the database: the postings, the keys that already have a logo and the keys the feed missed
function mockDatabase({ postings = [], logoKeys = [], missKeys = [] } = {}) {
  return vi.spyOn(db, "query").mockImplementation(async (sql, params) => {
    if (sql.includes("FROM job_postings")) return { rows: postings };
    if (sql.includes("FROM company_logos")) return { rows: logoKeys.filter((key) => params[0].includes(key)).map((name_key) => ({ name_key })) };
    if (sql.includes("FROM feed_logo_misses")) return { rows: missKeys.filter((key) => params[0].includes(key)).map((name_key) => ({ name_key })) };

    return { rows: [] };
  });
}

describe("companiesToLookUp", () => {
  it("lists each company once, newest first, with the posting that introduced it", async () => {
    mockDatabase({ postings: [posting("Orbit", 5), posting("Pinnacle", 1), posting("Globex", 3)] });

    const companies = await companiesToLookUp();

    expect(companies.map((row) => row.company)).toEqual(["Pinnacle", "Globex", "Orbit"]);
    expect(companies[0]).toMatchObject({ title: "Engineer at Pinnacle", location: "Haifa", url: "https://careers.pinnacle.com/1" });
  });

  it("treats names that differ only in case, punctuation or legal suffix as one company, keeping the newest posting", async () => {
    mockDatabase({ postings: [posting("Orbit Ltd.", 9, { title: "Old" }), posting("ORBIT", 2, { title: "Newer" }), posting("orbit inc", 4, { title: "Middle" })] });

    const companies = await companiesToLookUp();

    expect(companies).toHaveLength(1);
    expect(companies[0].title).toBe("Newer");
  });

  it("leaves out companies with a recent logo or a recent miss from the feed", async () => {
    mockDatabase({ postings: [posting("Orbit", 1), posting("Pinnacle", 2), posting("Globex", 3)], logoKeys: ["orbit"], missKeys: ["pinnacle"] });

    expect((await companiesToLookUp()).map((row) => row.company)).toEqual(["Globex"]);
  });

  it("only counts a logo as recent for 180 days and a miss for 7", async () => {
    const query = mockDatabase({ postings: [posting("Orbit", 1)] });

    await companiesToLookUp();

    expect(query.mock.calls.find(([sql]) => sql.includes("FROM company_logos"))[1]).toEqual([["orbit"], 180]);
    expect(query.mock.calls.find(([sql]) => sql.includes("FROM feed_logo_misses"))[1]).toEqual([["orbit"], 7]);
  });

  it("leaves out names with no letters", async () => {
    mockDatabase({ postings: [posting("!!!", 1), posting("Orbit", 2)] });

    expect((await companiesToLookUp()).map((row) => row.company)).toEqual(["Orbit"]);
  });

  it("reads only postings from boards that did not come from users' links", async () => {
    const query = mockDatabase({ postings: [] });

    await companiesToLookUp();

    expect(query.mock.calls[0][0]).toContain("JOIN job_boards b ON b.id = p.board_id");
    expect(query.mock.calls[0][0]).toContain("WHERE b.source <> 'user'");
  });

  it("asks nothing more when there are no postings", async () => {
    const query = mockDatabase({ postings: [] });

    expect(await companiesToLookUp()).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("prefetchLogos", () => {
  // Makes lookups available and answers each prefetch with the given function
  function mockPrefetch(answer = async () => "found") {
    vi.spyOn(logos, "isConfigured").mockReturnValue(true);

    return vi.spyOn(logos, "prefetchLogo").mockImplementation(answer);
  }

  it("does nothing when lookups are off, without touching the database", async () => {
    const query = mockDatabase({ postings: [posting("Orbit", 1)] });

    vi.spyOn(logos, "isConfigured").mockReturnValue(false);

    expect(await prefetchLogos()).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("looks up each company with its posting's details and counts the results", async () => {
    mockDatabase({ postings: [posting("Orbit", 3), posting("Pinnacle", 2), posting("Globex", 1)] });

    const prefetch = mockPrefetch(async (company) => ({ Orbit: "found", Pinnacle: "missed", Globex: "failed" })[company]);

    expect(await prefetchLogos()).toEqual({ found: 1, missed: 1, skipped: 0, failed: 1, limit: 0, paused: 0 });
    expect(prefetch).toHaveBeenCalledWith("Globex", { position: "Engineer at Globex", location: "Haifa", job_url: "https://careers.globex.com/1" });
  });

  it("returns empty counts when there is nothing to look up", async () => {
    mockDatabase({ postings: [] });
    mockPrefetch();

    expect(await prefetchLogos()).toEqual({ found: 0, missed: 0, skipped: 0, failed: 0, limit: 0, paused: 0 });
  });

  it("looks up at most 3 companies at a time", async () => {
    mockDatabase({ postings: Array.from({ length: 10 }, (_unused, number) => posting(`Company ${number}`, number)) });

    let inFlight = 0;
    let most = 0;

    mockPrefetch(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;

      return "found";
    });

    const results = await prefetchLogos();

    expect(results.found).toBe(10);
    expect(most).toBe(3);
  });

  it("stops looking up companies once the feed's allowance is used up", async () => {
    mockDatabase({ postings: Array.from({ length: 12 }, (_unused, number) => posting(`Company ${number}`, number)) });

    const prefetch = mockPrefetch(async () => (prefetchCalls() >= 4 ? "limit" : "found"));
    const prefetchCalls = () => prefetch.mock.calls.length;
    const results = await prefetchLogos();

    expect(results.limit).toBeGreaterThan(0);
    expect(prefetch.mock.calls.length).toBeLessThan(12);
  });

  it("stops looking up companies while lookups are paused", async () => {
    mockDatabase({ postings: Array.from({ length: 12 }, (_unused, number) => posting(`Company ${number}`, number)) });

    const prefetch = mockPrefetch(async () => "paused");
    const results = await prefetchLogos();

    expect(results.paused).toBeGreaterThan(0);
    expect(prefetch.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("does not start a second run while one is going, and can run again afterwards", async () => {
    mockDatabase({ postings: [posting("Orbit", 1)] });

    let release;
    const prefetch = mockPrefetch(() => new Promise((resolve) => {
      release = () => resolve("found");
    }));
    const first = prefetchLogos();

    await vi.waitFor(() => expect(prefetch).toHaveBeenCalledTimes(1));

    expect(await prefetchLogos()).toBeNull();
    release();
    await first;
    prefetch.mockImplementation(async () => "found");

    expect(await prefetchLogos()).toMatchObject({ found: 1 });
  });

  it("can run again after a failure", async () => {
    const query = mockDatabase();

    mockPrefetch();
    query.mockRejectedValueOnce(new Error("db down"));

    await expect(prefetchLogos()).rejects.toThrow("db down");

    expect(await prefetchLogos()).toMatchObject({ found: 0 });
  });
});
