import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const db = require("../../../config/db");
const claude = require("../../ai/anthropic");
const feeds = require("../jobFeeds");

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

afterEach(() => {
  vi.useRealTimers();
});

describe("prettyName", () => {
  it.each([
    ["melio", "Melio"],
    ["wynd-labs", "Wynd Labs"],
    ["HUMAN", "HUMAN"],
    ["my_company.io", "My Company Io"],
    ["Via", "Via"]
  ])("turns %s into %s", (token, expected) => {
    expect(feeds.prettyName(token)).toBe(expected);
  });
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

describe("boardsIn", () => {
  it("finds the job boards that links in the text point to", () => {
    const text = [
      "https://boards.greenhouse.io/melio/jobs/123",
      "https://job-boards.greenhouse.io/embed/job_board?for=Similarweb",
      "https://jobs.lever.co/walkme/abc-123",
      "https://jobs.ashbyhq.com/wynd-labs/uuid"
    ].join("\n");

    expect(feeds.boardsIn(text)).toEqual([
      { provider: "greenhouse", token: "melio" },
      { provider: "greenhouse", token: "Similarweb" },
      { provider: "lever", token: "walkme" },
      { provider: "ashby", token: "wynd-labs" }
    ]);
  });

  it("lists each board once, whatever the case", () => {
    expect(feeds.boardsIn("https://jobs.lever.co/Acme/1 https://jobs.lever.co/acme/2")).toHaveLength(1);
  });

  it("decodes encoded tokens and skips words that aren't company names", () => {
    expect(feeds.boardsIn("https://jobs.ashbyhq.com/My%20Co/1")).toEqual([]);
    expect(feeds.boardsIn("https://boards.greenhouse.io/embed/x https://boards.greenhouse.io/jobs/x")).toEqual([]);
    expect(feeds.boardsIn("https://jobs.ashbyhq.com/a%2Eb/1")).toEqual([{ provider: "ashby", token: "a.b" }]);
  });

  it.each([null, undefined, "", "no links here"])("finds nothing in %j", (text) => {
    expect(feeds.boardsIn(text)).toEqual([]);
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

describe("PROVIDERS", () => {
  const board = { company: "Melio" };

  describe("greenhouse", () => {
    const { greenhouse } = feeds.PROVIDERS;

    it("builds the board link", () => {
      expect(greenhouse.url("melio")).toBe("https://boards-api.greenhouse.io/v1/boards/melio/jobs?content=true");
    });

    it("reads the postings, turning the escaped HTML description into text", () => {
      const data = {
        jobs: [{
          id: 1,
          company_name: "Melio Payments",
          title: "Backend Engineer",
          location: { name: "Tel Aviv, Israel (Hybrid)" },
          absolute_url: "https://boards.greenhouse.io/melio/jobs/1",
          content: "&lt;p&gt;Build &amp;amp; run&lt;/p&gt;",
          first_published: "2026-10-01T10:00:00Z"
        }]
      };

      expect(greenhouse.parse(data, board)).toEqual([{
        externalId: "1",
        company: "Melio Payments",
        title: "Backend Engineer",
        location: "Tel Aviv, Israel (Hybrid)",
        workplace: "Hybrid",
        url: "https://boards.greenhouse.io/melio/jobs/1",
        description: "Build & run",
        postedAt: "2026-10-01T10:00:00.000Z"
      }]);
    });

    it("uses the board's company name and an empty location when the posting has none", () => {
      const [job] = greenhouse.parse({ jobs: [{ id: 2, title: "Eng", absolute_url: "https://x.com/2", updated_at: "not a date" }] }, board);

      expect(job).toMatchObject({ company: "Melio", location: "", workplace: null, postedAt: null });
    });

    it.each([null, {}, { jobs: null }])("reads %j as no postings", (data) => {
      expect(greenhouse.parse(data, board)).toEqual([]);
    });
  });

  describe("lever", () => {
    const { lever } = feeds.PROVIDERS;

    it("builds the board link", () => {
      expect(lever.url("walkme")).toBe("https://api.lever.co/v0/postings/walkme?mode=json");
    });

    it("reads the postings, joining the locations and the parts of the description", () => {
      const data = [{
        id: "abc",
        text: "Data Engineer",
        categories: { allLocations: ["Tel Aviv", "Remote"], location: "Tel Aviv" },
        workplaceType: "hybrid",
        hostedUrl: "https://jobs.lever.co/walkme/abc",
        descriptionPlain: "About the role",
        lists: [{ text: "Requirements", content: "<li>Python</li>" }],
        additionalPlain: "Perks",
        createdAt: 1760000000000
      }];

      expect(lever.parse(data, board)).toEqual([{
        externalId: "abc",
        company: "Melio",
        title: "Data Engineer",
        location: "Tel Aviv / Remote",
        workplace: "Hybrid",
        url: "https://jobs.lever.co/walkme/abc",
        description: "About the role\n\nRequirements\n- Python\n\nPerks",
        postedAt: new Date(1760000000000).toISOString()
      }]);
    });

    it("falls back to the single location, and finds the workplace in its text", () => {
      const [job] = lever.parse([{ id: "a", text: "Eng", categories: { location: "Remote, Israel" }, hostedUrl: "https://x.com/a" }], board);

      expect(job).toMatchObject({ location: "Remote, Israel", workplace: "Remote" });
    });

    it.each([null, {}, "text"])("reads %j as no postings", (data) => {
      expect(lever.parse(data, board)).toEqual([]);
    });
  });

  describe("ashby", () => {
    const { ashby } = feeds.PROVIDERS;

    it("builds the board link, encoding the token", () => {
      expect(ashby.url("wynd labs")).toBe("https://api.ashbyhq.com/posting-api/job-board/wynd%20labs?includeCompensation=false");
    });

    it("reads the listed postings, joining their locations", () => {
      const data = {
        jobs: [
          { id: "1", title: "Engineer", location: "Tel Aviv", secondaryLocations: [{ location: "Haifa" }], workplaceType: "OnSite", jobUrl: "https://jobs.ashbyhq.com/x/1", descriptionPlain: "Plain text", publishedAt: "2026-10-02T00:00:00Z" },
          { id: "2", title: "Hidden", isListed: false, jobUrl: "https://jobs.ashbyhq.com/x/2" }
        ]
      };

      expect(ashby.parse(data, board)).toEqual([{
        externalId: "1",
        company: "Melio",
        title: "Engineer",
        location: "Tel Aviv / Haifa",
        workplace: "On-site",
        url: "https://jobs.ashbyhq.com/x/1",
        description: "Plain text",
        postedAt: "2026-10-02T00:00:00.000Z"
      }]);
    });

    it("marks remote postings and reads the HTML description when there is no plain one", () => {
      const [job] = ashby.parse({ jobs: [{ id: "1", title: "Eng", isRemote: true, descriptionHtml: "<p>Hello</p>", jobUrl: "https://x.com/1" }] }, board);

      expect(job).toMatchObject({ workplace: "Remote", description: "Hello" });
    });
  });

  describe("jsearch", () => {
    const { jsearch } = feeds.PROVIDERS;
    const job = {
      job_id: "j1",
      employer_name: "Acme",
      job_title: "Backend Engineer",
      job_city: "Haifa",
      job_state: "",
      job_country: "IL",
      job_is_remote: false,
      job_apply_link: "https://indeed.com/apply/1",
      apply_options: [{ is_direct: false, apply_link: "https://linkedin.com/jobs/1" }, { is_direct: true, apply_link: "https://careers.acme.com/1" }],
      job_description: "Responsibilities:\n\nBuild APIs",
      job_posted_at_timestamp: 1760000000,
      job_offer_expiration_timestamp: 1770000000
    };

    it("is marked as an aggregator", () => {
      expect(jsearch.aggregator).toBe(true);
    });

    it("builds the search link from the token", () => {
      expect(jsearch.url("Backend Engineer in Haifa, Israel|il")).toBe(
        "https://jsearch.p.rapidapi.com/search-v2?query=Backend+Engineer+in+Haifa%2C+Israel&page=1&num_pages=1&date_posted=month&country=il"
      );
      expect(jsearch.url("Backend Engineer in Haifa|")).not.toContain("country=");
    });

    it("sends the API key", () => {
      vi.stubEnv("JSEARCH_API_KEY", "rapid-key");

      expect(jsearch.headers()).toEqual({ "X-RapidAPI-Key": "rapid-key", "X-RapidAPI-Host": "jsearch.p.rapidapi.com" });
    });

    it("reads the postings from either response shape, preferring the direct apply link", () => {
      const expected = {
        externalId: "j1",
        company: "Acme",
        title: "Backend Engineer",
        location: "Haifa, Israel",
        workplace: null,
        url: "https://careers.acme.com/1",
        description: "Responsibilities:\nBuild APIs",
        expiresAt: new Date(1770000000 * 1000).toISOString(),
        postedAt: new Date(1760000000 * 1000).toISOString()
      };

      expect(jsearch.parse({ data: { jobs: [job] } })).toEqual([expected]);
      expect(jsearch.parse({ data: [job] })).toEqual([expected]);
    });

    it("falls back to the general apply link and the given location text", () => {
      const [parsed] = jsearch.parse({ data: { jobs: [{ ...job, apply_options: [], job_city: "", job_country: "", job_location: "Somewhere, Earth" }] } });

      expect(parsed).toMatchObject({ url: "https://indeed.com/apply/1", location: "Somewhere, Earth" });
    });

    it("marks remote jobs, and reads the workplace from the title otherwise", () => {
      expect(jsearch.parse({ data: [{ ...job, job_is_remote: true }] })[0].workplace).toBe("Remote");
      expect(jsearch.parse({ data: [{ ...job, job_title: "Engineer (Hybrid)" }] })[0].workplace).toBe("Hybrid");
    });

    it("joins words that were split across lines in the description", () => {
      expect(jsearch.parse({ data: [{ ...job, job_description: "a good engi\nneer wanted" }] })[0].description).toBe("a good engineer wanted");
    });

    it.each([null, {}, { data: {} }, { data: { jobs: "x" } }])("reads %j as no postings", (data) => {
      expect(jsearch.parse(data)).toEqual([]);
    });
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

    const [sql, params] = callsWith("AND NOT (external_id = ANY")[0];

    expect(sql).toContain("DELETE FROM job_postings");
    expect(params).toEqual([4, new Date(NOW), ["1"]]);
    expect(callsWith("DELETE FROM jobs WHERE source = 'search'")[0][1]).toEqual([["https://boards.greenhouse.io/melio/jobs/99"]]);
  });

  it("records the success and the company's name on the board", async () => {
    mockFetch(() => jsonResponse({ jobs: [ghJob(1, { company_name: "Melio Payments" })] }));
    await feeds.refreshBoard(BOARD);

    const [sql, params] = callsWith("SET failures = 0")[0];

    expect(sql).toContain("last_fetched_at = NOW()");
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
    expect(callsWith("SET active = FALSE")[0][1]).toEqual([4]);
    expect(callsWith("DELETE FROM jobs WHERE source = 'search'")[0][1]).toEqual([["https://boards.greenhouse.io/melio/jobs/1"]]);
  });

  it("counts a failure, and switches the board off after the third", async () => {
    mockFetch(() => new Response("oops", { status: 500 }));

    expect(await feeds.refreshBoard(BOARD)).toBe(0);

    const [sql, params] = callsWith("SET failures = failures + 1")[0];

    expect(sql).toContain("active = failures + 1 < $2");
    expect(params).toEqual([4, 3]);
    expect(console.error).toHaveBeenCalledWith("Job board greenhouse/melio failed:", "HTTP 500");
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
      expect(callsWith("INSERT INTO job_boards")[0][1]).toEqual(["lever", "walkme", "Walkme", "discovered"]);
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

      expect(sql).not.toContain("active =");
      expect(params).toEqual([9, 24, 1]);
      expect(callsWith("SET active = FALSE")).toHaveLength(0);
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
  });

  it("does nothing when another server holds the lock, and still releases its connection", async () => {
    mockDatabase({ locked: false });

    await feeds.ensureFresh();

    expect(db.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("cleans up, adds the starting boards and the users' boards, then refreshes the stale ones, under the lock", async () => {
    mockDatabase();
    await feeds.ensureFresh();

    expect(client.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 2).join(" "))).toEqual(["SELECT pg_try_advisory_lock($1)", "SELECT pg_advisory_unlock($1)"]);
    expect(callsWith("DELETE FROM job_postings")).toHaveLength(2);
    expect(callsWith("INSERT INTO job_boards").filter(([, params]) => params[3] === "seed")).toHaveLength(14);
    expect(callsWith("UNION SELECT url FROM jobs")).toHaveLength(1);
    expect(callsWith("WHERE active AND")).toHaveLength(1);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("learns boards from links in the users' applications", async () => {
    mockDatabase();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes("UNION SELECT url FROM jobs")) return rows({ url: "https://jobs.lever.co/newco/1" }, { url: "https://example.com/other" });

      return rows();
    });
    await feeds.ensureFresh();

    expect(callsWith("INSERT INTO job_boards").find(([, params]) => params[3] === "user")[1]).toEqual(["lever", "newco", "Newco", "user"]);
  });

  it("releases the lock and the connection even when a step fails", async () => {
    mockDatabase();
    db.query.mockRejectedValue(new Error("db down"));

    await expect(feeds.ensureFresh()).rejects.toThrow("db down");
    expect(client.query.mock.calls.some(([sql]) => sql.includes("pg_advisory_unlock"))).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("refreshes only boards that are due, skipping JSearch unless it's set up", async () => {
    mockDatabase();
    await feeds.ensureFresh();

    expect(callsWith("WHERE active AND")[0][1]).toEqual([6, 24, false]);
  });

  it("refreshes the stale boards it finds and fetches each once", async () => {
    mockDatabase({ boards: [{ id: 1, provider: "greenhouse", token: "melio", company: "Melio" }, { id: 2, provider: "lever", token: "walkme", company: "Walkme" }] });
    const fetchMock = mockFetch(() => jsonResponse({ jobs: [] }));

    await feeds.ensureFresh();

    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual(["https://api.lever.co/v0/postings/walkme?mode=json", "https://boards-api.greenhouse.io/v1/boards/melio/jobs?content=true"]);
  });

  it("only keeps postings from the areas users want", async () => {
    mockDatabase({
      preferences: [{ locations: ["Tel Aviv, Israel"] }],
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
      expect(callsWith("SET active = FALSE\n     WHERE provider = 'jsearch'")[0][1]).toEqual([tokens.map((token) => token.toLowerCase())]);
    });

    it("searches in Israel when users gave no place, and ranks searches by how many users want them", async () => {
      mockDatabase({ preferences: [{ roles: ["Data Analyst"], locations: [] }, { roles: ["Data Analyst"], locations: [] }, { roles: ["QA Engineer"], locations: [] }] });
      await feeds.ensureFresh();

      expect(callsWith("VALUES ('jsearch'").map(([, params]) => params[0])).toEqual(["Data Analyst in Israel|il", "QA Engineer in Israel|il"]);
    });

    it("refreshes JSearch boards when they're due", async () => {
      mockDatabase({ boards: [{ id: 9, provider: "jsearch", token: "Data Analyst in Israel|il", company: "x" }] });
      mockFetch(() => jsonResponse({ data: { jobs: [] } }));
      await feeds.ensureFresh();

      expect(callsWith("WHERE active AND")[0][1]).toEqual([6, 24, true]);
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

      expect(params.messages[0].content).toContain("- site:jobs.lever.co Israel");
      expect(params.messages[0].content).toContain("- site:jobs.ashbyhq.com \"Backend Engineer\" Israel");
      expect(params.tools[0]).toMatchObject({ name: "web_search", max_uses: 6 });
      expect(options).toEqual({ fallback: false, timeoutMs: 180000 });
      expect(callsWith("INSERT INTO job_boards").find(([, values]) => values[3] === "discovered")[1]).toEqual(["lever", "found", "Found", "discovered"]);
      expect(callsWith("INSERT INTO feed_state")[0][1]).toEqual(["discovery"]);
    });

    it("searches Israel when users have no preferences", async () => {
      mockDatabase();
      const send = mockSearch(results([]));

      await feeds.ensureFresh();

      expect(send.mock.calls[0][0].messages[0].content).toContain("- site:job-boards.greenhouse.io Israel");
    });

    it("keeps going while Claude pauses, for at most 3 turns", async () => {
      mockDatabase();
      const send = mockSearch(results(["https://jobs.lever.co/a/1"], "pause_turn"), results(["https://jobs.lever.co/b/1"], "pause_turn"), results(["https://jobs.lever.co/c/1"], "pause_turn"), results(["https://jobs.lever.co/d/1"]));

      await feeds.ensureFresh();

      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls[0][0].messages.map((message) => message.role)).toEqual(["user", "assistant", "assistant", "assistant"]);
      expect(callsWith("INSERT INTO job_boards").filter(([, values]) => values[3] === "discovered").map(([, values]) => values[1])).toEqual(["a", "b", "c"]);
    });

    it("searches once a day, not again within 24 hours", async () => {
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
      expect(callsWith("INSERT INTO feed_state")).toHaveLength(1);
      expect(callsWith("WHERE active AND")).toHaveLength(1);
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
