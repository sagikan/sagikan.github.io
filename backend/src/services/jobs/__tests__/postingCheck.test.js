import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { mockDns, mockFetch } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const { needsCheck, status, statuses } = require("../postingCheck");

// Builds an HTML page response
function page(html, httpStatus = 200) {
  return () => new Response(html, { status: httpStatus });
}

describe("needsCheck", () => {
  it.each([
    ["a company career page", "https://careers.acme.com/jobs/1", true],
    ["a LinkedIn posting", "https://www.linkedin.com/jobs/view/1", true],
    ["a Greenhouse board", "https://boards.greenhouse.io/acme/jobs/1", false],
    ["a Lever board", "https://jobs.lever.co/acme/1", false],
    ["an Ashby board", "https://jobs.ashbyhq.com/acme/1", false],
    ["a host that only ends like a board", "https://notgreenhouse.io/jobs/1", true],
    ["an invalid link", "not a url", false],
    ["no link", "", false]
  ])("treats %s as needing a check: %s", (_title, url, expected) => {
    expect(needsCheck(url)).toBe(expected);
  });
});

describe("status", () => {
  it("reports a normal page as open", async () => {
    mockDns();
    mockFetch(page("<h1>Backend Engineer</h1> Apply now"));

    expect(await status("https://careers.acme.com/jobs/1")).toBe("open");
  });

  it.each([404, 410])("reports HTTP %i as closed", async (httpStatus) => {
    mockDns();
    mockFetch(page("gone", httpStatus));

    expect(await status("https://careers.acme.com/jobs/1")).toBe("closed");
  });

  it("reports other error statuses as unknown", async () => {
    mockDns();
    mockFetch(page("oops", 500));

    expect(await status("https://careers.acme.com/jobs/1")).toBe("unknown");
  });

  it.each([
    ["a generic closed notice", "https://careers.acme.com/jobs/1", "We are no longer accepting applications"],
    ["a filled position", "https://careers.acme.com/jobs/1", "This position has been filled"],
    ["a closed LinkedIn marker", "https://www.linkedin.com/jobs/view/1", "<div class=\"top closed-job\">"],
    ["an expired Indeed posting", "https://www.indeed.com/viewjob?jk=1", "This job has expired"]
  ])("reports %s as closed", async (_title, url, html) => {
    mockDns();
    mockFetch(page(html));

    expect(await status(url)).toBe("closed");
  });

  it("ignores a site-specific marker on another site", async () => {
    mockDns();
    mockFetch(page("Job is no longer available on Indeed"));

    expect(await status("https://careers.acme.com/jobs/1")).toBe("open");
  });

  it("reports unknown when the page can't be fetched", async () => {
    mockDns();
    mockFetch(() => {
      throw new Error("network down");
    });

    expect(await status("https://careers.acme.com/jobs/1")).toBe("unknown");
  });

  it("reports unknown for a private address without fetching it", async () => {
    const fetchMock = mockFetch(page("secret"));

    expect(await status("http://127.0.0.1/jobs/1")).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes no request in development, where outside calls are off", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fetchMock = mockFetch(page("anything"));

    expect(await status("https://careers.acme.com/jobs/1")).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("statuses", () => {
  it("checks each distinct link once and maps it to its status", async () => {
    mockDns();
    const fetchMock = vi.fn(async (url) => new Response("page", { status: url.hostname === "b.example.com" ? 404 : 200 }));

    vi.stubGlobal("fetch", fetchMock);
    const result = await statuses(["https://a.example.com/1", "https://a.example.com/1", "https://b.example.com/2"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Object.fromEntries(result)).toEqual({ "https://a.example.com/1": "open", "https://b.example.com/2": "closed" });
  });

  it("returns an empty map for no links", async () => {
    expect((await statuses([])).size).toBe(0);
  });
});
