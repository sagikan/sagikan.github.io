import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";
import { mockDns, mockWeb } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const { readCareersPage } = require("../careersPage");

// Makes every request answer from a table of addresses, with a 404 for any other, and returns the request mock
function serve(pages) {
  return mockWeb((url) => {
    const text = pages[String(url)];

    return text === undefined ? new Response("missing", { status: 404 }) : new Response(text);
  });
}

// Lists the addresses that were requested
function requested(requestMock) {
  return requestMock.mock.calls.map(([url]) => String(url));
}

describe("readCareersPage", () => {
  beforeEach(() => {
    mockDns();
  });

  it("finds the boards a careers page links to, and reads nothing more", async () => {
    const requestMock = serve({
      "https://acme.com/careers": "<a href=\"https://jobs.lever.co/acme\">Jobs</a><script src=\"/js/careers.js\"></script>"
    });

    expect(await readCareersPage("https://acme.com/careers")).toEqual({ boards: [{ provider: "lever", token: "acme" }], comeetCodes: [] });
    expect(requested(requestMock)).toEqual(["https://acme.com/careers"]);
  });

  it("finds a Comeet widget's company code", async () => {
    serve({ "https://acme.com/careers": "<script>var comeetvar = {\"comeet_uid\":\"24.00E\"};</script>" });

    expect(await readCareersPage("https://acme.com/careers")).toEqual({ boards: [], comeetCodes: ["24.00E"] });
  });

  it("reads a script named after a job system, wherever it's hosted, when the page names no board", async () => {
    serve({
      "https://acme.com/careers": "<script src=\"https://cdn.example.net/greenhouse-widget.js\"></script>",
      "https://cdn.example.net/greenhouse-widget.js": "fetch('https://boards-api.greenhouse.io/v1/boards/acme/jobs')"
    });

    expect((await readCareersPage("https://acme.com/careers")).boards).toEqual([{ provider: "greenhouse", token: "acme" }]);
  });

  it("follows a link to a jobs page on the same site, and stops once it finds a board", async () => {
    const requestMock = serve({
      "https://www.acme.com/careers": "<a href=\"/careers/open-positions?x=1&amp;y=2\">Open roles</a><a href=\"/careers/benefits-jobs\">More</a>",
      "https://www.acme.com/careers/open-positions?x=1&y=2": "<iframe src=\"https://apply.workable.com/acme/\"></iframe>"
    });

    expect((await readCareersPage("https://www.acme.com/careers")).boards).toEqual([{ provider: "workable", token: "acme" }]);
    expect(requested(requestMock)).toEqual(["https://www.acme.com/careers", "https://www.acme.com/careers/open-positions?x=1&y=2"]);
  });

  it("follows a jobs link to a subdomain, but not to another site that only ends the same way", async () => {
    const requestMock = serve({
      "https://acme.com/careers": "<a href=\"https://notacme.com/jobs\">x</a><a href=\"https://jobs.acme.com/positions\">Jobs</a>"
    });

    await readCareersPage("https://acme.com/careers");

    expect(requested(requestMock)).toEqual(["https://acme.com/careers", "https://jobs.acme.com/positions"]);
  });

  it("reads at most 3 more pages or scripts", async () => {
    const links = Array.from({ length: 6 }, (_, index) => `<a href="/jobs/${index}">x</a>`).join("");
    const requestMock = serve({ "https://acme.com/careers": links });

    await readCareersPage("https://acme.com/careers");

    expect(requested(requestMock)).toHaveLength(4);
  });

  it("finds nothing on a page that can't be read", async () => {
    serve({});

    expect(await readCareersPage("https://acme.com/careers")).toEqual({ boards: [], comeetCodes: [] });
  });

  it("doesn't read a page at a private address", async () => {
    mockDns("10.0.0.5");
    const requestMock = serve({ "https://intranet.example/careers": "https://jobs.lever.co/acme" });

    expect(await readCareersPage("https://intranet.example/careers")).toEqual({ boards: [], comeetCodes: [] });
    expect(requestMock).not.toHaveBeenCalled();
  });
});
