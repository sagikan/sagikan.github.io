import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { normalizePath, parseTestCalls, routeCoverage } = require("../coverageTool");

const SRC_DIR = path.join(import.meta.dirname, "..", "..", "..");
const TEST_SOURCE = `
async function saveProfile(client) {
  return client.put("/api/jobs/profile").send({});
}

describe("jobs", () => {
  it("saves", async () => {
    const { client } = await signedInClient();

    await saveProfile(client);
    await client.get(\`/api/jobs/\${id}/tailoring\`);
  });

  it("never shows another user's jobs", async () => {
    const { client } = await signedInClient();
    const other = await createUser({ email: "noa@example.com" });

    await client.get("/api/jobs?section=found");
    await saveProfile(client);
  });

  it.each([
    ["post", "/api/jobs/dismiss-all"]
  ])("refuses a %s without a session", async (method, path) => {
    await api()[method](path);
  });
});
`;

describe("normalizePath", () => {
  it.each([
    ["/api/jobs/:id/tailoring", "/api/jobs/:/tailoring"],
    ["/api/jobs/${id}/tailoring", "/api/jobs/:/tailoring"],
    ["/api/applications/1", "/api/applications/:"],
    ["/api/logos?company=Orbit", "/api/logos"],
    ["/api/jobs/", "/api/jobs"]
  ])("turns %s into %s", (value, expected) => {
    expect(normalizePath(value)).toBe(expected);
  });
});

describe("parseTestCalls", () => {
  it("finds the routes called directly and through helper functions, but not the ones in a table of paths", () => {
    const { tested } = parseTestCalls(TEST_SOURCE);

    expect([...tested].sort()).toEqual(["GET /api/jobs", "GET /api/jobs/:/tailoring", "PUT /api/jobs/profile"]);
  });

  it("marks only the routes called by a test that creates two users", () => {
    const { crossUser } = parseTestCalls(TEST_SOURCE);

    expect([...crossUser].sort()).toEqual(["GET /api/jobs", "PUT /api/jobs/profile"]);
  });
});

describe("routeCoverage", () => {
  it("summarizes the real routes that match the filter", () => {
    const output = routeCoverage(SRC_DIR, "tailor");

    expect(output).toMatch(/^3 routes: /);
    expect(output).toContain("No database test calls them:");
  });

  it("reports no routes for a filter that matches nothing", () => {
    expect(routeCoverage(SRC_DIR, "no-such-route")).toMatch(/^0 routes: 0 without a database test, 0 signed-in routes/);
  });
});
