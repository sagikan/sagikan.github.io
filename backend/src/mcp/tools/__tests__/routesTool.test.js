import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { parseRoutes, parseMounts, collectRoutes, listRoutes } = require("../routesTool");

const SRC_DIR = path.join(import.meta.dirname, "..", "..", "..");
const ROUTE_FILE = `
router.use(requireAuth, requireCsrf);
router.use((err, req, res, next) => {
  res.status(500).end();
});

router.get("/", async (req, res) => {});
router.put("/profile/cv", requireClaude, readCvLimiter, pdfBody(5), async (req, res) => {});
router.get("/csrf", requireAuth, (req, res) => {});
`;
const APP_FILE = `
const authRoutes = require("./routes/auth");
const emailIngestRoutes = require("./routes/emailIngest");
app.use("/api/email/ingest", express.json({ limit: "1mb", inflate: false }), emailIngestRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/other", otherRoutes);
`;

describe("parseRoutes", () => {
  it("reads methods, paths and route-specific middleware", () => {
    const { routes } = parseRoutes(ROUTE_FILE);

    expect(routes).toEqual([
      { method: "GET", path: "/", middleware: [] },
      { method: "PUT", path: "/profile/cv", middleware: ["requireClaude", "readCvLimiter", "pdfBody(5)"] },
      { method: "GET", path: "/csrf", middleware: ["requireAuth"] }
    ]);
  });

  it("reads the middleware shared by the whole router and skips error handlers", () => {
    const { shared } = parseRoutes(ROUTE_FILE);

    expect(shared).toEqual(["requireAuth", "requireCsrf"]);
  });
});

describe("parseMounts", () => {
  it("maps route files to their mount paths and ignores unknown routers", () => {
    const mounts = parseMounts(APP_FILE);

    expect(mounts).toEqual({ emailIngest: "/api/email/ingest", auth: "/api/auth" });
  });
});

describe("collectRoutes", () => {
  it("returns each mounted route file with its prefix, shared middleware and full route paths", () => {
    const applications = collectRoutes(SRC_DIR).find((item) => item.file === "applications");

    expect(applications).toMatchObject({ prefix: "/api/applications", shared: ["requireAuth", "requireCsrf"] });
    expect(applications.routes.map((route) => `${route.method} ${route.fullPath}`)).toEqual([
      "GET /api/applications",
      "POST /api/applications",
      "DELETE /api/applications/:id",
      "PATCH /api/applications/:id"
    ]);
  });
});

describe("listRoutes", () => {
  it("lists the real routes with their full paths", () => {
    const output = listRoutes(SRC_DIR);

    expect(output).toContain("# applications (/api/applications) all routes: requireAuth, requireCsrf");
    expect(output).toMatch(/PATCH\s+\/api\/applications\/:id/);
  });

  it("keeps only routes whose path contains the filter", () => {
    const output = listRoutes(SRC_DIR, "TAILOR");

    expect(output).toContain("/api/jobs/:id/tailor");
    expect(output).not.toContain("/api/applications");
  });

  it("returns a message when nothing matches", () => {
    expect(listRoutes(SRC_DIR, "no-such-route")).toBe("No routes found.");
  });
});
