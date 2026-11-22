import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockDns, mockFetch, mockWeb } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const db = require("../../../config/db");
const claude = require("../../ai/anthropic");
const logoPrefetch = require("../../logos/logoPrefetch");
const techmap = require("../techmap");
const feeds = require("../jobFeeds");
const { boardIn, boardMoveSet } = require("../jobStates");

const NOW = "2026-10-29T12:00:00Z";

// Freezes the clock, leaving timers alone
function freezeTime() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
}

// Builds a database result with rows
function rows(...list) {
  return { rows: list, rowCount: list.length };
}

// Lists the boards saved with a source, from the batched inserts, as [provider, token, company, source]
function savedBoards(source) {
  return db.query.mock.calls
    .filter(([sql, params]) => sql.includes("INSERT INTO job_boards") && params[3] === source)
    .flatMap(([, params]) => params[0].map((provider, index) => [provider, params[1][index], params[2][index], source]));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("cleanUrl", () => {
  it("removes tracking parameters and the hash, keeping the others", () => {
    expect(feeds.cleanUrl("https://example.com/jobs/1?id=5&utm_source=x&gclid=y&trk=z&ref=r#apply")).toBe("https://example.com/jobs/1?id=5");
  });

  it("leaves a clean link as it is", () => {
    expect(feeds.cleanUrl("https://example.com/jobs/1")).toBe("https://example.com/jobs/1");
  });

  it("returns something that isn't a link unchanged", () => {
    expect(feeds.cleanUrl("not a link")).toBe("not a link");
  });
});

describe("searchRoles", () => {
  it.each([
    ["adds Junior to a role for a junior candidate", ["Backend Engineer"], "Junior", ["Junior Backend Engineer"]],
    ["adds Student to a role for a student", ["Backend Engineer"], "Student", ["Backend Engineer Student"]],
    ["leaves a role that already names a level", ["Junior Backend Engineer", "Graduate Developer"], "Junior", ["Junior Backend Engineer", "Graduate Developer"]],
    ["leaves roles alone for other levels", ["Backend Engineer"], "Senior", ["Backend Engineer"]],
    ["treats developer and engineer as the same role", ["Backend Developer", "Backend Engineer", "backend programmer"], "Any", ["Backend Developer"]],
    ["keeps at most 3 roles", ["A one", "B two", "C three", "D four"], "Any", ["A one", "B two", "C three"]],
    ["trims roles", ["  Data Analyst "], "Any", ["Data Analyst"]]
  ])("%s", (_title, roles, seniority, expected) => {
    expect(feeds.searchRoles(roles, seniority)).toEqual(expected);
  });
});

describe("refreshBoard", () => {
  const BOARD = { id: 4, provider: "greenhouse", token: "melio", company: "Melio" };
  const JSEARCH_BOARD = { id: 9, provider: "jsearch", token: "Backend Engineer in Haifa|il", company: "LinkedIn, Indeed and more" };
  const AREAS = { cities: ["tel aviv"], regions: ["israel"] };
  let closedKnown;
  let closedByDelete;

  // Builds a Greenhouse posting
  function ghJob(id, extra = {}) {
    return { id, title: `Engineer ${id}`, location: { name: "Tel Aviv, Israel" }, absolute_url: `https://boards.greenhouse.io/melio/jobs/${id}`, content: "Do things", first_published: "2026-10-20T00:00:00Z", ...extra };
  }

  // Builds a JSearch posting
  function jsJob(id, extra = {}) {
    return { job_id: id, employer_name: "Acme", job_title: `Engineer ${id}`, job_city: "Haifa", job_country: "IL", job_apply_link: `https://careers.acme.com/${id}`, job_description: "Do things", ...extra };
  }

  // Finds the calls that ran a statement containing the text
  function callsWith(text) {
    return db.query.mock.calls.filter(([sql]) => sql.includes(text));
  }

  beforeEach(() => {
    freezeTime();
    closedKnown = [];
    closedByDelete = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT url FROM closed_postings")) return rows(...closedKnown.map((url) => ({ url })));
      if (sql.includes("RETURNING url")) return rows(...closedByDelete.map((url) => ({ url })));

      return rows();
    });
  });

  it("stores the board's postings, with tidy links and locations, and returns how many", async () => {
    mockFetch(() => jsonResponse({ jobs: [ghJob(1, { absolute_url: "https://boards.greenhouse.io/melio/jobs/1?utm_source=x#apply", location: { name: "Tel Aviv-Yafo (Hybrid)" } }), ghJob(2)] }));

    expect(await feeds.refreshBoard(BOARD)).toBe(2);

    const [sql, params] = callsWith("INSERT INTO job_postings")[0];

    expect(sql).toContain("ON CONFLICT (board_id, external_id) DO UPDATE");
    expect(params.slice(0, 9)).toEqual([
      4,
      ["1", "2"],
      ["Melio", "Melio"],
      ["Engineer 1", "Engineer 2"],
      ["Tel Aviv, Israel", "Tel Aviv, Israel"],
      ["Hybrid", null],
      ["https://boards.greenhouse.io/melio/jobs/1", "https://boards.greenhouse.io/melio/jobs/2"],
      ["Do things", "Do things"],
      ["2026-10-20T00:00:00.000Z", "2026-10-20T00:00:00.000Z"]
    ]);
    expect(params[9]).toEqual(new Date(NOW));
  });

  it("asks the board's API for JSON", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ jobs: [] }));

    await feeds.refreshBoard(BOARD);

    expect(fetchMock.mock.calls[0][0]).toBe("https://boards-api.greenhouse.io/v1/boards/melio/jobs?content=true");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Accept: "application/json", "User-Agent": "ApplicantZero/1.0" });
  });

  it("removes the postings that are no longer on the board, and the jobs found from them", async () => {
    closedByDelete = ["https://boards.greenhouse.io/melio/jobs/99"];
    mockFetch(() => jsonResponse({ jobs: [ghJob(1)] }));
    await feeds.refreshBoard(BOARD);

    const [sql, params] = callsWith("RETURNING url")[0];

    expect(sql).toContain("DELETE FROM job_postings WHERE board_id = $1 AND NOT (external_id = ANY($2::text[]))");
    expect(params).toEqual([4, ["1"]]);
    expect(callsWith("DELETE FROM jobs WHERE source = 'search'")[0][1]).toEqual([["https://boards.greenhouse.io/melio/jobs/99"]]);
  });

  it("records the success and the company's name on the board, switching it back on", async () => {
    mockFetch(() => jsonResponse({ jobs: [ghJob(1, { company_name: "Melio Payments" })] }));
    await feeds.refreshBoard(BOARD);

    const [sql, params] = callsWith("SET failures = 0")[0];

    expect(sql).toContain("last_fetched_at = NOW()");
    expect(sql).toContain(boardMoveSet("succeed"));
    expect(params).toEqual([4, "Melio Payments"]);
  });

  it("skips a posting with no id", async () => {
    const lever = { id: 5, provider: "lever", token: "walkme", company: "Walkme" };

    mockFetch(() => jsonResponse([{ text: "No id", hostedUrl: "https://jobs.lever.co/walkme/x" }, { id: "b", text: "Has id", hostedUrl: "https://jobs.lever.co/walkme/b" }]));

    expect(await feeds.refreshBoard(lever)).toBe(1);
    expect(callsWith("INSERT INTO job_postings")[0][1][1]).toEqual(["b"]);
  });

  it.each([
    ["no title", { title: "" }],
    ["no link", { absolute_url: "" }],
    ["a link that isn't http", { absolute_url: "ftp://example.com/1" }],
    ["a link over 500 characters", { absolute_url: `https://example.com/${"a".repeat(500)}` }]
  ])("skips a posting with %s", async (_title, extra) => {
    mockFetch(() => jsonResponse({ jobs: [ghJob(1, extra), ghJob(2)] }));

    expect(await feeds.refreshBoard(BOARD)).toBe(1);
    expect(callsWith("INSERT INTO job_postings")[0][1][1]).toEqual(["2"]);
  });

  it("skips postings older than 90 days, keeping ones without a date", async () => {
    mockFetch(() => jsonResponse({ jobs: [ghJob(1, { first_published: "2026-06-01T00:00:00Z" }), ghJob(2, { first_published: null }), ghJob(3)] }));

    expect(await feeds.refreshBoard(BOARD)).toBe(2);
    expect(callsWith("INSERT INTO job_postings")[0][1][1]).toEqual(["2", "3"]);
  });

  it("keeps only the postings in the wanted areas, and remote ones with no location", async () => {
    mockFetch(() => jsonResponse({
      jobs: [
        ghJob(1),
        ghJob(2, { location: { name: "Berlin, Germany" } }),
        ghJob(3, { location: { name: "Remote" } }),
        ghJob(4, { location: { name: "" } })
      ]
    }));

    expect(await feeds.refreshBoard(BOARD, AREAS)).toBe(2);
    expect(callsWith("INSERT INTO job_postings")[0][1][1]).toEqual(["1", "3"]);
  });

  it("gives postings with no location the board's usual place, when most of the board is in the wanted areas", async () => {
    mockFetch(() => jsonResponse({
      jobs: [
        ghJob(1),
        ghJob(2),
        ghJob(3, { location: { name: "Haifa, Israel" } }),
        ghJob(4, { location: { name: "" } })
      ]
    }));

    expect(await feeds.refreshBoard(BOARD, AREAS)).toBe(4);

    const params = callsWith("INSERT INTO job_postings")[0][1];

    expect(params[1]).toEqual(["1", "2", "3", "4"]);
    expect(params[4]).toEqual(["Tel Aviv, Israel", "Tel Aviv, Israel", "Haifa, Israel", "Tel Aviv, Israel"]);
  });

  it("keeps a remote posting with no location as remote, without giving it the board's usual place", async () => {
    const lever = { id: 5, provider: "lever", token: "walkme", company: "Walkme" };

    mockFetch(() => jsonResponse([
      { id: "a", text: "Eng", categories: { location: "Tel Aviv, Israel" }, hostedUrl: "https://jobs.lever.co/walkme/a" },
      { id: "b", text: "Eng", workplaceType: "remote", categories: {}, hostedUrl: "https://jobs.lever.co/walkme/b" }
    ]));

    expect(await feeds.refreshBoard(lever, AREAS)).toBe(2);
    expect(callsWith("INSERT INTO job_postings")[0][1][4]).toEqual(["Tel Aviv, Israel", ""]);
  });

  it("leaves postings with no location out when most of the board is elsewhere", async () => {
    mockFetch(() => jsonResponse({
      jobs: [ghJob(1), ghJob(2, { location: { name: "Berlin, Germany" } }), ghJob(3, { location: { name: "Paris, France" } }), ghJob(4, { location: { name: "" } })]
    }));

    expect(await feeds.refreshBoard(BOARD, AREAS)).toBe(1);
    expect(callsWith("INSERT INTO job_postings")[0][1][1]).toEqual(["1"]);
  });

  it("keeps a stored description when the new one is empty", async () => {
    mockFetch(() => jsonResponse({ jobs: [ghJob(1)] }));
    await feeds.refreshBoard(BOARD);

    expect(callsWith("INSERT INTO job_postings")[0][0]).toContain("WHEN EXCLUDED.description = '' THEN job_postings.description");
  });

  it("rewrites a stored posting only when it changed, or to mark it seen after 7 days", async () => {
    mockFetch(() => jsonResponse({ jobs: [ghJob(1)] }));
    await feeds.refreshBoard(BOARD);

    const [sql, params] = callsWith("INSERT INTO job_postings")[0];

    expect(sql).toContain("IS DISTINCT FROM (EXCLUDED.company, EXCLUDED.title, EXCLUDED.location, EXCLUDED.workplace_model,");
    expect(sql).toContain("OR (EXCLUDED.description <> '' AND EXCLUDED.description IS DISTINCT FROM job_postings.description)");
    expect(sql).toContain("OR job_postings.seen_at < $10 - make_interval(days => $11)");
    expect(params[10]).toBe(7);
  });

  it("drops postings still on the board that are no longer kept, without closing the jobs found from them", async () => {
    mockFetch(() => jsonResponse({ jobs: [ghJob(1), ghJob(2, { location: { name: "Berlin, Germany" } })] }));
    await feeds.refreshBoard(BOARD, AREAS);

    const deletes = callsWith("DELETE FROM job_postings WHERE board_id = $1 AND NOT (external_id = ANY($2::text[]))");

    expect(deletes.map(([, params]) => params)).toEqual([[4, ["1", "2"]], [4, ["1"]]]);
    expect(deletes[1][0]).not.toContain("RETURNING");
  });

  it("passes the wanted areas to a system that filters by place itself, and fetches its descriptions the way it needs", async () => {
    mockDns();
    const requestMock = mockWeb(
      () => jsonResponse({ facets: [{ facetParameter: "locationCountry", values: [{ descriptor: "Israel", id: "il", count: 1 }] }] }),
      () => jsonResponse({ jobPostings: [{ title: "Eng", externalPath: "/job/TLV/Eng_R1", locationsText: "Tel Aviv, Israel", postedOn: "Posted Today" }] }),
      () => jsonResponse({ jobPostingInfo: { jobDescription: "<p>Build</p>" } })
    );

    expect(await feeds.refreshBoard({ id: 8, provider: "workday", token: "acme.wd5/Careers", company: "Acme" }, AREAS)).toBe(1);
    expect(JSON.parse(requestMock.mock.results[1].value.body).appliedFacets).toEqual({ locationCountry: ["il"] });
    expect(String(requestMock.mock.calls[2][0])).toBe("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/job/TLV/Eng_R1");
    expect(callsWith("INSERT INTO job_postings")[0][1][7]).toEqual(["Build"]);
  });

  it("reads a Comeet careers page as text", async () => {
    const comeetBoard = { id: 6, provider: "comeet", token: "acme/AF.100", company: "Acme" };
    const position = { uid: "P1", name: "Engineer", location: { city: "Tel Aviv", country: "IL" }, url_comeet_hosted_page: "https://www.comeet.com/jobs/acme/AF.100/engineer/P1" };
    const fetchMock = mockFetch(() => new Response(`<script>COMPANY_POSITIONS_DATA = ${JSON.stringify([position])};</script>`, { status: 200 }));

    expect(await feeds.refreshBoard(comeetBoard)).toBe(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://www.comeet.com/jobs/acme/AF.100");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Accept: "text/html" });
  });

  describe("a board with more than one page", () => {
    const SR_BOARD = { id: 7, provider: "smartrecruiters", token: "Acme", company: "Acme" };

    // Builds a SmartRecruiters posting
    function srJob(id) {
      return { id: String(id), name: `Engineer ${id}`, company: { identifier: "Acme", name: "Acme" }, location: { city: "Tel Aviv", country: "il" } };
    }

    it("reads every page, and fetches the descriptions the list leaves out", async () => {
      const fetchMock = mockFetch(
        () => jsonResponse({ offset: 0, totalFound: 2, content: [srJob(1)] }),
        () => jsonResponse({ offset: 1, totalFound: 2, content: [srJob(2)] }),
        () => jsonResponse({ jobAd: { sections: { jobDescription: { title: "Role", text: "<p>Build</p>" } } } })
      );

      expect(await feeds.refreshBoard(SR_BOARD)).toBe(2);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        "https://api.smartrecruiters.com/v1/companies/Acme/postings?limit=100",
        "https://api.smartrecruiters.com/v1/companies/Acme/postings?limit=100&offset=1",
        "https://api.smartrecruiters.com/v1/companies/Acme/postings/1",
        "https://api.smartrecruiters.com/v1/companies/Acme/postings/2"
      ]);
      expect(callsWith("INSERT INTO job_postings")[0][1][7]).toEqual(["Role\nBuild", "Role\nBuild"]);
    });

    it("doesn't fetch descriptions that are already stored", async () => {
      vi.mocked(db.query).mockImplementation(async (sql) => (sql.includes("SELECT external_id FROM job_postings") ? rows({ external_id: "1" }) : rows()));
      const fetchMock = mockFetch(() => jsonResponse({ offset: 0, totalFound: 1, content: [srJob(1)] }));

      await feeds.refreshBoard(SR_BOARD);

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(callsWith("INSERT INTO job_postings")[0][1][7]).toEqual([""]);
    });

    it("stores a posting whose description can't be fetched, to try again next time", async () => {
      mockFetch(() => jsonResponse({ offset: 0, totalFound: 1, content: [srJob(1)] }), () => new Response("oops", { status: 500 }));

      expect(await feeds.refreshBoard(SR_BOARD)).toBe(1);
      expect(callsWith("INSERT INTO job_postings")[0][1][7]).toEqual([""]);
    });

    it("reads at most 5 pages", async () => {
      const fetchMock = mockFetch(() => jsonResponse({ offset: 0, totalFound: 1000, content: [srJob(1)] }));

      vi.mocked(db.query).mockImplementation(async (sql) => (sql.includes("SELECT external_id FROM job_postings") ? rows({ external_id: "1" }) : rows()));
      await feeds.refreshBoard(SR_BOARD);

      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });

  it("cuts long fields to their limits", async () => {
    mockFetch(() => jsonResponse({ jobs: [ghJob(1, { title: `  ${"t".repeat(300)}  `, content: "d".repeat(7000), company_name: "c".repeat(300) })] }));
    await feeds.refreshBoard(BOARD);

    const params = callsWith("INSERT INTO job_postings")[0][1];

    expect(params[2][0]).toHaveLength(200);
    expect(params[3][0]).toHaveLength(200);
    expect(params[7][0]).toHaveLength(6000);
  });

  it("doesn't store anything when the board has no usable postings", async () => {
    mockFetch(() => jsonResponse({ jobs: [] }));

    expect(await feeds.refreshBoard(BOARD)).toBe(0);
    expect(callsWith("INSERT INTO job_postings")).toHaveLength(0);
    expect(callsWith("SET failures = 0")[0][1]).toEqual([4, null]);
  });

  it("switches off a board that no longer exists, removing its postings", async () => {
    closedByDelete = ["https://boards.greenhouse.io/melio/jobs/1"];
    mockFetch(() => new Response("{}", { status: 404 }));

    expect(await feeds.refreshBoard(BOARD)).toBe(0);
    expect(callsWith(`SET ${boardMoveSet("vanish")}`)[0][1]).toEqual([4]);
    expect(callsWith("DELETE FROM jobs WHERE source = 'search'")[0][1]).toEqual([["https://boards.greenhouse.io/melio/jobs/1"]]);
  });

  it("counts a failure, and switches the board off after the third", async () => {
    mockFetch(() => new Response("oops", { status: 500 }));

    expect(await feeds.refreshBoard(BOARD)).toBe(0);

    const [sql, params] = callsWith("SET failures = failures + 1")[0];

    expect(sql).toContain(boardMoveSet("fail", { stay: "failures + 1 < $2" }));
    expect(params).toEqual([4, 3]);
    expect(console.error).toHaveBeenCalledWith("Job board greenhouse/melio failed:", "HTTP 500");
  });

  it("doesn't count a rate-limited board as failing, and leaves it for its next refresh", async () => {
    mockFetch(() => new Response("slow down", { status: 429 }));

    expect(await feeds.refreshBoard(BOARD)).toBe(0);
    expect(callsWith("SET failures = failures + 1")).toHaveLength(0);
    expect(callsWith("UPDATE job_boards SET last_fetched_at = NOW() WHERE id = $1")[0][1]).toEqual([4]);
  });

  it("counts a failure when the response can't be read", async () => {
    mockFetch(() => new Response("not json", { status: 200 }));

    expect(await feeds.refreshBoard(BOARD)).toBe(0);
    expect(callsWith("SET failures = failures + 1")).toHaveLength(1);
  });

  describe("an aggregator", () => {
    beforeEach(() => {
      vi.stubEnv("JSEARCH_API_KEY", "rapid-key");
    });

    it("sends its key and stores the postings, learning the company boards their links point to", async () => {
      const fetchMock = mockFetch(() => jsonResponse({ data: { jobs: [jsJob(1, { job_apply_link: "https://jobs.lever.co/walkme/abc" }), jsJob(2)] } }));

      expect(await feeds.refreshBoard(JSEARCH_BOARD)).toBe(2);
      expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ "X-RapidAPI-Key": "rapid-key" });
      expect(savedBoards("jsearch")).toEqual([["lever", "walkme", "Walkme", "jsearch"]]);
      expect(callsWith("DELETE FROM job_postings WHERE board_id = $1 AND seen_at < NOW()")[0][1]).toEqual([9, 14]);
    });

    it("skips postings known to be closed, and ones that have expired", async () => {
      closedKnown = ["https://careers.acme.com/1"];
      mockFetch(() => jsonResponse({
        data: {
          jobs: [jsJob(1), jsJob(2, { job_offer_expiration_datetime_utc: "2026-10-01T00:00:00Z" }), jsJob(3, { job_offer_expiration_datetime_utc: "2026-12-01T00:00:00Z" })]
        }
      }));

      expect(await feeds.refreshBoard(JSEARCH_BOARD)).toBe(1);
      expect(callsWith("INSERT INTO job_postings")[0][1][1]).toEqual(["3"]);
    });

    it("doesn't remove postings that are missing from a search, since a search shows only some of them", async () => {
      mockFetch(() => jsonResponse({ data: { jobs: [jsJob(1)] } }));
      await feeds.refreshBoard(JSEARCH_BOARD);

      expect(callsWith("NOT (external_id = ANY")).toHaveLength(0);
    });

    it("treats a missing search as a failure, retrying in an hour", async () => {
      mockFetch(() => new Response("{}", { status: 404 }));

      expect(await feeds.refreshBoard(JSEARCH_BOARD)).toBe(0);

      const [sql, params] = callsWith("SET failures = failures + 1")[0];

      expect(sql).not.toContain("active");
      expect(params).toEqual([9, 24, 1]);
      expect(callsWith(`SET ${boardMoveSet("vanish")}`)).toHaveLength(0);
    });

    it("retries once after 5 seconds when rate limited", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
      vi.setSystemTime(new Date(NOW));
      const fetchMock = mockFetch(() => new Response("slow down", { status: 429 }), () => jsonResponse({ data: { jobs: [jsJob(1)] } }));
      const pending = feeds.refreshBoard(JSEARCH_BOARD);

      await vi.advanceTimersByTimeAsync(4999);

      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);

      expect(await pending).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("gives up when the retry is rate limited too", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
      vi.setSystemTime(new Date(NOW));
      const fetchMock = mockFetch(() => new Response("slow down", { status: 429 }));
      const pending = feeds.refreshBoard(JSEARCH_BOARD);

      await vi.advanceTimersByTimeAsync(5000);

      expect(await pending).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(callsWith("SET failures = failures + 1")).toHaveLength(1);
    });
  });
});

describe("discoveryQueries", () => {
  it("searches every board site for each place, alone and with each role", () => {
    const queries = feeds.discoveryQueries([{ preferences: { roles: ["QA Engineer"], locations: ["Haifa, Israel"] } }]);

    expect(queries).toHaveLength(12);
    expect(queries).toEqual(expect.arrayContaining([
      "site:comeet.com/jobs Israel",
      "site:apply.workable.com \"QA Engineer\" Israel",
      "site:jobs.smartrecruiters.com \"QA Engineer\" Israel"
    ]));
  });

  it("puts the most wanted roles and places first, keeping 6 roles and 2 places", () => {
    const rows = [
      { preferences: { roles: ["A", "B", "C", "D", "E", "F", "G"], locations: ["Haifa", "Tel Aviv, Israel", "Herzliya"] } },
      { preferences: { roles: ["G"], locations: ["Ramat Gan, Israel"] } }
    ];
    const queries = feeds.discoveryQueries(rows);

    expect(queries[0]).toBe("site:job-boards.greenhouse.io Israel");
    expect(queries).toContain("site:jobs.lever.co \"G\" Haifa");
    expect(queries.some((query) => query.includes("\"F\""))).toBe(false);
    expect(queries.some((query) => query.includes("Herzliya"))).toBe(false);
    expect(queries).toHaveLength(2 * 6 * 7);
  });

  it("leaves out places outside the feed regions", () => {
    const queries = feeds.discoveryQueries([{ preferences: { roles: ["QA"], locations: ["Berlin, Germany", "Haifa, Israel"] } }]);

    expect(queries.some((query) => query.includes("Germany"))).toBe(false);
    expect(queries).toContain("site:comeet.com/jobs \"QA\" Israel");
  });

  it("searches the feed regions when no place is in them", () => {
    expect(feeds.discoveryQueries([{ preferences: { roles: [], locations: ["Paris, France"] } }])).toEqual(expect.arrayContaining(["site:jobs.lever.co Israel"]));
  });

  it("searches Israel when no one gave a place", () => {
    expect(feeds.discoveryQueries([])).toEqual(expect.arrayContaining(["site:jobs.ashbyhq.com Israel"]));
  });
});

describe("queriesForRun", () => {
  const QUERIES = Array.from({ length: 30 }, (_, index) => `q${index}`);
  const PERIOD = 72 * 3_600_000;

  it("takes 10 searches a run, moving on to the next ones 3 days later", () => {
    freezeTime();
    const first = feeds.queriesForRun(QUERIES);
    vi.setSystemTime(new Date(Date.now() + PERIOD));
    const next = feeds.queriesForRun(QUERIES);

    expect(first).toHaveLength(10);
    expect(next).toHaveLength(10);
    expect(QUERIES.indexOf(next[0])).toBe((QUERIES.indexOf(first[0]) + 10) % 30);
  });

  it("keeps the same searches within one 3-day period", () => {
    freezeTime();
    vi.setSystemTime(new Date(Math.floor(Date.now() / PERIOD) * PERIOD));
    const first = feeds.queriesForRun(QUERIES);
    vi.setSystemTime(new Date(Date.now() + PERIOD - 1));

    expect(feeds.queriesForRun(QUERIES)).toEqual(first);
  });

  it("covers every search within a few runs", () => {
    freezeTime();
    const seen = new Set();

    for (let run = 0; run < 3; run++) {
      feeds.queriesForRun(QUERIES).forEach((query) => seen.add(query));
      vi.setSystemTime(new Date(Date.now() + PERIOD));
    }

    expect(seen.size).toBe(30);
  });

  it("takes them all when there are fewer than 10", () => {
    expect(feeds.queriesForRun(["a", "b", "c"]).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("markClosed", () => {
  it("does nothing for no links", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValue(rows());

    await feeds.markClosed([]);

    expect(query).not.toHaveBeenCalled();
  });

  it("remembers the closed links, and removes their postings and the jobs found from them", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValue(rows());

    await feeds.markClosed(["https://example.com/1"]);

    expect(query.mock.calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 3).join(" "))).toEqual(["INSERT INTO closed_postings", "DELETE FROM job_postings", "DELETE FROM jobs"]);
    query.mock.calls.forEach(([, params]) => expect(params).toEqual([["https://example.com/1"]]));
  });
});

describe("removeOldPostings", () => {
  it("removes old, unseen and closed postings and old found jobs, returning how many jobs it removed", async () => {
    const query = vi.spyOn(db, "query").mockImplementation(async (sql) => (sql.includes("DELETE FROM jobs") ? { rows: [], rowCount: 3 } : rows()));

    expect(await feeds.removeOldPostings()).toBe(3);
    expect(query.mock.calls.map(([, params]) => params)).toEqual([[90], [14], [90], [90]]);
  });
});

describe("ensureFresh", () => {
  let client;
  let state;

  // Mocks the database: the lock, which tasks are due and the users' preferences
  function mockDatabase({ locked = true, discoveryDue = true, preferences = [], boards = [] } = {}) {
    state = { locked };
    client = {
      query: vi.fn(async (sql) => (sql.includes("pg_try_advisory_lock") ? rows({ locked: state.locked }) : rows())),
      release: vi.fn()
    };
    vi.spyOn(db, "connect").mockResolvedValue(client);
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT updated_at FROM feed_state")) return discoveryDue ? rows() : rows({ updated_at: new Date(Date.now() - 3600 * 1000) });
      if (sql.includes("SELECT preferences FROM cv_profiles")) return rows(...preferences.map((value) => ({ preferences: value })));
      if (sql.includes("FROM job_boards")) return rows(...boards);

      return rows();
    });
  }

  // Finds the calls that ran a statement containing the text
  function callsWith(text) {
    return db.query.mock.calls.filter(([sql]) => sql.includes(text));
  }

  beforeEach(() => {
    freezeTime();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(techmap, "findBoards").mockResolvedValue({ listed: [], careers: [], probed: [] });
  });

  it("does nothing when another server holds the lock, and still releases its connection", async () => {
    mockDatabase({ locked: false });

    await feeds.ensureFresh();

    expect(db.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("adds the users' boards, then refreshes the stale ones and notes the refresh, under the lock, adding no fixed boards", async () => {
    mockDatabase();
    await feeds.ensureFresh();

    expect(client.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 2).join(" "))).toEqual(["SELECT pg_try_advisory_lock($1)", "SELECT pg_advisory_unlock($1)"]);
    expect(savedBoards("seed")).toEqual([]);
    expect(callsWith("UNION SELECT url FROM jobs")).toHaveLength(1);
    expect(callsWith("ORDER BY last_fetched_at NULLS FIRST")).toHaveLength(1);
    expect(callsWith("INSERT INTO feed_state").map(([, params]) => params[0])).toContain("refresh");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("leaves old postings to the daily cleanup", async () => {
    mockDatabase();
    await feeds.ensureFresh();

    expect(callsWith("DELETE FROM job_postings WHERE COALESCE(posted_at, first_seen_at)")).toHaveLength(0);
  });

  it("skips the pass for a search when the feeds were refreshed recently, without taking the lock", async () => {
    mockDatabase({ discoveryDue: false });
    await feeds.ensureFresh({ onlyWhenStale: true });

    expect(callsWith("SELECT updated_at FROM feed_state")[0][1]).toEqual(["refresh"]);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it("runs the pass for a search when the last refresh is old", async () => {
    mockDatabase();
    await feeds.ensureFresh({ onlyWhenStale: true });

    expect(db.connect).toHaveBeenCalledOnce();
    expect(callsWith("ORDER BY last_fetched_at NULLS FIRST")).toHaveLength(1);
  });

  it("learns boards from links in the users' applications", async () => {
    mockDatabase();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes("UNION SELECT url FROM jobs")) return rows({ url: "https://jobs.lever.co/newco/1" }, { url: "https://example.com/other" });

      return rows();
    });
    await feeds.ensureFresh();

    expect(savedBoards("user")).toEqual([["lever", "newco", "Newco", "user"]]);
  });

  it("releases the lock and the connection even when a step fails", async () => {
    mockDatabase();
    db.query.mockRejectedValue(new Error("db down"));

    await expect(feeds.ensureFresh()).rejects.toThrow("db down");
    expect(client.query.mock.calls.some(([sql]) => sql.includes("pg_advisory_unlock"))).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("starts looking up logos after refreshing the boards, without waiting for them", async () => {
    mockDatabase();

    let finish;
    const prefetch = vi.spyOn(logoPrefetch, "prefetchLogos").mockImplementation(() => new Promise((resolve) => {
      finish = resolve;
    }));

    await feeds.ensureFresh();

    expect(prefetch).toHaveBeenCalledOnce();
    expect(callsWith("ORDER BY last_fetched_at NULLS FIRST")).toHaveLength(1);
    finish(null);
  });

  it("does not look up logos when another server holds the lock", async () => {
    mockDatabase({ locked: false });

    const prefetch = vi.spyOn(logoPrefetch, "prefetchLogos").mockResolvedValue(null);

    await feeds.ensureFresh();

    expect(prefetch).not.toHaveBeenCalled();
  });

  it("logs a failed logo lookup and carries on", async () => {
    mockDatabase();
    vi.spyOn(logoPrefetch, "prefetchLogos").mockRejectedValue(new Error("logo down"));

    await expect(feeds.ensureFresh()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith("Logo prefetch failed:", "logo down"));
  });

  it("refreshes only boards that are due, skipping JSearch unless it's set up", async () => {
    mockDatabase();
    await feeds.ensureFresh();

    expect(callsWith("ORDER BY last_fetched_at NULLS FIRST")[0][1]).toEqual([12, false, 30, 300, ["comeet", "jsearch"], [24, 24]]);
  });

  it("tries switched-off company boards again after 30 days, oldest first and at most 300 at a time", async () => {
    mockDatabase();
    await feeds.ensureFresh();

    const [sql] = callsWith("ORDER BY last_fetched_at NULLS FIRST")[0];

    expect(sql).toContain(`WHERE (${boardIn(["on"])}`);
    expect(sql).toContain(`provider <> 'jsearch' AND ${boardIn(["off"])} AND last_fetched_at < NOW() - make_interval(days => $3)`);
    expect(sql).toContain("LIMIT $4");
  });

  describe("the tech map", () => {
    it("adds the boards it finds once a day, naming where they came from", async () => {
      mockDatabase();
      techmap.findBoards.mockResolvedValue({
        listed: [{ provider: "comeet", token: "acme/AF.100", company: "Acme" }],
        careers: [{ provider: "workable", token: "beta" }],
        probed: [{ provider: "lever", token: "gamma", company: "Gamma Labs" }]
      });
      await feeds.ensureFresh();

      // Lists the boards the import saved, in order
      const imported = () => ["techmap", "careers", "probe"].flatMap(savedBoards);

      await vi.waitFor(() => expect(imported()).toHaveLength(3));
      expect(imported()).toEqual([
        ["comeet", "acme/AF.100", "Acme", "techmap"],
        ["workable", "beta", "Beta", "careers"],
        ["lever", "gamma", "Gamma Labs", "probe"]
      ]);
      expect(callsWith("INSERT INTO feed_state").map(([, params]) => params[0])).toContain("techmap");
      expect(console.info).toHaveBeenCalledWith("[feeds] Tech map import: 1 boards from its lists and files, 1 from careers pages, 1 found by name");
    });

    it("doesn't wait for the import before refreshing the boards", async () => {
      mockDatabase();
      techmap.findBoards.mockReturnValue(new Promise(() => {}));
      await feeds.ensureFresh();

      expect(callsWith("ORDER BY last_fetched_at NULLS FIRST")).toHaveLength(1);
    });

    it("logs a failed import, carries on, and marks it as not done so the next refresh tries again", async () => {
      mockDatabase();
      techmap.findBoards.mockRejectedValue(new Error("relation \"techmap_companies\" does not exist"));

      await expect(feeds.ensureFresh()).resolves.toBeUndefined();
      await vi.waitFor(() => expect(callsWith("DELETE FROM feed_state")).toHaveLength(1));
      expect(console.error).toHaveBeenCalledWith("Tech map import failed:", "relation \"techmap_companies\" does not exist");
      expect(callsWith("DELETE FROM feed_state")[0][1]).toEqual(["techmap"]);
    });

    it("leaves the import marked as done when it succeeds", async () => {
      mockDatabase();
      techmap.findBoards.mockResolvedValue({ listed: [], careers: [], probed: [{ provider: "workable", token: "last" }] });
      await feeds.ensureFresh();

      await vi.waitFor(() => expect(savedBoards("probe").some(([, token]) => token === "last")).toBe(true));
      expect(callsWith("DELETE FROM feed_state")).toHaveLength(0);
    });

    it("doesn't import again within a day", async () => {
      mockDatabase({ discoveryDue: false });
      await feeds.ensureFresh();

      expect(techmap.findBoards).not.toHaveBeenCalled();
    });

    it("doesn't import when the feeds don't collect the region the tech map covers", async () => {
      const region = techmap.REGION;
      techmap.REGION = "Atlantis";
      mockDatabase();
      await feeds.ensureFresh();
      techmap.REGION = region;

      expect(techmap.findBoards).not.toHaveBeenCalled();
    });

    it("doesn't import in development", async () => {
      vi.stubEnv("NODE_ENV", "development");
      mockDatabase();
      await feeds.ensureFresh();

      expect(techmap.findBoards).not.toHaveBeenCalled();
    });
  });

  it("refreshes the stale boards it finds and fetches each once", async () => {
    mockDatabase({ boards: [{ id: 1, provider: "greenhouse", token: "melio", company: "Melio" }, { id: 2, provider: "lever", token: "walkme", company: "Walkme" }] });
    const fetchMock = mockFetch(() => jsonResponse({ jobs: [] }));

    await feeds.ensureFresh();

    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(["https://api.lever.co/v0/postings/walkme?mode=json", "https://boards-api.greenhouse.io/v1/boards/melio/jobs?content=true"]);
  });

  it("logs one line about the refresh: boards, postings kept and boards with none", async () => {
    mockDatabase({ boards: [{ id: 1, provider: "greenhouse", token: "melio", company: "Melio" }, { id: 2, provider: "lever", token: "walkme", company: "Walkme" }] });
    vi.stubGlobal("fetch", vi.fn(async (url) => (url.includes("greenhouse")
      ? jsonResponse({ jobs: [{ id: 1, title: "Eng", location: { name: "Tel Aviv, Israel" }, absolute_url: "https://x.com/1", content: "" }] })
      : jsonResponse([]))));
    await feeds.ensureFresh();

    expect(console.info).toHaveBeenCalledWith("[feeds] Refreshed 2 boards: 1 postings in the wanted areas, 1 boards with none (or failed)");
  });

  it("logs nothing about the refresh when no board was due", async () => {
    mockDatabase();
    await feeds.ensureFresh();

    expect(console.info.mock.calls.filter(([line]) => line.startsWith("[feeds] Refreshed"))).toHaveLength(0);
  });

  it("only keeps postings in the feed regions, whatever places users want", async () => {
    mockDatabase({
      preferences: [{ locations: ["Berlin, Germany"] }],
      boards: [{ id: 1, provider: "greenhouse", token: "melio", company: "Melio" }]
    });
    mockFetch(() => jsonResponse({
      jobs: [
        { id: 1, title: "Eng", location: { name: "Haifa, Israel" }, absolute_url: "https://x.com/1", content: "" },
        { id: 2, title: "Eng", location: { name: "Berlin, Germany" }, absolute_url: "https://x.com/2", content: "" }
      ]
    }));
    await feeds.ensureFresh();

    expect(callsWith("INSERT INTO job_postings")[0][1][1]).toEqual(["1"]);
  });

  describe("JSearch boards", () => {
    beforeEach(() => {
      vi.stubEnv("JSEARCH_API_KEY", "rapid-key");
    });

    it("turns on searches for the users' roles and places, and switches off the rest", async () => {
      mockDatabase({ preferences: [{ roles: ["Backend Engineer"], locations: ["Tel Aviv, Israel"], seniority: "Junior" }] });
      await feeds.ensureFresh();

      const tokens = callsWith("VALUES ('jsearch'").map(([, params]) => params[0]);

      expect(tokens).toEqual(["Junior Backend Engineer in Tel Aviv, Israel|il", "Junior Backend Engineer in Israel|il"]);
      expect(callsWith(`SET ${boardMoveSet("unwant")}\n     WHERE provider = 'jsearch'`)[0][1]).toEqual([tokens.map((token) => token.toLowerCase())]);
      expect(callsWith("VALUES ('jsearch'")[0][0]).toContain(boardMoveSet("want", { table: "job_boards" }));
    });

    it("searches in Israel when users gave no place, and ranks searches by how many users want them", async () => {
      mockDatabase({ preferences: [{ roles: ["Data Analyst"], locations: [] }, { roles: ["Data Analyst"], locations: [] }, { roles: ["QA Engineer"], locations: [] }] });
      await feeds.ensureFresh();

      expect(callsWith("VALUES ('jsearch'").map(([, params]) => params[0])).toEqual(["Data Analyst in Israel|il", "QA Engineer in Israel|il"]);
    });

    it("searches only the users' places in the feed regions, and the regions when none is", async () => {
      mockDatabase({ preferences: [{ roles: ["QA Engineer"], locations: ["Berlin, Germany", "Haifa, Israel"] }, { roles: ["Data Analyst"], locations: ["Paris, France"] }] });
      await feeds.ensureFresh();

      expect(callsWith("VALUES ('jsearch'").map(([, params]) => params[0])).toEqual([
        "QA Engineer in Haifa, Israel|il",
        "QA Engineer in Israel|il",
        "Data Analyst in Israel|il"
      ]);
    });

    it("refreshes JSearch boards when they're due", async () => {
      mockDatabase({ boards: [{ id: 9, provider: "jsearch", token: "Data Analyst in Israel|il", company: "x" }] });
      mockFetch(() => jsonResponse({ data: { jobs: [] } }));
      await feeds.ensureFresh();

      expect(callsWith("ORDER BY last_fetched_at NULLS FIRST")[0][1]).toEqual([12, true, 30, 300, ["comeet", "jsearch"], [24, 24]]);
      expect(fetch).toHaveBeenCalledOnce();
    });
  });

  describe("finding new boards with Claude", () => {
    beforeEach(() => {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    });

    // Mocks Claude's web search results
    function mockSearch(...replies) {
      const send = vi.spyOn(claude, "send");

      replies.forEach((reply) => send.mockResolvedValueOnce(reply));

      return send;
    }

    // Builds a reply with search results for the given links
    function results(urls, stopReason = "end_turn") {
      return { stop_reason: stopReason, content: [{ type: "web_search_tool_result", content: urls.map((url) => ({ url })) }] };
    }

    it("searches for the users' roles and place, and saves the boards it finds", async () => {
      mockDatabase({ preferences: [{ roles: ["Backend Engineer"], locations: ["Haifa, Israel"] }] });
      const send = mockSearch(results(["https://jobs.lever.co/found/1", "https://example.com/x"]));

      await feeds.ensureFresh();

      const [params, options] = send.mock.calls[0];

      expect(params.messages[0].content.match(/^- site:/gm)).toHaveLength(10);
      expect(params.messages[0].content).toMatch(/- site:\S+ (?:"Backend Engineer" )?Israel/);
      expect(params.tools[0]).toMatchObject({ name: "web_search", max_uses: 10 });
      expect(options).toEqual({ fallback: false, timeoutMs: 180000 });
      expect(savedBoards("claude")).toEqual([["lever", "found", "Found", "claude"]]);
      expect(callsWith("INSERT INTO feed_state")[0][1]).toEqual(["discovery"]);
    });

    it("searches Israel when users have no preferences", async () => {
      mockDatabase();
      const send = mockSearch(results([]));

      await feeds.ensureFresh();

      expect(send.mock.calls[0][0].messages[0].content.match(/^- .*$/gm)).toEqual(expect.arrayContaining(["- site:jobs.lever.co Israel"]));
    });

    it("keeps going while Claude pauses, for at most 3 turns", async () => {
      mockDatabase();
      const send = mockSearch(results(["https://jobs.lever.co/a/1"], "pause_turn"), results(["https://jobs.lever.co/b/1"], "pause_turn"), results(["https://jobs.lever.co/c/1"], "pause_turn"), results(["https://jobs.lever.co/d/1"]));

      await feeds.ensureFresh();

      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls[0][0].messages.map((message) => message.role)).toEqual(["user", "assistant", "assistant", "assistant"]);
      expect(savedBoards("claude").map(([, token]) => token)).toEqual(["a", "b", "c"]);
    });

    it("searches every 3 days, not again within 72 hours", async () => {
      mockDatabase({ discoveryDue: false });
      const send = mockSearch(results([]));

      await feeds.ensureFresh();

      expect(send).not.toHaveBeenCalled();
    });

    it("carries on, and notes it tried, when the search fails", async () => {
      mockDatabase();
      vi.spyOn(claude, "send").mockRejectedValue(new Error("overloaded"));

      await feeds.ensureFresh();

      expect(console.error).toHaveBeenCalledWith("Job board discovery failed:", "overloaded");
      expect(callsWith("INSERT INTO feed_state").filter(([, params]) => params[0] === "discovery")).toHaveLength(1);
      expect(callsWith("ORDER BY last_fetched_at NULLS FIRST")).toHaveLength(1);
    });

    it("doesn't search in development", async () => {
      vi.stubEnv("NODE_ENV", "development");
      mockDatabase();
      const send = mockSearch(results([]));

      await feeds.ensureFresh();

      expect(send).not.toHaveBeenCalled();
    });
  });

  it("doesn't search for boards without an API key", async () => {
    mockDatabase();
    const send = vi.spyOn(claude, "send");

    await feeds.ensureFresh();

    expect(send).not.toHaveBeenCalled();
  });
});
