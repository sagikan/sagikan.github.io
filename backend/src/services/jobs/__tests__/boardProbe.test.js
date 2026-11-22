import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const { nameGuesses, comeetBoard, probeBoard } = require("../boardProbe");

const ISRAELI_ASHBY_JOBS = { jobs: [{ id: "1", title: "Eng", location: "Tel Aviv, Israel", jobUrl: "https://jobs.ashbyhq.com/acme/1" }] };

// Makes fetch answer each address from a table, with a 404 for any other
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

// Builds a Comeet careers page listing the given positions
function comeetPage(positions) {
  return `<script>COMPANY_POSITIONS_DATA = ${JSON.stringify(positions)};</script>`;
}

describe("nameGuesses", () => {
  it.each([
    ["the domain, then the name joined and dashed", "Natural Intelligence", "https://www.naturalint.com/", ["naturalint", "naturalintelligence", "natural-intelligence"]],
    ["a name that is already the domain only once", "Surecomp", "https://surecomp.com", ["surecomp"]],
    ["the company's part of a careers subdomain", "Acme", "https://careers.acme.co.il/jobs", ["acme"]],
    ["accents and punctuation left out", "Café Labs, Inc.", "", ["cafelabsinc", "cafe-labs-inc"]],
    ["no domain for a missing or broken website", "Beta", "not a link", ["beta"]],
    ["nothing for no name and no website", "", "", []]
  ])("lists %s", (_title, name, website, expected) => {
    expect(nameGuesses(name, website)).toEqual(expected);
  });
});

describe("comeetBoard", () => {
  it("tries the guesses in turn and returns the first whose page lists a job in Israel", async () => {
    const fetchMock = routeFetch({
      "https://www.comeet.com/jobs/naturalint/71.001": comeetPage([{ uid: "P1", name: "Eng", location: { city: "Tel Aviv", country: "IL" }, url_comeet_hosted_page: "https://www.comeet.com/jobs/naturalint/71.001/eng/P1" }]),
      "https://www.comeet.com/jobs/": "<html>home page</html>"
    });

    expect(await comeetBoard("71.001", ["natural", "naturalint", "never-tried"])).toEqual({ provider: "comeet", token: "naturalint/71.001" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["https://www.comeet.com/jobs/natural/71.001", "https://www.comeet.com/jobs/naturalint/71.001"]);
  });

  it("returns null when no guess opens a page with a job in Israel", async () => {
    routeFetch({ "https://www.comeet.com/jobs/": comeetPage([{ uid: "P1", name: "Eng", location: { city: "Berlin", country: "DE" }, url_comeet_hosted_page: "https://x.com/P1" }]) });

    expect(await comeetBoard("71.001", ["acme"])).toBeNull();
  });
});

describe("probeBoard", () => {
  it("asks each system for each guess and returns the first board with a job in Israel", async () => {
    const fetchMock = routeFetch({ "https://api.lever.co/v0/postings/acme-labs": [{ id: "a", text: "Eng", categories: { location: "Haifa, Israel" }, hostedUrl: "https://jobs.lever.co/acme-labs/a" }] });

    expect(await probeBoard(["acme", "acme-labs"])).toEqual({ provider: "lever", token: "acme-labs" });
    expect(fetchMock.mock.calls.map(([url]) => url.split("?")[0])).toEqual([
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      "https://boards-api.greenhouse.io/v1/boards/acme-labs/jobs",
      "https://api.lever.co/v0/postings/acme",
      "https://api.lever.co/v0/postings/acme-labs"
    ]);
  });

  it("skips a board under the same name that has no job in Israel, since it is likely another company's", async () => {
    routeFetch({ "https://boards-api.greenhouse.io/v1/boards/air/": { jobs: [{ id: 1, title: "Eng", location: { name: "Austin, TX" }, absolute_url: "https://x.com/1" }] } });

    expect(await probeBoard(["air"])).toBeNull();
  });

  it("skips a board under the same name whose only job is a remote one", async () => {
    routeFetch({ "https://boards-api.greenhouse.io/v1/boards/air/": { jobs: [{ id: 1, title: "Eng", location: { name: "Remote" }, absolute_url: "https://x.com/1" }] } });

    expect(await probeBoard(["air"])).toBeNull();
  });

  it("treats a system that fails as having no board, and goes on to the next", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url.includes("greenhouse")) return new Response("oops", { status: 500 });
      if (url.includes("ashbyhq")) return jsonResponse(ISRAELI_ASHBY_JOBS);

      return new Response("missing", { status: 404 });
    }));

    expect(await probeBoard(["acme"])).toEqual({ provider: "ashby", token: "acme" });
  });

  it("returns null with no guesses, without asking anything", async () => {
    const fetchMock = routeFetch({});

    expect(await probeBoard([])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
