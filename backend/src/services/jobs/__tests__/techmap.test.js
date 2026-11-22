import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockDns, mockWeb } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const db = require("../../../config/db");
const techmap = require("../techmap");

const RAW = "https://raw.githubusercontent.com/mluggy/techmap/main";
const TREE = "https://api.github.com/repos/mluggy/techmap/git/trees/main?recursive=1";
const SOFTWARE_LIST = [
  "﻿\"company\",\"category\",\"size\",\"title\",\"level\",\"city\",\"url\",\"updated\"",
  "\"Acme\",\"AI\",\"l\",\"Engineer\",\"Engineer\",\"תל אביב\",\"https://www.comeet.com/jobs/acme/AF.100/engineer/E7.577?utm_source=techmap\",\"2026-11-22\"",
  "\"Beta\",\"AI\",\"s\",\"Engineer\",\"Engineer\",\"חיפה\",\"https://il.linkedin.com/jobs/view/123\",\"2026-11-22\""
].join("\n");
const LISTING = { tree: [{ path: "jobs/software.csv", sha: "s", type: "blob" }] };
const ISRAELI_LEVER_JOBS = [{ id: "a", text: "Eng", categories: { location: "Tel Aviv, Israel" }, hostedUrl: "https://jobs.lever.co/x/a" }];

// Builds a database result with rows
function rows(...list) {
  return { rows: list, rowCount: list.length };
}

// Makes fetch answer each address that starts with a key of the table, with a 404 for any other
function routeFetch(routes) {
  const fetchMock = vi.fn(async (url) => {
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));

    if (!route) {
      return new Response("missing", { status: 404 });
    }

    return typeof route[1] === "string" ? new Response(route[1]) : jsonResponse(route[1]);
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

// Finds the calls that ran a statement containing the text
function callsWith(text) {
  return db.query.mock.calls.filter(([sql]) => sql.includes(text));
}

// Turns the column lists of the batched statements containing the text into rows, sorted
function batchedRows(text) {
  return callsWith(text).flatMap(([, params]) => params[0].map((_, index) => params.map((column) => column[index]))).sort();
}

describe("companyBoards", () => {
  it("reads the company's board IDs, naming the boards after the company, with its name and website", () => {
    const company = {
      name: "Acme", comeetId: "acme/AF.100", greenhouseId: "acme", leverId: "acme-labs",
      careersUrl: "https://acme.com/careers", websiteUrl: "https://acme.com/"
    };

    expect(techmap.companyBoards(company)).toEqual({
      boards: [
        { provider: "greenhouse", token: "acme", company: "Acme" },
        { provider: "lever", token: "acme-labs", company: "Acme" },
        { provider: "comeet", token: "acme/AF.100", company: "Acme" }
      ],
      careersUrl: "https://acme.com/careers",
      name: "Acme",
      website: "https://acme.com/"
    });
  });

  it("takes a board from the careers link, and then has no careers page to check", () => {
    const company = { name: "Beta", careersUrl: "https://apply.workable.com/beta/" };

    expect(techmap.companyBoards(company)).toMatchObject({ boards: [{ provider: "workable", token: "beta", company: "Beta" }], careersUrl: null });
  });

  it.each([
    ["an inactive company", { name: "Gone", greenhouseId: "gone", isActive: false }, { name: null }],
    ["a careers link that isn't a web link", { name: "Odd", careersUrl: "javascript:alert(1)" }, { name: "Odd" }],
    ["an ID that isn't a board name", { name: "Odd", greenhouseId: "a b" }, { name: "Odd" }],
    ["nothing", null, { name: null }]
  ])("finds no board for %s", (_title, company, expected) => {
    expect(techmap.companyBoards(company)).toMatchObject({ boards: [], careersUrl: null, ...expected });
  });

  it("leaves out links over 500 characters", () => {
    const long = `https://long.com/${"a".repeat(500)}`;

    expect(techmap.companyBoards({ name: "Long", careersUrl: long, websiteUrl: long })).toMatchObject({ careersUrl: null, website: null });
  });
});

describe("findBoards", () => {
  let stored;
  let careersRows;
  let probeRows;

  beforeEach(() => {
    stored = [];
    careersRows = [];
    probeRows = [];
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT path, sha FROM techmap_companies")) return rows(...stored);
      if (sql.includes("SELECT path, careers_url, name, website")) return rows(...careersRows);
      if (sql.includes("SELECT path, name, website")) return rows(...probeRows);

      return rows();
    });
  });

  it("finds the boards that the job lists link to, leaving out other sites", async () => {
    routeFetch({ [TREE]: LISTING, [`${RAW}/jobs/software.csv`]: SOFTWARE_LIST });

    const { listed } = await techmap.findBoards();

    expect(listed).toEqual([{ provider: "comeet", token: "acme/AF.100" }]);
  });

  it("reads every job list the repository's listing names, a new one included, and nothing else", async () => {
    const fetchMock = routeFetch({
      [TREE]: { tree: [...LISTING.tree, { path: "jobs/robotics.csv", sha: "r", type: "blob" }, { path: "jobs/notes.txt", sha: "n", type: "blob" }] },
      [`${RAW}/jobs/robotics.csv`]: "\"Gamma\",\"AI\",\"s\",\"Eng\",\"Eng\",\"חיפה\",\"https://jobs.lever.co/gamma/1\",\"2026-11-22\""
    });

    const { listed } = await techmap.findBoards();

    expect(listed).toEqual([{ provider: "lever", token: "gamma" }]);
    expect(fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes("/jobs/")).sort()).toEqual([`${RAW}/jobs/robotics.csv`, `${RAW}/jobs/software.csv`]);
  });

  it("puts hiring companies first and skips those whose board the lists already give, in the later steps", async () => {
    routeFetch({ [TREE]: LISTING, [`${RAW}/jobs/software.csv`]: SOFTWARE_LIST });

    await techmap.findBoards();

    for (const sql of ["SELECT path, careers_url, name, website", "SELECT path, name, website"]) {
      const [text, params] = callsWith(sql)[0];

      expect(text).toContain("ORDER BY name = ANY($3::text[]) DESC");
      expect(text).toContain("NOT (name = ANY($4::text[]))");
      expect(params.slice(2)).toEqual([["Acme", "Beta"], ["Acme"]]);
    }
  });

  it("reads only the company files that are new or changed, and remembers them", async () => {
    stored = [{ path: "companies/1.json", sha: "same" }, { path: "companies/2.json", sha: "old" }];
    const fetchMock = routeFetch({
      [TREE]: {
        tree: [
          { path: "companies/1.json", sha: "same", type: "blob" },
          { path: "companies/2.json", sha: "new", type: "blob" },
          { path: "companies/3.json", sha: "first", type: "blob" },
          { path: "logos/3.webp", sha: "x", type: "blob" }
        ]
      },
      [`${RAW}/companies/2.json`]: { name: "Two", leverId: "two", websiteUrl: "https://two.io" },
      [`${RAW}/companies/3.json`]: { name: "Three", careersUrl: "https://three.com/jobs" }
    });

    const { listed } = await techmap.findBoards();

    expect(listed).toEqual([{ provider: "lever", token: "two", company: "Two" }]);
    expect(fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes("/companies/")).sort()).toEqual([`${RAW}/companies/2.json`, `${RAW}/companies/3.json`]);
    expect(batchedRows("INSERT INTO techmap_companies")).toEqual([
      ["companies/2.json", "new", null, "Two", "https://two.io/", true],
      ["companies/3.json", "first", "https://three.com/jobs", "Three", null, false]
    ]);
    expect(callsWith("INSERT INTO techmap_companies")[0][0]).toContain("careers_checked_at = NULL, probed_at = NULL");
  });

  it("saves each step's results in one statement, however many companies it handled", async () => {
    careersRows = [{ path: "companies/1.json", careers_url: "https://a.com/careers", name: "A", website: null }, { path: "companies/2.json", careers_url: "https://b.com/careers", name: "B", website: null }];
    probeRows = [{ path: "companies/3.json", name: "C", website: null }, { path: "companies/4.json", name: "D", website: null }];
    routeFetch({
      [TREE]: { tree: [{ path: "companies/5.json", sha: "a", type: "blob" }, { path: "companies/6.json", sha: "b", type: "blob" }] },
      [`${RAW}/companies/5.json`]: { name: "E" },
      [`${RAW}/companies/6.json`]: { name: "F" }
    });
    mockDns();
    mockWeb(() => new Response("no boards here"));
    await techmap.findBoards();

    expect(callsWith("INSERT INTO techmap_companies")).toHaveLength(1);
    expect(callsWith("SET careers_checked_at = NOW()")).toHaveLength(1);
    expect(callsWith("SET probed_at = NOW()")).toHaveLength(1);
  });

  it("forgets company files that were removed", async () => {
    routeFetch({ [TREE]: { tree: [{ path: "companies/1.json", sha: "a", type: "blob" }] }, [`${RAW}/companies/1.json`]: { name: "One" } });

    await techmap.findBoards();

    expect(callsWith("DELETE FROM techmap_companies")[0][1]).toEqual([["companies/1.json"]]);
  });

  it("skips a company file that can't be read", async () => {
    routeFetch({ [TREE]: { tree: [{ path: "companies/1.json", sha: "a", type: "blob" }] }, [`${RAW}/companies/1.json`]: "{not json" });

    expect((await techmap.findBoards()).listed).toEqual([]);
    expect(callsWith("INSERT INTO techmap_companies")).toHaveLength(0);
  });

  it("does nothing with the company files when the list can't be read", async () => {
    routeFetch({});

    expect(await techmap.findBoards()).toEqual({ listed: [], careers: [], probed: [] });
    expect(callsWith("SELECT path, sha")).toHaveLength(0);
  });

  describe("careers pages", () => {
    beforeEach(() => {
      mockDns();
    });

    it("finds the boards on the pages due a check, naming them after the company, and notes each check", async () => {
      careersRows = [
        { path: "companies/1.json", careers_url: "https://acme.com/careers", name: "Acme", website: null },
        { path: "companies/2.json", careers_url: "https://beta.com/jobs", name: "Beta", website: null }
      ];
      routeFetch({});
      mockWeb((url) => (String(url).includes("acme") ? new Response("<a href=\"https://jobs.lever.co/acme\">Jobs</a>") : new Response("down", { status: 500 })));

      const { careers } = await techmap.findBoards();

      expect(careers).toEqual([{ provider: "lever", token: "acme", company: "Acme" }]);
      expect(callsWith("SELECT path, careers_url")[0][1].slice(0, 2)).toEqual([90, 400]);
      expect(batchedRows("SET careers_checked_at = NOW()")).toEqual([
        ["companies/1.json", true],
        ["companies/2.json", false]
      ]);
    });

    it("finds the Comeet board of a widget from the company's likely names", async () => {
      careersRows = [{ path: "companies/1.json", careers_url: "https://www.surecomp.com/careers/", name: "Surecomp", website: "https://surecomp.com" }];
      const position = { uid: "P1", name: "Eng", location: { city: "Tel Aviv", country: "IL" }, url_comeet_hosted_page: "https://www.comeet.com/jobs/surecomp/24.00E/eng/P1" };
      const fetchMock = routeFetch({ "https://www.comeet.com/jobs/surecomp/24.00E": `<script>COMPANY_POSITIONS_DATA = ${JSON.stringify([position])};</script>` });

      mockWeb(() => new Response("<script>var comeetvar = {\"comeet_uid\":\"24.00E\"};</script>"));

      const { careers } = await techmap.findBoards();

      expect(careers).toEqual([{ provider: "comeet", token: "surecomp/24.00E", company: "Surecomp" }]);
      expect(fetchMock.mock.calls.some(([url]) => url === "https://www.comeet.com/jobs/surecomp/24.00E")).toBe(true);
    });
  });

  describe("asking the job systems", () => {
    it("asks for a batch of companies with no board, by their likely names, and notes the result", async () => {
      probeRows = [
        { path: "companies/1.json", name: "Acme Labs", website: "https://acmelabs.io" },
        { path: "companies/2.json", name: "Nobody", website: null }
      ];
      routeFetch({ "https://api.lever.co/v0/postings/acmelabs": ISRAELI_LEVER_JOBS });

      const { probed } = await techmap.findBoards();
      const [sql, params] = callsWith("SELECT path, name, website")[0];

      expect(probed).toEqual([{ provider: "lever", token: "acmelabs", company: "Acme Labs" }]);
      expect(sql).toContain("careers_url IS NULL OR careers_checked_at IS NOT NULL");
      expect(params.slice(0, 2)).toEqual([90, 500]);
      expect(batchedRows("SET probed_at = NOW()")).toEqual([
        ["companies/1.json", true],
        ["companies/2.json", false]
      ]);
    });
  });
});
