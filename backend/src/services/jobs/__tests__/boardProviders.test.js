import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockDns, mockFetch, mockWeb } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const { PROVIDERS, fetchData, fetchPostings, sleep } = require("../boardProviders");

afterEach(() => {
  vi.useRealTimers();
});

describe("PROVIDERS", () => {
  it("names exactly the systems the database allows", () => {
    const schema = readFileSync(new URL("../../../../schema.sql", import.meta.url), "utf8");
    const checks = [...schema.matchAll(/job_boards_provider_check\s+CHECK \(provider IN \(([^)]*)\)\)/g)];
    const allowed = checks.at(-1)[1].split(",").map((name) => name.trim().replace(/'/g, ""));

    expect(allowed.sort()).toEqual(Object.keys(PROVIDERS).sort());
  });

  it.each(Object.entries(PROVIDERS).filter(([, entry]) => !entry.aggregator))("gives %s the sites its boards live on and a way to find them", (_name, entry) => {
    expect(entry.hosts.length).toBeGreaterThan(0);
    expect(entry.links.length).toBeGreaterThan(0);
  });

  const board = { company: "Melio" };

  describe("greenhouse", () => {
    const { greenhouse } = PROVIDERS;

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
    const { lever } = PROVIDERS;

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
    const { ashby } = PROVIDERS;

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

  describe("comeet", () => {
    const { comeet } = PROVIDERS;
    const position = {
      uid: "AC.F50",
      name: "Backend Engineer",
      company_name: "TripleTen",
      location: { name: "Tel Aviv office", city: "Tel Aviv-Yafo", country: "IL", is_remote: false },
      workplace_type: "Hybrid",
      url_comeet_hosted_page: "https://www.comeet.com/jobs/tripleten/98.008/backend-engineer/AC.F50",
      custom_fields: { details: [{ name: "Description", value: "<p>Build \"APIs\" [fast]</p>" }, { name: "Requirements", value: "<li>Node.js</li>" }] },
      time_updated: "2026-10-20T12:00:00Z",
      is_internal: false
    };

    // Builds a careers page that declares its data first and fills it in later, as Comeet's pages do
    function page(positions) {
      return [
        "<html><script>var COMPANY_DATA ;\nvar COMPANY_POSITIONS_DATA ;\nvar POSITION_DATA ;",
        `COMPANY_DATA = {"name": "x"};\nCOMPANY_POSITIONS_DATA = ${JSON.stringify(positions)};\nvar OTHER = [1];</script></html>`
      ].join("\n");
    }

    it("is read as a page, from the company's careers page", () => {
      expect(comeet.format).toBe("html");
      expect(comeet.url("tripleten/98.008")).toBe("https://www.comeet.com/jobs/tripleten/98.008");
    });

    it("reads the positions from the page's script, joining the parts of the description", () => {
      expect(comeet.parse(page([position]), board)).toEqual([{
        externalId: "AC.F50",
        company: "TripleTen",
        title: "Backend Engineer",
        location: "Tel Aviv-Yafo, Israel",
        workplace: "Hybrid",
        url: "https://www.comeet.com/jobs/tripleten/98.008/backend-engineer/AC.F50",
        description: "Description\nBuild \"APIs\" [fast]\n\nRequirements\n- Node.js",
        postedAt: "2026-10-20T12:00:00.000Z"
      }]);
    });

    it("skips internal positions, and marks a remote location as remote", () => {
      const jobs = comeet.parse(page([
        { ...position, is_internal: true },
        { ...position, uid: "B", workplace_type: null, location: { name: "Anywhere", is_remote: true } }
      ]), board);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ externalId: "B", location: "Anywhere", workplace: "Remote", company: "TripleTen" });
    });

    it.each([
      ["a page without positions", "<html></html>"],
      ["a page whose positions can't be read", "COMPANY_POSITIONS_DATA = [{\"uid\": }]"],
      ["a page cut off in the middle", "COMPANY_POSITIONS_DATA = [{\"uid\": \"A\""],
      ["a page whose positions aren't a list", "COMPANY_POSITIONS_DATA = {\"name\": \"x\"};"],
      ["nothing", null]
    ])("reads %s as no postings", (_title, html) => {
      expect(comeet.parse(html, board)).toEqual([]);
    });
  });

  describe("workable", () => {
    const { workable } = PROVIDERS;
    const job = {
      shortcode: "81B46579FE",
      title: "ML Engineer",
      shortlink: "https://apply.workable.com/j/81B46579FE",
      url: "https://apply.workable.com/acme/j/81B46579FE/",
      locations: [{ city: "Tel Aviv", country: "Israel", hidden: false }, { city: "Secret", country: "Nowhere", hidden: true }],
      telecommuting: false,
      description: "<p>Train models</p>",
      published_on: "2026-10-05"
    };

    it("builds the board link, with the descriptions", () => {
      expect(workable.url("hugging face")).toBe("https://apply.workable.com/api/v1/widget/accounts/hugging%20face?details=true");
    });

    it("reads the postings, leaving out hidden locations", () => {
      expect(workable.parse({ name: "Acme AI", jobs: [job] }, board)).toEqual([{
        externalId: "81B46579FE",
        company: "Acme AI",
        title: "ML Engineer",
        location: "Tel Aviv, Israel",
        workplace: null,
        url: "https://apply.workable.com/j/81B46579FE",
        description: "Train models",
        postedAt: "2026-10-05T00:00:00.000Z"
      }]);
    });

    it("falls back to the posting's own place and the board's name, and marks remote postings", () => {
      const [parsed] = workable.parse({ jobs: [{ ...job, locations: [], city: "Haifa", country: "Israel", telecommuting: true }] }, board);

      expect(parsed).toMatchObject({ company: "Melio", location: "Haifa, Israel", workplace: "Remote" });
    });

    it.each([null, {}, { jobs: null }])("reads %j as no postings", (data) => {
      expect(workable.parse(data, board)).toEqual([]);
    });
  });

  describe("smartrecruiters", () => {
    const { smartrecruiters } = PROVIDERS;
    const job = {
      id: "7440001",
      name: "Data Analyst",
      company: { identifier: "Acme", name: "Acme Inc" },
      location: { city: "Tel Aviv", country: "il", remote: false, hybrid: true },
      releasedDate: "2026-10-28T15:14:43.941Z",
      visibility: "PUBLIC"
    };

    it("builds the board link", () => {
      expect(smartrecruiters.url("Acme")).toBe("https://api.smartrecruiters.com/v1/companies/Acme/postings?limit=100");
    });

    it("reads the postings, leaving the description for later", () => {
      expect(smartrecruiters.parse({ content: [job, { ...job, id: "2", visibility: "INTERNAL" }] }, board)).toEqual([{
        externalId: "7440001",
        company: "Acme Inc",
        title: "Data Analyst",
        location: "Tel Aviv, Israel",
        workplace: "Hybrid",
        url: "https://jobs.smartrecruiters.com/Acme/7440001",
        description: "",
        postedAt: "2026-10-28T15:14:43.941Z"
      }]);
    });

    it("names the country once when the city field holds it too", () => {
      const [parsed] = smartrecruiters.parse({ content: [{ ...job, location: { city: "Poland", country: "pl", remote: true } }] }, board);

      expect(parsed).toMatchObject({ location: "Poland", workplace: "Remote" });
    });

    it.each([
      ["the next page while postings remain", { offset: 0, content: [job], totalFound: 150 }, "https://api.smartrecruiters.com/v1/companies/Acme/postings?limit=100&offset=1"],
      ["no page after the last", { offset: 100, content: [job], totalFound: 101 }, null],
      ["no page after an empty one", { offset: 0, content: [], totalFound: 5 }, null]
    ])("asks for %s", (_title, data, expected) => {
      expect(smartrecruiters.nextUrl(data, "Acme")).toBe(expected);
    });

    it("reads a posting's description from its sections, leaving out the company's", () => {
      const data = {
        jobAd: {
          sections: {
            companyDescription: { title: "About us", text: "<p>We are great</p>" },
            jobDescription: { title: "The role", text: "<p>Analyze data</p>" },
            qualifications: { title: "You have", text: "<ul><li>SQL</li></ul>" },
            additionalInformation: { text: "" }
          }
        }
      };

      expect(smartrecruiters.details.url({ externalId: "7440001" }, { token: "Acme" })).toBe("https://api.smartrecruiters.com/v1/companies/Acme/postings/7440001");
      expect(smartrecruiters.details.parse(data)).toBe("The role\nAnalyze data\n\nYou have\n- SQL");
    });
  });

  describe("recruitee", () => {
    const { recruitee } = PROVIDERS;
    const offer = {
      id: 2832667,
      title: "Backend Engineer",
      company_name: "bunq",
      location: "Amsterdam, Noord-Holland, Netherlands",
      careers_url: "https://bunq.recruitee.com/o/backend-engineer",
      remote: false,
      hybrid: false,
      on_site: true,
      description: "<p>Build</p>",
      requirements: "<p>Go</p>",
      published_at: "2026-11-18 16:23:32 UTC",
      status: "published"
    };

    it("builds the board link", () => {
      expect(recruitee.url("bunq")).toBe("https://bunq.recruitee.com/api/offers/");
    });

    it("reads the published offers, joining the description and the requirements", () => {
      expect(recruitee.parse({ offers: [offer, { ...offer, id: 2, status: "closed" }] }, board)).toEqual([{
        externalId: "2832667",
        company: "bunq",
        title: "Backend Engineer",
        location: "Amsterdam, Noord-Holland, Netherlands",
        workplace: "On-site",
        url: "https://bunq.recruitee.com/o/backend-engineer",
        description: "Build\n\nGo",
        postedAt: "2026-11-18T16:23:32.000Z"
      }]);
    });

    it("builds the location from the city and country when there is no location text", () => {
      const [parsed] = recruitee.parse({ offers: [{ ...offer, location: "", city: "Haifa", country: "Israel", on_site: false, remote: true }] }, board);

      expect(parsed).toMatchObject({ location: "Haifa, Israel", workplace: "Remote" });
    });

    it.each([null, {}, { offers: null }])("reads %j as no postings", (data) => {
      expect(recruitee.parse(data, board)).toEqual([]);
    });
  });

  describe("bamboohr", () => {
    const { bamboohr } = PROVIDERS;
    const bambooBoard = { token: "acme", company: "Acme" };

    it("builds the board link", () => {
      expect(bamboohr.url("acme")).toBe("https://acme.bamboohr.com/careers/list");
    });

    it("reads the openings, leaving the description for later", () => {
      const data = { result: [{ id: "33", jobOpeningName: "Backend Engineer", location: { city: "Tel Aviv", state: null }, atsLocation: { country: "Israel" }, isRemote: null }] };

      expect(bamboohr.parse(data, bambooBoard)).toEqual([{
        externalId: "33",
        company: "Acme",
        title: "Backend Engineer",
        location: "Tel Aviv, Israel",
        workplace: null,
        url: "https://acme.bamboohr.com/careers/33",
        description: "",
        postedAt: null
      }]);
    });

    it("reads an opening's description", () => {
      expect(bamboohr.details.url({ externalId: "33" }, bambooBoard)).toBe("https://acme.bamboohr.com/careers/33/detail");
      expect(bamboohr.details.parse({ result: { jobOpening: { description: "<p>Build APIs</p>" } } })).toBe("Build APIs");
    });

    it.each([
      ["BambooHR's home page", "https://www.bamboohr.com/", true],
      ["the company's own careers page", "https://acme.bamboohr.com/careers/list", false]
    ])("treats a redirect to %s as gone: %s", (_title, url, expected) => {
      expect(bamboohr.redirectGone(url, "acme")).toBe(expected);
    });

    it.each([null, {}, { result: null }])("reads %j as no openings", (data) => {
      expect(bamboohr.parse(data, bambooBoard)).toEqual([]);
    });
  });

  describe("comeet's redirect", () => {
    it.each([
      ["Comeet's home page", "https://www.comeet.com/", true],
      ["the company's page", "https://www.comeet.com/jobs/acme/af.100", false]
    ])("treats a redirect to %s as gone: %s", (_title, url, expected) => {
      expect(PROVIDERS.comeet.redirectGone(url, "acme/AF.100")).toBe(expected);
    });
  });

  describe("jsearch", () => {
    const { jsearch } = PROVIDERS;
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

describe("fetchData", () => {
  it("reads JSON, asking for it with the app's name", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ ok: 1 }));

    expect(await fetchData("https://example.com/a", { headers: { "X-Key": "k" } })).toEqual({ data: { ok: 1 } });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Accept: "application/json", "Accept-Language": "en-US", "User-Agent": "ApplicantZero/1.0", "X-Key": "k" });
  });

  it("reads a page as text", async () => {
    const fetchMock = mockFetch(() => new Response("<html>hi</html>"));

    expect(await fetchData("https://example.com/a", { format: "html" })).toEqual({ data: "<html>hi</html>" });
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe("text/html");
  });

  it("reports a 404 as gone", async () => {
    mockFetch(() => new Response("missing", { status: 404 }));

    expect(await fetchData("https://example.com/a")).toEqual({ gone: true });
  });

  it("sends a body as JSON with POST", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ ok: 1 }));

    await fetchData("https://example.com/a", { body: { limit: 1 } });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: "{\"limit\":1}", headers: { "Content-Type": "application/json" } });
  });

  it("reports a redirect as gone only when the system says it means that", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, ok: true, redirected: true, url: "https://home.example/", json: async () => ({ ok: 1 }) })));

    expect(await fetchData("https://example.com/a", { redirectGone: (url) => url.startsWith("https://home.example") })).toEqual({ gone: true });
    expect(await fetchData("https://example.com/a", { redirectGone: () => false })).toEqual({ data: { ok: 1 } });
    expect(await fetchData("https://example.com/a")).toEqual({ data: { ok: 1 } });
  });

  it("sends a request through the safe fetch when asked, reading its JSON and its redirects", async () => {
    mockDns();
    // Answers each of the two fetches with a redirect to a home page, then that page
    const redirectThenPage = [() => new Response(null, { status: 302, headers: { location: "https://home.example/" } }), () => jsonResponse({ ok: 1 })];
    const requestMock = mockWeb(...redirectThenPage, ...redirectThenPage);

    expect(await fetchData("https://example.com/a", { safe: true, body: { limit: 1 }, redirectGone: () => false })).toEqual({ data: { ok: 1 } });
    expect(requestMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(requestMock.mock.results[0].value.body).toBe("{\"limit\":1}");
    expect(await fetchData("https://example.com/a", { safe: true, redirectGone: (url) => url === "https://home.example/" })).toEqual({ gone: true });
  });

  it("throws on other errors, with the status", async () => {
    mockFetch(() => new Response("oops", { status: 503 }));

    await expect(fetchData("https://example.com/a")).rejects.toMatchObject({ message: "HTTP 503", status: 503 });
  });
});

describe("fetchPostings", () => {
  const board = { token: "melio", company: "Melio" };

  it("reads the postings of a board with one page", async () => {
    mockFetch(() => jsonResponse({ jobs: [{ id: 1, title: "Eng", absolute_url: "https://x.com/1" }] }));

    const { gone, jobs } = await fetchPostings(PROVIDERS.greenhouse, board);

    expect(gone).toBe(false);
    expect(jobs.map((job) => job.externalId)).toEqual(["1"]);
  });

  it("reports a board that's gone", async () => {
    mockFetch(() => new Response("missing", { status: 404 }));

    expect(await fetchPostings(PROVIDERS.lever, board)).toEqual({ gone: true, jobs: [] });
  });

  it.each([
    ["asks for the smaller list when only checking a board", PROVIDERS.greenhouse, "https://boards-api.greenhouse.io/v1/boards/melio/jobs"],
    ["asks for the full list of a system without a smaller one", PROVIDERS.lever, "https://api.lever.co/v0/postings/melio?mode=json"]
  ])("%s", async (_title, provider, expected) => {
    const fetchMock = mockFetch(() => jsonResponse({ jobs: [] }));

    await fetchPostings(provider, board, null, { light: true });

    expect(fetchMock.mock.calls[0][0]).toBe(expected);
  });

  describe("a Workday board", () => {
    const WORKDAY = { token: "acme.wd5/Careers", company: "Acme" };
    const AREAS = { cities: [], regions: ["israel", "tel aviv"] };
    // Workday's filters, with the location ones grouped inside one filter, as real boards send them
    const FACETS = [
      { facetParameter: "jobFamilyGroup", values: [{ descriptor: "Israel Team", id: "f1", count: 99 }] },
      {
        facetParameter: "locationMainGroup",
        values: [
          { facetParameter: "locations", descriptor: "Locations", values: [{ descriptor: "Tel Aviv, Israel", id: "tlv", count: 3 }, { descriptor: "Austin, TX", id: "aus", count: 50 }] },
          { facetParameter: "locationCountry", descriptor: "Countries", values: [{ descriptor: "Israel", id: "il", count: 5 }] }
        ]
      }
    ];

    beforeEach(() => {
      mockDns();
    });

    // Builds a Workday posting
    function wdJob(index, extra = {}) {
      return { title: `Engineer ${index}`, externalPath: `/job/Tel-Aviv/Engineer_R${index}`, locationsText: "Tel Aviv, Israel", postedOn: "Posted 3 Days Ago", ...extra };
    }

    // Lists the JSON bodies the requests sent
    function sentBodies(requestMock) {
      return requestMock.mock.results.map(({ value }) => JSON.parse(value.body));
    }

    it("reads the location filters, then only the jobs in the filter that holds the most of the wanted areas, through the safe fetch", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-22T15:00:00Z"));
      const requestMock = mockWeb(
        () => jsonResponse({ total: 900, facets: FACETS, jobPostings: [] }),
        () => jsonResponse({ total: 2, jobPostings: [wdJob(1), wdJob(2, { locationsText: "2 Locations", postedOn: "Posted Today" })] })
      );

      const { gone, jobs } = await fetchPostings(PROVIDERS.workday, WORKDAY, AREAS);

      expect(gone).toBe(false);
      expect(String(requestMock.mock.calls[1][0])).toBe("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/jobs");
      expect(requestMock.mock.calls[1][1].method).toBe("POST");
      expect(sentBodies(requestMock)[1]).toEqual({ appliedFacets: { locationCountry: ["il"] }, limit: 20, offset: 0, searchText: "" });
      expect(jobs).toEqual([
        { externalId: "/job/Tel-Aviv/Engineer_R1", company: "Acme", title: "Engineer 1", location: "Tel Aviv, Israel", workplace: null, url: "https://acme.wd5.myworkdayjobs.com/Careers/job/Tel-Aviv/Engineer_R1", description: "", postedAt: "2026-11-19T00:00:00.000Z" },
        { externalId: "/job/Tel-Aviv/Engineer_R2", company: "Acme", title: "Engineer 2", location: "Israel", workplace: null, url: "https://acme.wd5.myworkdayjobs.com/Careers/job/Tel-Aviv/Engineer_R2", description: "", postedAt: "2026-11-22T00:00:00.000Z" }
      ]);
    });

    it("reads page after page until a short one", async () => {
      const full = Array.from({ length: 20 }, (_, index) => wdJob(index));
      const requestMock = mockWeb(() => jsonResponse({ facets: FACETS }), () => jsonResponse({ jobPostings: full }), () => jsonResponse({ jobPostings: [wdJob(99)] }));

      const { jobs } = await fetchPostings(PROVIDERS.workday, WORKDAY, AREAS);

      expect(jobs).toHaveLength(21);
      expect(sentBodies(requestMock).map((body) => body.offset)).toEqual([0, 0, 20]);
    });

    it("tries a rate-limited request twice more, 5 then 10 seconds later", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      const requestMock = mockWeb(
        () => new Response("slow down", { status: 429 }),
        () => new Response("slow down", { status: 429 }),
        () => jsonResponse({ facets: FACETS }),
        () => jsonResponse({ jobPostings: [wdJob(1)] })
      );
      const pending = fetchPostings(PROVIDERS.workday, WORKDAY, AREAS);

      await vi.advanceTimersByTimeAsync(4999);
      const beforeFirstRetry = requestMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1 + 10_000 + 1000);
      const { jobs } = await pending;

      expect(beforeFirstRetry).toBe(1);
      expect(requestMock).toHaveBeenCalledTimes(4);
      expect(jobs).toHaveLength(1);
    });

    it("reads nothing more when no location filter is in the wanted areas", async () => {
      const requestMock = mockWeb(() => jsonResponse({ facets: [{ facetParameter: "locations", values: [{ descriptor: "Austin, TX", id: "aus", count: 50 }] }] }));

      expect(await fetchPostings(PROVIDERS.workday, WORKDAY, AREAS)).toEqual({ gone: false, jobs: [] });
      expect(requestMock).toHaveBeenCalledOnce();
    });

    it("reports a board that's gone", async () => {
      mockWeb(() => new Response("missing", { status: 404 }));

      expect(await fetchPostings(PROVIDERS.workday, WORKDAY, AREAS)).toEqual({ gone: true, jobs: [] });
    });

    it("reads a posting's description from its own address, through the safe fetch", () => {
      expect(PROVIDERS.workday.details.url({ externalId: "/job/Tel-Aviv/Engineer_R1" }, WORKDAY)).toBe("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/job/Tel-Aviv/Engineer_R1");
      expect(PROVIDERS.workday.details.options).toEqual({ safe: true });
      expect(PROVIDERS.workday.details.parse({ jobPostingInfo: { jobDescription: "<p>Build</p>" } })).toBe("Build");
    });
  });
});

describe("sleep", () => {
  it("waits for the given time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let done = false;
    sleep(100).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(99);
    const early = done;
    await vi.advanceTimersByTimeAsync(1);

    expect(early).toBe(false);
    expect(done).toBe(true);
  });
});
