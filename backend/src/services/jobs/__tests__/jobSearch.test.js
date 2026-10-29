import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const db = require("../../../config/db");
const claude = require("../../ai/anthropic");
const feeds = require("../jobFeeds");
const postingCheck = require("../postingCheck");
const jobSearch = require("../jobSearch");

const NOW = "2026-10-29T12:00:00Z";
const CV = {
  name: "Dana Levi",
  headline: "Backend Engineer",
  summary: "",
  experience: [{ title: "Developer", company: "Acme", location: "", start: "Jan 2023", end: "Dec 2023", bullets: [{ id: "x1.b1", text: "Built REST APIs with Node.js" }] }],
  projects: [],
  education: [],
  skills: [{ category: "Languages", items: ["JavaScript", "Python"] }],
  extras: []
};
const PREFS = { roles: ["Backend Engineer"], locations: ["Tel Aviv, Israel"], workplace_models: [], seniority: "Any" };

// Freezes the clock, leaving timers alone
function freezeTime() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
}

// Builds a database result with rows
function rows(...list) {
  return { rows: list, rowCount: list.length };
}

// Builds a job posting row
function posting(id, extra = {}) {
  return {
    id,
    company: `Company ${id}`,
    title: "Backend Engineer",
    location: "Tel Aviv, Israel",
    workplace_model: null,
    url: `https://example.com/jobs/${id}`,
    description: "Build APIs",
    posted_at: null,
    ...extra
  };
}

// Builds a search row, started the given number of minutes ago
function search(status, minutesAgo, extra = {}) {
  const started = new Date(Date.now() - minutesAgo * 60 * 1000);

  return { id: 1, status, found: null, error: null, started_at: started, finished_at: status === "running" ? null : new Date(started.getTime() + 60 * 1000), ...extra };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("status", () => {
  // Mocks the search history, newest first
  function history(...searches) {
    return vi.spyOn(db, "query").mockImplementation(async (sql) => (sql.includes("FROM job_searches") ? rows(...searches) : rows()));
  }

  it("allows a first search when there is no history", async () => {
    freezeTime();
    history();

    expect(await jobSearch.status(7)).toEqual({
      intervalMinutes: 15,
      running: false,
      canRefresh: true,
      nextAutoAt: null,
      lastSearchedAt: null,
      lastFound: null,
      lastError: null,
      lastFailedAt: null
    });
  });

  it("fails searches that have been running for too long, before reading the history", async () => {
    freezeTime();
    const query = history();

    await jobSearch.status(7);

    expect(query.mock.calls[0][0]).toContain("The search took too long.");
    expect(query.mock.calls[0][1]).toEqual([7, 5]);
  });

  it("uses the connection it is given", async () => {
    const client = { query: vi.fn().mockResolvedValue(rows()) };

    await jobSearch.status(7, client);

    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("reports a running search and doesn't allow another", async () => {
    freezeTime();
    history(search("running", 1));

    expect(await jobSearch.status(7)).toMatchObject({ running: true, canRefresh: false });
  });

  it("reports the last finished search and when the next automatic one is due", async () => {
    freezeTime();
    history(search("done", 5, { found: 4 }));
    const result = await jobSearch.status(7);

    expect(result).toMatchObject({ running: false, canRefresh: true, lastFound: 4, lastError: null });
    expect(result.nextAutoAt).toEqual(new Date("2026-10-29T12:10:00Z"));
    expect(result.lastSearchedAt).toEqual(new Date("2026-10-29T11:56:00Z"));
  });

  it("has no automatic search due once 15 minutes have passed", async () => {
    freezeTime();
    history(search("done", 20, { found: 1 }));

    expect((await jobSearch.status(7)).nextAutoAt).toBeNull();
  });

  it("allows at most 10 searches an hour", async () => {
    freezeTime();
    history(...Array.from({ length: 10 }, (_, index) => search("done", 5 + index * 4)));

    expect((await jobSearch.status(7)).canRefresh).toBe(false);
  });

  it("doesn't count failed searches or searches older than an hour toward the limit", async () => {
    freezeTime();
    history(...Array.from({ length: 9 }, (_, index) => search("done", 5 + index)), ...Array.from({ length: 6 }, () => search("failed", 3)), search("done", 90));

    expect((await jobSearch.status(7)).canRefresh).toBe(true);
  });

  it("reports why the latest search failed", async () => {
    freezeTime();
    history(search("failed", 3, { error: "Upload your resume first." }), search("done", 30, { found: 2 }));
    const result = await jobSearch.status(7);

    expect(result).toMatchObject({ lastError: "Upload your resume first.", lastFound: 2 });
    expect(result.lastFailedAt).toEqual(new Date("2026-10-29T11:58:00Z"));
  });

  it("forgets an old failure once a later search worked", async () => {
    freezeTime();
    history(search("done", 3, { found: 1 }), search("failed", 30, { error: "Old" }));

    expect(await jobSearch.status(7)).toMatchObject({ lastError: null, lastFailedAt: null });
  });
});

describe("start", () => {
  let client;

  // Mocks the database for both the transaction connection and the pool
  function mockDatabase({ searches = [], hasProfile = true, profileRow = null, postings = [], applications = [], known = [], recheck = [] } = {}) {
    const handle = async (sql) => {
      if (sql.includes("The search took too long.")) return rows();
      if (sql.includes("FROM job_searches")) return rows(...searches);
      if (sql.includes("SELECT 1 FROM cv_profiles")) return hasProfile ? rows({ one: 1 }) : rows();
      if (sql.includes("INSERT INTO job_searches")) return rows({ id: 55 });
      if (sql.includes("SELECT cv, preferences FROM cv_profiles")) return profileRow ? rows(profileRow) : rows();
      if (sql.includes("SELECT company, position FROM applications")) return rows(...applications);
      if (sql.includes("SELECT company, position, url FROM jobs")) return rows(...known);
      if (sql.includes("SELECT id, url FROM jobs")) return rows(...recheck);
      if (sql.includes("FROM job_postings")) return rows(...postings);

      return rows();
    };

    client = { query: vi.fn(handle), release: vi.fn() };
    vi.spyOn(db, "connect").mockResolvedValue(client);
    vi.spyOn(db, "query").mockImplementation(handle);
  }

  // Finds the call that records how a search ended
  function finishCall() {
    return db.query.mock.calls.find(([sql]) => sql.includes("SET status = $2"));
  }

  beforeEach(() => {
    vi.spyOn(feeds, "ensureFresh").mockResolvedValue();
    vi.spyOn(feeds, "markClosed").mockResolvedValue();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("starts a search in a transaction, then runs it in the background", async () => {
    freezeTime();
    mockDatabase();
    const result = await jobSearch.start(7);

    expect(result.started).toBe(true);
    expect(client.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0])).toEqual(expect.arrayContaining(["BEGIN", "INSERT", "COMMIT"]));
    expect(client.query.mock.calls.find(([sql]) => sql.includes("FOR UPDATE"))[1]).toEqual([7]);
    expect(client.release).toHaveBeenCalledOnce();

    await vi.waitFor(() => expect(finishCall()).toBeTruthy());
  });

  it("doesn't start without a saved resume", async () => {
    freezeTime();
    mockDatabase({ hasProfile: false });

    expect((await jobSearch.start(7)).started).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO job_searches"))).toBe(false);
  });

  it("doesn't start while another search is running", async () => {
    freezeTime();
    mockDatabase({ searches: [search("running", 1)] });

    expect((await jobSearch.start(7)).started).toBe(false);
  });

  it("starts a manual search soon after the last one, but not an automatic one", async () => {
    freezeTime();
    mockDatabase({ searches: [search("done", 5)] });
    const manual = await jobSearch.start(7);

    await vi.waitFor(() => expect(finishCall()).toBeTruthy());
    mockDatabase({ searches: [search("done", 5)] });

    expect(manual.started).toBe(true);
    expect((await jobSearch.start(7, { auto: true })).started).toBe(false);
  });

  it("starts an automatic search once 15 minutes have passed", async () => {
    freezeTime();
    mockDatabase({ searches: [search("done", 20)] });

    expect((await jobSearch.start(7, { auto: true })).started).toBe(true);

    await vi.waitFor(() => expect(finishCall()).toBeTruthy());
  });

  it("doesn't retry an automatic search within 15 minutes of a failure", async () => {
    freezeTime();
    mockDatabase({ searches: [search("failed", 10, { error: "Boom" }), search("done", 60)] });

    expect((await jobSearch.start(7, { auto: true })).started).toBe(false);
  });

  it("rolls back, releases the connection and rethrows when something fails", async () => {
    mockDatabase();
    const normal = client.query.getMockImplementation();

    client.query.mockImplementation(async (sql) => {
      if (sql.includes("INSERT INTO job_searches")) throw new Error("db down");

      return normal(sql);
    });

    await expect(jobSearch.start(7)).rejects.toThrow("db down");
    expect(client.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0])).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe("failInterrupted", () => {
  it("fails every search left running", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValue(rows());

    await jobSearch.failInterrupted();

    expect(query.mock.calls[0][0]).toContain("The search was interrupted. Please try again.");
    expect(query.mock.calls[0][0]).toContain("WHERE status = 'running'");
  });
});

describe("shortlist", () => {
  // Mocks the postings in the database and returns the shortlist for them
  async function shortlistOf(postings, { prefs = PREFS, applications = [], known = [], cv = CV } = {}) {
    vi.spyOn(db, "query").mockResolvedValue(rows(...postings));

    return jobSearch.shortlist(cv, prefs, applications, known);
  }

  // Lists the IDs of a shortlist
  const ids = (list) => list.map((item) => item.id);

  it("asks only for postings from the last days the feeds keep", async () => {
    await shortlistOf([]);

    expect(db.query.mock.calls[0][1]).toEqual([feeds.MAX_AGE_DAYS]);
  });

  it("keeps postings that fit the roles and the area", async () => {
    expect(ids(await shortlistOf([posting(1), posting(2, { location: "Haifa" })]))).toEqual([1, 2]);
  });

  it.each([
    ["is outside the wanted area", { location: "Berlin, Germany" }],
    ["has a title that doesn't fit the roles", { title: "Product Designer" }],
    ["is at a workplace type that isn't wanted", { workplace_model: "On-site" }]
  ])("leaves out a posting that %s", async (_title, extra) => {
    const prefs = { ...PREFS, workplace_models: ["Remote", "Hybrid"] };

    expect(await shortlistOf([posting(1, extra)], { prefs })).toEqual([]);
  });

  it("works out the workplace type from the location when the posting has none", async () => {
    const prefs = { ...PREFS, workplace_models: ["Remote"] };
    const result = await shortlistOf([posting(1, { location: "Hybrid - Tel Aviv, Israel" }), posting(2, { location: "Remote" })], { prefs });

    expect(ids(result)).toEqual([2]);
  });

  it("leaves out postings that are too senior for the wanted level", async () => {
    const titles = ["Senior Backend Engineer", "Backend Engineer Lead", "Staff Backend Engineer"];
    const postings = titles.map((title, index) => posting(index + 1, { title }));

    expect(await shortlistOf(postings, { prefs: { ...PREFS, seniority: "Junior" } })).toEqual([]);
    expect(ids(await shortlistOf(postings, { prefs: { ...PREFS, seniority: "Mid" } }))).toEqual([1, 2]);
  });

  it("leaves out junior postings for a senior candidate", async () => {
    const postings = [posting(1, { title: "Junior Backend Engineer" }), posting(2, { title: "Backend Engineer Intern" }), posting(3)];

    expect(ids(await shortlistOf(postings, { prefs: { ...PREFS, seniority: "Senior" } }))).toEqual([3]);
  });

  it("leaves out postings the user already has, by link or as the same job", async () => {
    const postings = [posting(1), posting(2), posting(3), posting(4)];
    const result = await shortlistOf(postings, {
      applications: [{ company: "Company 1", position: "Backend Engineer" }],
      known: [{ company: "Company 2", position: "Backend Engineer", url: "https://other.example.com/2" }, { company: "Other", position: "Other", url: "https://example.com/jobs/3" }]
    });

    expect(ids(result)).toEqual([4]);
  });

  it("ranks postings by title fit, matching skills and how near they are", async () => {
    const cv = { ...CV, skills: [{ category: "All", items: ["JavaScript", "Python", "SQL", "Docker"] }] };
    const manySkills = posting(1, { location: "Haifa", description: "JavaScript Python SQL Docker" });
    const nearest = posting(2, { location: "Tel Aviv, Israel" });
    const oneSkill = posting(3, { location: "Haifa", description: "Python" });
    const noSkills = posting(4, { location: "Haifa" });
    const weakTitle = posting(5, { title: "Software Engineer" });

    expect(ids(await shortlistOf([weakTitle, noSkills, oneSkill, nearest, manySkills], { cv }))).toEqual([1, 2, 3, 4, 5]);
  });

  it("prefers recent postings", async () => {
    const recent = posting(1, { company: "Recent", location: "Haifa", posted_at: new Date(Date.now() - 24 * 3600 * 1000) });
    const old = posting(2, { company: "Old", location: "Haifa", posted_at: new Date(Date.now() - 60 * 24 * 3600 * 1000) });

    expect(ids(await shortlistOf([old, recent]))).toEqual([1, 2]);
  });

  it("prefers junior titles for a junior candidate, and avoids senior ones for a mid-level candidate", async () => {
    const junior = posting(1, { company: "A", title: "Junior Backend Engineer", location: "Haifa" });
    const plain = posting(2, { company: "B", location: "Haifa" });
    const senior = posting(3, { company: "C", title: "Senior Backend Engineer", location: "Haifa" });

    expect(ids(await shortlistOf([plain, junior], { prefs: { ...PREFS, seniority: "Junior" } }))).toEqual([1, 2]);
    expect(ids(await shortlistOf([senior, plain], { prefs: { ...PREFS, seniority: "Mid" } }))).toEqual([2, 3]);
  });

  it("keeps only the best of postings for the same job at the same company", async () => {
    const result = await shortlistOf([
      posting(1, { company: "Acme", location: "Haifa", url: "https://example.com/jobs/a" }),
      posting(2, { company: "Acme", location: "Tel Aviv, Israel", url: "https://example.com/jobs/b" })
    ]);

    expect(ids(result)).toEqual([2]);
  });

  it("keeps at most 40 candidates", async () => {
    const postings = Array.from({ length: 60 }, (_, index) => posting(index + 1));

    expect(await shortlistOf(postings)).toHaveLength(40);
  });

  it("falls back to the resume's headline when no roles are set", async () => {
    const prefs = { ...PREFS, roles: [] };

    expect(ids(await shortlistOf([posting(1), posting(2, { title: "Product Designer" })], { prefs }))).toEqual([1]);
  });
});

describe("score", () => {
  const usage = () => ({ input: 0, output: 0, searches: 0, fetches: 0 });

  // Mocks Claude's scores for the postings
  function mockScores(results, tokens = { input_tokens: 100, output_tokens: 20 }) {
    return vi.spyOn(claude, "send").mockResolvedValue({ stop_reason: "end_turn", usage: tokens, content: [{ type: "text", text: JSON.stringify({ results }) }] });
  }

  // Builds one of Claude's results
  function result(id, extra = {}) {
    return { id: String(id), score: 70, have: [], missing: [], ...extra };
  }

  it("sends the resume, the preferences and each posting to the cheap model, without the fallback", async () => {
    const send = mockScores([]);

    await jobSearch.score(CV, PREFS, [posting(1, { description: "We need 3 years of experience with APIs" })], usage());

    const [params, options] = send.mock.calls[0];
    const content = params.messages[0].content;

    expect(params.model).toBe("claude-haiku-5-5");
    expect(options).toEqual({ fallback: false, timeoutMs: 120000 });
    expect(content).toContain("Dana Levi - Backend Engineer");
    expect(content).toContain("Looking for: Backend Engineer. Seniority: Any.");
    expect(content).toContain("Professional work experience: about 1 years.");
    expect(content).toContain("<posting id=\"1\">\nBackend Engineer at Company 1 (Tel Aviv, Israel)\nWe need experience with APIs\n</posting>");
  });

  it("tells Claude when the candidate has no work experience", async () => {
    const send = mockScores([]);

    await jobSearch.score({ ...CV, experience: [] }, { ...PREFS, roles: [] }, [posting(1)], usage());

    expect(send.mock.calls[0][0].messages[0].content).toContain("Professional work experience: none (see projects and education).");
    expect(send.mock.calls[0][0].messages[0].content).toContain("Looking for: roles that fit the resume.");
  });

  it("shortens long descriptions, keeping the intro and the requirements", async () => {
    const send = mockScores([]);
    const description = `${"Intro words. ".repeat(100)}Requirements: ${"Node.js and Python. ".repeat(100)}`;

    await jobSearch.score(CV, PREFS, [posting(1, { description })], usage());

    const excerpt = /<posting id="1">\n.*\n(.*)\n<\/posting>/.exec(send.mock.calls[0][0].messages[0].content)[1];

    expect(excerpt.length).toBeLessThanOrEqual(1405);
    expect(excerpt).toContain(" … Requirements: Node.js");
    expect(excerpt.startsWith("Intro words.")).toBe(true);
  });

  it("returns the scored postings with their details, and adds up the tokens used", async () => {
    mockScores([result(1, { score: 82, have: ["Python"], missing: ["Kubernetes"] })]);
    const tokens = usage();
    const candidates = [posting(1, { workplace_model: "Hybrid", posted_at: new Date("2026-10-01T00:00:00Z") })];
    const [scored] = await jobSearch.score(CV, PREFS, candidates, tokens);

    expect(scored).toEqual({
      company: "Company 1",
      position: "Backend Engineer",
      location: "Tel Aviv, Israel",
      workplace_model: "Hybrid",
      url: "https://example.com/jobs/1",
      description: "Build APIs",
      posted_at: new Date("2026-10-01T00:00:00Z"),
      match_score: 82,
      match_have: ["Python"],
      match_missing: ["Kubernetes"]
    });
    expect(tokens).toMatchObject({ input: 100, output: 20 });
  });

  it("ignores results for postings that weren't sent", async () => {
    mockScores([result(1), result(99), null]);

    expect(await jobSearch.score(CV, PREFS, [posting(1)], usage())).toHaveLength(1);
  });

  it.each([
    ["rounds", 82.6, 83],
    ["caps at 100", 140, 100],
    ["floors at 0", -20, 0],
    ["treats a non-number as 0", "high", 0]
  ])("%s the score", async (_title, raw, expected) => {
    mockScores([result(1, { score: raw })]);

    expect((await jobSearch.score(CV, PREFS, [posting(1)], usage()))[0].match_score).toBe(expected);
  });

  it("cleans the lists of skills: trimmed, at most 60 characters each, without empty ones", async () => {
    mockScores([result(1, { have: [" Python ", "", "x".repeat(100)], missing: ["  Kubernetes  "] })]);
    const [scored] = await jobSearch.score(CV, PREFS, [posting(1)], usage());

    expect(scored.match_have).toEqual(["Python", "x".repeat(60)]);
    expect(scored.match_missing).toEqual(["Kubernetes"]);
  });

  it("keeps at most 8 skills in each list", async () => {
    mockScores([result(1, { have: Array.from({ length: 12 }, (_, index) => `Tool ${index}`), missing: Array.from({ length: 12 }, (_, index) => `Gap ${index}`) })]);
    const [scored] = await jobSearch.score(CV, PREFS, [posting(1)], usage());

    expect(scored.match_have).toHaveLength(8);
    expect(scored.match_missing).toHaveLength(8);
  });

  it("drops vague experience claims that name no number", async () => {
    mockScores([result(1, { have: ["Python", "Production experience", "3+ years experience"], missing: ["domain experience", "Kubernetes"] })]);
    const [scored] = await jobSearch.score(CV, PREFS, [posting(1)], usage());

    expect(scored.match_have).toEqual(["Python", "3+ years experience"]);
    expect(scored.match_missing).toEqual(["Kubernetes"]);
  });

  it("moves a missing skill the resume already shows over to the skills it has", async () => {
    mockScores([result(1, { have: ["REST APIs"], missing: ["JavaScript", "Kubernetes"] })]);
    const [scored] = await jobSearch.score(CV, PREFS, [posting(1)], usage());

    expect(scored.match_have).toEqual(["REST APIs", "JavaScript"]);
    expect(scored.match_missing).toEqual(["Kubernetes"]);
  });

  it("raises a good score to the share of requirements met", async () => {
    mockScores([result(1, { score: 70, have: ["a", "b", "c"], missing: ["d"] })]);

    expect((await jobSearch.score(CV, PREFS, [posting(1)], usage()))[0].match_score).toBe(75);
  });

  it("doesn't raise a weak score", async () => {
    mockScores([result(1, { score: 40, have: ["a", "b", "c"], missing: [] })]);

    expect((await jobSearch.score(CV, PREFS, [posting(1)], usage()))[0].match_score).toBe(40);
  });

  it("lowers the score for work experience the candidate lacks, and lists it as missing", async () => {
    mockScores([result(1, { score: 80, have: ["Python"], missing: ["Kubernetes"] })]);
    const candidate = posting(1, { description: "3 years of work experience building backend systems" });
    const [scored] = await jobSearch.score(CV, PREFS, [candidate], usage());

    expect(scored.match_score).toBe(68);
    expect(scored.match_missing).toEqual(["3+ years work experience", "Kubernetes"]);
  });

  it("doesn't list the experience twice when Claude already did", async () => {
    mockScores([result(1, { score: 80, have: ["Python"], missing: ["3+ years experience"] })]);
    const candidate = posting(1, { description: "3 years of work experience building backend systems" });
    const [scored] = await jobSearch.score(CV, PREFS, [candidate], usage());

    expect(scored.match_missing).toEqual(["3+ years experience"]);
  });

  it("doesn't lower the score when the candidate has enough experience", async () => {
    mockScores([result(1, { score: 80, have: ["Python"], missing: ["Kubernetes"] })]);
    const candidate = posting(1, { description: "1 year of work experience" });

    expect((await jobSearch.score(CV, PREFS, [candidate], usage()))[0].match_score).toBe(80);
  });

  it("scores with the stand-in in development, without calling Claude", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const send = vi.spyOn(claude, "send");
    const [scored] = await jobSearch.score(CV, PREFS, [posting(1, { description: "Python and Docker" })], usage());

    expect(send).not.toHaveBeenCalled();
    expect(scored.match_have).toContain("Python");
  });
});

describe("run", () => {
  let handlers;

  // Mocks the database, returning the given postings and recording what is written
  function mockDatabase({ profile = { cv: CV, preferences: PREFS }, postings = [], applications = [], known = [], recheck = [] } = {}) {
    handlers = { inserted: [] };
    vi.spyOn(db, "query").mockImplementation(async (sql, params) => {
      if (sql.includes("SELECT cv, preferences FROM cv_profiles")) return profile ? rows(profile) : rows();
      if (sql.includes("SELECT company, position FROM applications")) return rows(...applications);
      if (sql.includes("SELECT company, position, url FROM jobs")) return rows(...known);
      if (sql.includes("SELECT id, url FROM jobs")) return rows(...recheck);
      if (sql.includes("FROM job_postings")) return rows(...postings);
      if (sql.includes("INSERT INTO jobs")) handlers.inserted.push(params);

      return rows();
    });
  }

  // Mocks Claude scoring every posting with the same score
  function mockScoring(scoreFor = () => 80) {
    return vi.spyOn(claude, "send").mockImplementation(async (params) => {
      const sent = [...params.messages[0].content.matchAll(/<posting id="(\d+)">/g)].map((match) => match[1]);

      return {
        stop_reason: "end_turn",
        usage: { input_tokens: 1000, output_tokens: 200 },
        content: [{ type: "text", text: JSON.stringify({ results: sent.map((id) => ({ id, score: scoreFor(Number(id)), have: ["Python"], missing: ["Kubernetes"] })) }) }]
      };
    });
  }

  // Finds the call that records how the search ended
  function finishParams() {
    return db.query.mock.calls.find(([sql]) => sql.includes("SET status = $2"))[1];
  }

  beforeEach(() => {
    vi.spyOn(feeds, "ensureFresh").mockResolvedValue();
    vi.spyOn(feeds, "markClosed").mockResolvedValue();
    vi.spyOn(postingCheck, "statuses").mockImplementation(async (urls) => new Map(urls.map((url) => [url, "open"])));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("finds jobs, stores the good ones and records how many were found and what it cost", async () => {
    mockDatabase({ postings: [posting(1), posting(2)] });
    mockScoring((id) => (id === 1 ? 90 : 60));

    await jobSearch.run(7, 55);

    expect(feeds.ensureFresh).toHaveBeenCalledOnce();
    expect(handlers.inserted.map((params) => [params[2], params[8]])).toEqual([["Company 1", 90], ["Company 2", 60]]);
    expect(handlers.inserted[0].slice(0, 3)).toEqual([7, 55, "Company 1"]);
    expect(handlers.inserted[0].slice(9, 11)).toEqual([JSON.stringify(["Python"]), JSON.stringify(["Kubernetes"])]);
    expect(finishParams()).toEqual([55, "done", null, 2, 1000, 200, 0, 0]);
  });

  it("stores the best matches first and leaves out weak ones", async () => {
    mockDatabase({ postings: [posting(1), posting(2), posting(3)] });
    mockScoring((id) => [20, 50, 95][id - 1]);

    await jobSearch.run(7, 55);

    expect(handlers.inserted.map((params) => params[8])).toEqual([95, 50]);
  });

  it("stores at most 15 new jobs", async () => {
    mockDatabase({ postings: Array.from({ length: 30 }, (_, index) => posting(index + 1)) });
    mockScoring();

    await jobSearch.run(7, 55);

    expect(handlers.inserted).toHaveLength(15);
    expect(finishParams()[3]).toBe(15);
  });

  it("drops postings that have closed and reports them", async () => {
    mockDatabase({ postings: [posting(1), posting(2)] });
    mockScoring((id) => (id === 1 ? 90 : 80));
    postingCheck.statuses.mockImplementation(async (urls) => new Map(urls.map((url) => [url, url.endsWith("/1") ? "closed" : "open"])));

    await jobSearch.run(7, 55);

    expect(handlers.inserted.map((params) => params[2])).toEqual(["Company 2"]);
    expect(feeds.markClosed).toHaveBeenCalledWith(["https://example.com/jobs/1"]);
  });

  it("checks again whether jobs found earlier are still open, and notes when it checked", async () => {
    mockDatabase({ recheck: [{ id: 5, url: "https://example.com/old/1" }, { id: 6, url: "https://boards.greenhouse.io/acme/6" }] });
    postingCheck.statuses.mockImplementation(async (urls) => new Map(urls.map((url) => [url, "closed"])));

    await jobSearch.run(7, 55);

    expect(postingCheck.statuses).toHaveBeenCalledWith(["https://example.com/old/1"]);
    expect(feeds.markClosed).toHaveBeenCalledWith(["https://example.com/old/1"]);
    expect(db.query.mock.calls.find(([sql]) => sql.includes("SET checked_at = NOW()"))[1]).toEqual([7, [5, 6]]);
  });

  it("finishes with nothing found when no posting fits, without calling Claude", async () => {
    mockDatabase({ postings: [posting(1, { location: "Berlin" })] });
    const send = mockScoring();

    await jobSearch.run(7, 55);

    expect(send).not.toHaveBeenCalled();
    expect(finishParams()).toEqual([55, "done", null, 0, 0, 0, 0, 0]);
  });

  it("fails with a message the user can read when there is no resume", async () => {
    mockDatabase({ profile: null });

    await jobSearch.run(7, 55);

    expect(finishParams()).toEqual([55, "failed", "Upload your resume first.", 0, 0, 0, 0, 0]);
  });

  it("shows Claude's own error message when the AI fails", async () => {
    mockDatabase({ postings: [posting(1)] });
    vi.spyOn(claude, "send").mockRejectedValue(new claude.ClaudeError("The AI declined this request."));

    await jobSearch.run(7, 55);

    expect(finishParams().slice(1, 3)).toEqual(["failed", "The AI declined this request."]);
  });

  it("hides the details of other errors", async () => {
    mockDatabase();
    feeds.ensureFresh.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));

    await jobSearch.run(7, 55);

    expect(finishParams().slice(1, 3)).toEqual(["failed", "The search failed. Please try again later."]);
    expect(console.error).toHaveBeenCalled();
  });
});
