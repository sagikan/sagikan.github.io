import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { api, createApplication, createUser, signedInClient } from "../../../tests/db/helpers";

const require = createRequire(import.meta.url);
const { PDFDocument } = require("pdf-lib");
const db = require("../../config/db");
const claude = require("../../services/ai/anthropic");
const feeds = require("../../services/jobs/jobFeeds");
const cvTailor = require("../../services/resume/cvTailor");

const CV = {
  name: "Dana Levi",
  email: "dana@example.com",
  experience: [{ title: "Developer", company: "Acme", start: "Jan 2023", end: "Dec 2023", bullets: ["Built APIs", "Wrote tests"] }],
  education: [{ degree: "B.Sc.", school: "Example University", start: "2019", end: "2022" }],
  skills: [{ category: "Languages", items: ["JavaScript", "Python"] }]
};
const PREFS = { roles: ["Backend Engineer"], locations: ["Tel Aviv, Israel"], workplace_models: ["Remote"], seniority: "Junior" };

// Builds the bytes of a PDF with the given number of pages
async function pdf(pages = 1) {
  const doc = await PDFDocument.create();

  for (let page = 0; page < pages; page++) doc.addPage();

  return Buffer.from(await doc.save());
}

// Collects a binary response body
function binary(res, callback) {
  const chunks = [];

  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

// Saves a resume and preferences for a signed-in client
async function saveProfile(client, parts = {}) {
  const res = await client.put("/api/jobs/profile").send({ cv: CV, preferences: PREFS, ...parts });

  expect(res.status).toBe(200);

  return res.body;
}

// Adds a job for a user and returns its row
async function createJob(userId, values = {}) {
  const row = { source: "manual", company: "Acme", position: "Backend Engineer", location: "Haifa", state: "new", description: "Build APIs", ...values };
  const { rows } = await db.query(
    `INSERT INTO jobs (user_id, source, company, position, location, workplace_model, url, description, match_score, state, hidden, posted_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, NOW()))
     RETURNING id`,
    [userId, row.source, row.company, row.position, row.location, row.workplace_model ?? null, row.url ?? null, row.description, row.match_score ?? null, row.state, row.hidden ?? false, row.posted_at ?? null, row.created_at ?? null]
  );

  return rows[0].id;
}

// Makes the server believe Claude is set up, and answer with the given text
function mockClaude(answer) {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

  return vi.spyOn(claude, "send").mockResolvedValue({ stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: JSON.stringify(answer) }] });
}

// Builds Claude's answer for a tailoring request
function tailoring(parts = {}) {
  return { headline: "Backend Engineer", summary: "", experience: [], projects: [], skills: [], gaps: ["Kubernetes"], ...parts };
}

describe("authentication", () => {
  it.each([
    ["get", "/api/jobs"],
    ["post", "/api/jobs"],
    ["get", "/api/jobs/profile"],
    ["put", "/api/jobs/profile"],
    ["put", "/api/jobs/profile/cv"],
    ["put", "/api/jobs/grade-sheet"],
    ["get", "/api/jobs/grade-sheet"],
    ["delete", "/api/jobs/grade-sheet"],
    ["post", "/api/jobs/search"],
    ["post", "/api/jobs/1/dismiss"],
    ["get", "/api/jobs/1/tailoring"],
    ["post", "/api/jobs/1/tailor"],
    ["put", "/api/jobs/1/tailoring"],
    ["post", "/api/jobs/1/apply"]
  ])("refuses %s %s without a session", async (method, path) => {
    expect((await api()[method](path)).status).toBe(401);
  });

  it("refuses changes without the CSRF token", async () => {
    const { client } = await signedInClient();

    expect((await client.post("/api/jobs").unset("X-CSRF-Token").send({ company: "A", position: "B" })).status).toBe(403);
  });
});

describe("the profile", () => {
  it("is empty for a new user", async () => {
    const { client } = await signedInClient();

    expect((await client.get("/api/jobs/profile")).body).toEqual({ cv: null, preferences: null, updatedAt: null, gradeSheet: null });
  });

  it("saves the resume and preferences cleaned up, and returns them", async () => {
    const { client } = await signedInClient();
    const profile = await saveProfile(client, { cv: { ...CV, name: "dana LEVI", phone: "+972 50-123-4567", links: [{ label: "Bad", url: "javascript:alert(1)" }, { label: "Site", url: "https://example.com" }] } });

    expect(profile.cv).toMatchObject({ name: "Dana Levi", phone: "972501234567", links: [{ label: "Site", url: "https://example.com" }] });
    expect(profile.cv.experience[0]).toMatchObject({ id: "x1", bullets: [{ id: "x1.b1", text: "Built APIs" }, { id: "x1.b2", text: "Wrote tests" }] });
    expect(profile.preferences).toEqual({ ...PREFS });
    expect(profile.updatedAt).toBeTruthy();
    expect((await client.get("/api/jobs/profile")).body.cv.name).toBe("Dana Levi");
  });

  it("replaces the saved profile when saved again", async () => {
    const { client } = await signedInClient();

    await saveProfile(client);
    await saveProfile(client, { preferences: { ...PREFS, roles: ["Data Engineer"] } });

    expect((await db.query("SELECT preferences FROM cv_profiles")).rows).toHaveLength(1);
    expect((await client.get("/api/jobs/profile")).body.preferences.roles).toEqual(["Data Engineer"]);
  });

  it("keeps each user's profile to themselves", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await signedInClient({ email: "noa@example.com" });

    await saveProfile(client);

    expect((await other.client.get("/api/jobs/profile")).body.cv).toBeNull();
  });

  it.each([
    ["a resume with no entries", { cv: { name: "Dana", email: "d@x.com" } }, "Add at least one experience, education or project entry."],
    ["no email", { cv: { ...CV, email: "" } }, "Add your name and email."],
    ["an experience entry without dates", { cv: { ...CV, experience: [{ title: "Dev", company: "Acme", bullets: [] }] } }, "Every experience entry needs a start and end month."],
    ["no roles", { preferences: { ...PREFS, roles: [] } }, "Add 1 to 5 roles."],
    ["no workplace type", { preferences: { ...PREFS, workplace_models: [] } }, "Choose at least one workplace type."]
  ])("refuses %s", async (_title, parts, message) => {
    const { client } = await signedInClient();
    const res = await client.put("/api/jobs/profile").send({ cv: CV, preferences: PREFS, ...parts });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
    expect((await db.query("SELECT 1 FROM cv_profiles")).rowCount).toBe(0);
  });
});

describe("reading a resume PDF", () => {
  // Sends a PDF to be read
  function upload(client, body) {
    return client.put("/api/jobs/profile/cv").set("Content-Type", "application/pdf").send(body);
  }

  it("answers 503 when the server has no AI set up", async () => {
    const { client } = await signedInClient();
    const res = await upload(client, await pdf());

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "AI features are not configured on the server." });
  });

  it("reads the resume with Claude and returns it for the user to check, without saving it", async () => {
    mockClaude({ cv: { ...CV, name: "dana levi" }, preferences: PREFS });

    const { client } = await signedInClient();
    const res = await upload(client, await pdf());

    expect(res.status).toBe(200);
    expect(res.body.cv.name).toBe("Dana Levi");
    expect(res.body.preferences.roles).toEqual(["Backend Engineer"]);
    expect((await db.query("SELECT 1 FROM cv_profiles")).rowCount).toBe(0);
  });

  it("reports a PDF Claude finds no resume in", async () => {
    mockClaude({ cv: { name: "", email: "" }, preferences: {} });

    const { client } = await signedInClient();
    const res = await upload(client, await pdf());

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("couldn't find a resume");
  });

  it.each([
    ["something that isn't a PDF", () => Buffer.from("just text"), "That file isn't a PDF."],
    ["a PDF over 10 pages", () => pdf(11), "Your resume can have at most 10 pages."]
  ])("refuses %s", async (_title, makeBody, message) => {
    const send = mockClaude({});
    const { client } = await signedInClient();
    const res = await upload(client, await makeBody());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a file over 5 MB", async () => {
    mockClaude({});

    const { client } = await signedInClient();
    const res = await upload(client, Buffer.alloc(6 * 1024 * 1024, 1));

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "That file is too large." });
  });

  it("shows Claude's own error when the AI fails", async () => {
    mockClaude({});
    claude.send.mockRejectedValue(new claude.ClaudeError("The AI declined this request."));

    const { client } = await signedInClient();
    const res = await upload(client, await pdf());

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "The AI declined this request." });
  });

  it("allows 5 uploads an hour per user", async () => {
    mockClaude({ cv: CV, preferences: PREFS });

    const { client } = await signedInClient();
    const file = await pdf();

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await upload(client, file)).status).toBe(200);
    }

    const res = await upload(client, file);

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "You've uploaded your resume several times this hour. Please try again in 60 minutes." });
  });
});

describe("the grade sheet", () => {
  // Uploads a grade sheet
  function upload(client, body, name = "Grades 2024 ü.pdf") {
    const req = client.put("/api/jobs/grade-sheet").set("Content-Type", "application/pdf");

    return (name ? req.set("X-File-Name", encodeURIComponent(name)) : req).send(body);
  }

  it("saves the PDF and shows it in the profile", async () => {
    const { client } = await signedInClient();
    const res = await upload(client, await pdf(3));

    expect(res.status).toBe(200);
    expect(res.body.gradeSheet).toMatchObject({ filename: "Grades 2024 ü.pdf", page_count: 3 });
  });

  it("returns the same PDF when downloaded, with its name", async () => {
    const { client } = await signedInClient();
    const file = await pdf(2);

    await upload(client, file);

    const res = await client.get("/api/jobs/grade-sheet").buffer(true).parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe("attachment; filename=\"grade-sheet.pdf\"");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(decodeURIComponent(res.headers["x-file-name"])).toBe("Grades 2024 ü.pdf");
    expect(Buffer.compare(res.body, file)).toBe(0);
  });

  it("replaces the previous grade sheet", async () => {
    const { client } = await signedInClient();

    await upload(client, await pdf(1), "first.pdf");

    const res = await upload(client, await pdf(2), "second.pdf");

    expect(res.body.gradeSheet).toMatchObject({ filename: "second.pdf", page_count: 2 });
    expect((await db.query("SELECT 1 FROM grade_sheets")).rowCount).toBe(1);
  });

  it.each([
    ["no name header", null, "grade-sheet.pdf"],
    ["a name that can't be decoded", "%E0%A4%A", "grade-sheet.pdf"]
  ])("names the file grade-sheet.pdf with %s", async (_title, header, expected) => {
    const { client } = await signedInClient();
    const req = client.put("/api/jobs/grade-sheet").set("Content-Type", "application/pdf");
    const res = await (header ? req.set("X-File-Name", header) : req).send(await pdf());

    expect(res.body.gradeSheet.filename).toBe(expected);
  });

  it("refuses something that isn't a PDF, and a file over 2 MB", async () => {
    const { client } = await signedInClient();

    expect((await upload(client, Buffer.from("text"))).status).toBe(400);
    expect((await upload(client, Buffer.alloc(3 * 1024 * 1024, 1))).status).toBe(413);
    expect((await db.query("SELECT 1 FROM grade_sheets")).rowCount).toBe(0);
  });

  it("reports when there is nothing to download", async () => {
    const { client } = await signedInClient();
    const res = await client.get("/api/jobs/grade-sheet");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No grade sheet uploaded." });
  });

  it("removes the grade sheet", async () => {
    const { client } = await signedInClient();

    await upload(client, await pdf());

    const res = await client.delete("/api/jobs/grade-sheet");

    expect(res.body.gradeSheet).toBeNull();
    expect((await db.query("SELECT 1 FROM grade_sheets")).rowCount).toBe(0);
  });

  it("never shows or removes another user's grade sheet", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await signedInClient({ email: "noa@example.com" });

    await upload(other.client, await pdf());

    expect((await client.get("/api/jobs/grade-sheet")).status).toBe(404);

    await client.delete("/api/jobs/grade-sheet");

    expect((await db.query("SELECT 1 FROM grade_sheets")).rowCount).toBe(1);
  });
});

describe("GET /api/jobs", () => {
  it("returns no jobs and the search status for a new user", async () => {
    const { client } = await signedInClient();
    const { body } = await client.get("/api/jobs");

    expect(body.jobs).toEqual([]);
    expect(body.search).toMatchObject({ running: false, canRefresh: true, lastSearchedAt: null });
  });

  it("lists the user's jobs, new ones first by score, applied ones last", async () => {
    const { client, user } = await signedInClient();
    const low = await createJob(user.id, { company: "Low", match_score: 40 });
    const high = await createJob(user.id, { company: "High", match_score: 90 });
    const applied = await createJob(user.id, { company: "Applied", match_score: 99, state: "applied" });
    const unscored = await createJob(user.id, { company: "Unscored" });
    const { jobs } = (await client.get("/api/jobs")).body;

    expect(jobs.map((job) => job.id)).toEqual([unscored, high, low, applied].map(String));
    expect(jobs[1]).toMatchObject({ company: "High", position: "Backend Engineer", source: "manual", state: "new", has_tailoring: false, match_have: [], match_missing: [] });
  });

  it("leaves out dismissed and hidden jobs, and other users' jobs", async () => {
    const { client, user } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });
    const kept = await createJob(user.id);

    await createJob(user.id, { state: "dismissed" });
    await createJob(user.id, { state: "applied", hidden: true });
    await createJob(other.id);

    expect((await client.get("/api/jobs")).body.jobs.map((job) => job.id)).toEqual([String(kept)]);
  });

  it("leaves out found jobs older than 90 days, but keeps old jobs the user added or applied to", async () => {
    const { client, user } = await signedInClient();
    const old = new Date(Date.now() - 100 * 24 * 3600 * 1000);

    await createJob(user.id, { source: "search", posted_at: old });
    await createJob(user.id, { source: "search", posted_at: new Date(Date.now() - 5 * 24 * 3600 * 1000) });
    await createJob(user.id, { source: "manual", posted_at: old });
    await createJob(user.id, { source: "search", state: "applied", posted_at: old });

    expect((await client.get("/api/jobs")).body.jobs).toHaveLength(3);
  });

  it("shows when a job has a tailored resume, and the day it was posted", async () => {
    const { client, user } = await signedInClient();
    const job = await createJob(user.id, { posted_at: new Date("2026-05-01T10:00:00Z") });

    await db.query("INSERT INTO cv_tailorings (job_id, user_id, cv) VALUES ($1, $2, '{}')", [job, user.id]);

    expect((await client.get("/api/jobs")).body.jobs[0]).toMatchObject({ has_tailoring: true, posted_at: "2026-05-01" });
  });
});

describe("POST /api/jobs", () => {
  it("adds a job by hand and returns it", async () => {
    const { client, user } = await signedInClient();
    const res = await client.post("/api/jobs").send({ company: " Acme ", position: " Backend Engineer ", location: "Haifa", workplace_model: "Hybrid", url: "https://example.com/job/1", description: "Build APIs" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ source: "manual", company: "Acme", position: "Backend Engineer", location: "Haifa", workplace_model: "Hybrid", url: "https://example.com/job/1", state: "new", match_score: null });
    expect((await db.query("SELECT user_id FROM jobs")).rows).toEqual([{ user_id: String(user.id) }]);
  });

  it("adds a job with only the required fields", async () => {
    const { client } = await signedInClient();
    const res = await client.post("/api/jobs").send({ company: "Acme", position: "Engineer", workplace_model: "Office" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ location: "", url: null, description: "", workplace_model: null });
  });

  it("cuts long text to its limits", async () => {
    const { client } = await signedInClient();
    const res = await client.post("/api/jobs").send({ company: "c".repeat(300), position: "p".repeat(300), location: "l".repeat(300), description: "d".repeat(30000) });

    expect(res.body.company).toHaveLength(200);
    expect(res.body.position).toHaveLength(200);
    expect(res.body.location).toHaveLength(200);
    expect(res.body.description).toHaveLength(20000);
  });

  it.each([
    ["no company", { position: "Engineer" }, "Company and position are required."],
    ["a blank position", { company: "Acme", position: "  " }, "Company and position are required."],
    ["a link that isn't http", { company: "Acme", position: "Eng", url: "ftp://example.com" }, "The link must start with http:// or https://."]
  ])("refuses %s", async (_title, body, message) => {
    const { client } = await signedInClient();
    const res = await client.post("/api/jobs").send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
  });

  it("brings back a dismissed job instead of adding a second one for the same link", async () => {
    const { client, user } = await signedInClient();
    const id = await createJob(user.id, { url: "https://example.com/job/1", state: "dismissed", hidden: true });
    const res = await client.post("/api/jobs").send({ company: "Acme", position: "Backend Engineer", url: "https://example.com/job/1" });

    expect(res.body).toMatchObject({ id: String(id), state: "new" });
    expect((await db.query("SELECT hidden FROM jobs")).rows).toEqual([{ hidden: false }]);
  });

  it("keeps an applied job applied when its link is added again", async () => {
    const { client, user } = await signedInClient();
    const id = await createJob(user.id, { url: "https://example.com/job/1", state: "applied" });
    const res = await client.post("/api/jobs").send({ company: "Acme", position: "Backend Engineer", url: "https://example.com/job/1" });

    expect(res.body).toMatchObject({ id: String(id), state: "applied" });
  });

  it("lets two users add the same link", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await signedInClient({ email: "noa@example.com" });
    const body = { company: "Acme", position: "Engineer", url: "https://example.com/job/1" };

    expect((await client.post("/api/jobs").send(body)).status).toBe(201);
    expect((await other.client.post("/api/jobs").send(body)).status).toBe(201);
  });

  it("stops at 2000 jobs added by hand", async () => {
    const { client, user } = await signedInClient();

    await db.query("INSERT INTO jobs (user_id, source, company, position) SELECT $1, 'manual', 'Co ' || n, 'Role' FROM generate_series(1, 2000) AS n", [user.id]);

    const res = await client.post("/api/jobs").send({ company: "Acme", position: "Engineer" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("You can add up to 2000 jobs yourself");
  });

  it("allows 30 jobs an hour per user", async () => {
    const { client } = await signedInClient();

    for (let attempt = 0; attempt < 30; attempt++) {
      expect((await client.post("/api/jobs").send({ company: `Co ${attempt}`, position: "Engineer" })).status).toBe(201);
    }

    const res = await client.post("/api/jobs").send({ company: "One more", position: "Engineer" });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "You've added a lot of jobs this hour. Please try again in 60 minutes." });
  });

  describe("scoring against the resume", () => {
    it("scores the job when Claude is set up and the user has a resume", async () => {
      const send = mockClaude({ results: [] });
      const { client } = await signedInClient();

      await saveProfile(client);

      send.mockImplementation(async (params) => {
        const id = /<posting id="(\d+)">/.exec(params.messages[0].content)[1];

        return { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: JSON.stringify({ results: [{ id, score: 82, have: ["JavaScript"], missing: ["Kubernetes"] }] }) }] };
      });

      const res = await client.post("/api/jobs").send({ company: "Acme", position: "Backend Engineer", description: "Node.js and Kubernetes" });

      expect(res.body).toMatchObject({ match_score: 82, match_have: ["JavaScript"], match_missing: ["Kubernetes"] });
    });

    it("adds the job unscored when the user has no resume yet", async () => {
      const send = mockClaude({ results: [] });
      const { client } = await signedInClient();
      const res = await client.post("/api/jobs").send({ company: "Acme", position: "Engineer" });

      expect(res.status).toBe(201);
      expect(res.body.match_score).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it("still adds the job when scoring fails", async () => {
      mockClaude({});
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { client } = await signedInClient();

      await saveProfile(client);
      claude.send.mockRejectedValue(new Error("overloaded"));

      const res = await client.post("/api/jobs").send({ company: "Acme", position: "Engineer" });

      expect(res.status).toBe(201);
      expect(res.body.match_score).toBeNull();
    });

    it("reads the posting's page when the description is short, and uses it if it has more", async () => {
      mockClaude({});
      vi.spyOn(cvTailor, "fetchPosting").mockResolvedValue("A much longer description of the role. ".repeat(10));

      const { client } = await signedInClient();

      await saveProfile(client);
      claude.send.mockImplementation(async (params) => {
        const id = /<posting id="(\d+)">/.exec(params.messages[0].content)[1];

        return { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: JSON.stringify({ results: [{ id, score: 70, have: [], missing: [] }] }) }] };
      });

      const res = await client.post("/api/jobs").send({ company: "Acme", position: "Engineer", url: "https://example.com/job/1", description: "Short" });

      expect(cvTailor.fetchPosting).toHaveBeenCalledWith("https://example.com/job/1");
      expect(res.body.description).toContain("A much longer description");
    });
  });
});

describe("POST /api/jobs/:id/dismiss", () => {
  it("dismisses a new job", async () => {
    const { client, user } = await signedInClient();
    const id = await createJob(user.id);
    const res = await client.post(`/api/jobs/${id}/dismiss`);

    expect(res.status).toBe(204);
    expect((await db.query("SELECT state, hidden FROM jobs")).rows).toEqual([{ state: "dismissed", hidden: false }]);
  });

  it("hides an applied job without un-applying it", async () => {
    const { client, user } = await signedInClient();
    const id = await createJob(user.id, { state: "applied" });

    await client.post(`/api/jobs/${id}/dismiss`);

    expect((await db.query("SELECT state, hidden FROM jobs")).rows).toEqual([{ state: "applied", hidden: true }]);
  });

  it("reports a job that is already dismissed, doesn't exist or belongs to someone else", async () => {
    const { client, user } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });
    const dismissed = await createJob(user.id, { state: "dismissed" });
    const theirs = await createJob(other.id);

    for (const id of [dismissed, 999999, theirs]) {
      expect((await client.post(`/api/jobs/${id}/dismiss`)).status).toBe(404);
    }

    expect((await db.query("SELECT state FROM jobs WHERE id = $1", [theirs])).rows[0].state).toBe("new");
  });

  it.each(["abc", "0", "-1", "1.5"])("refuses the job ID %s", async (id) => {
    const { client } = await signedInClient();
    const res = await client.post(`/api/jobs/${id}/dismiss`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid job ID." });
  });
});

describe("tailoring a resume", () => {
  describe("POST /api/jobs/:id/tailor", () => {
    it("answers 503 when the server has no AI set up", async () => {
      const { client, user } = await signedInClient();
      const id = await createJob(user.id);

      expect((await client.post(`/api/jobs/${id}/tailor`)).status).toBe(503);
    });

    it("tailors the saved resume to the job and saves the result", async () => {
      const send = mockClaude(tailoring({ headline: "Backend Engineer", experience: [{ id: "x1", bullets: [{ source_id: "x1.b2", text: "Built payment APIs" }] }] }));
      const { client, user } = await signedInClient();
      const id = await createJob(user.id, { description: "x".repeat(1300) });

      await saveProfile(client);

      const res = await client.post(`/api/jobs/${id}/tailor`);

      expect(res.status).toBe(200);
      expect(res.body.description).toBeNull();
      expect(res.body.tailoring).toMatchObject({ job_id: String(id), gaps: ["Kubernetes"], flags: [], include_grade_sheet: false });
      expect(res.body.tailoring.cv.experience[0].bullets).toEqual([{ id: "x1.b2", text: "Built payment APIs", original: "Wrote tests" }]);
      expect(send.mock.calls[0][0].messages[0].content[1].text).toContain("Company: Acme");
      expect((await client.get(`/api/jobs/${id}/tailoring`)).body.tailoring.cv.headline).toBe("Backend Engineer");
    });

    it("replaces the earlier tailoring when run again", async () => {
      mockClaude(tailoring());

      const { client, user } = await signedInClient();
      const id = await createJob(user.id, { description: "x".repeat(1300) });

      await saveProfile(client);
      await client.post(`/api/jobs/${id}/tailor`);
      await client.post(`/api/jobs/${id}/tailor`);

      expect((await db.query("SELECT 1 FROM cv_tailorings")).rowCount).toBe(1);
    });

    it("reads the posting's page when its description is short, saving it with the job", async () => {
      mockClaude(tailoring());
      vi.spyOn(cvTailor, "fetchPosting").mockResolvedValue("Full posting text. ".repeat(100));

      const { client, user } = await signedInClient();
      const id = await createJob(user.id, { url: "https://example.com/job/1", description: "Short" });

      await saveProfile(client);

      const res = await client.post(`/api/jobs/${id}/tailor`);

      expect(res.body.description).toContain("Full posting text.");
      expect((await db.query("SELECT description FROM jobs")).rows[0].description).toContain("Full posting text.");
    });

    it("carries on with the saved description when the page can't be read", async () => {
      mockClaude(tailoring());
      vi.spyOn(cvTailor, "fetchPosting").mockRejectedValue(new Error("blocked"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { client, user } = await signedInClient();
      const id = await createJob(user.id, { url: "https://example.com/job/1", description: "Short" });

      await saveProfile(client);

      const res = await client.post(`/api/jobs/${id}/tailor`);

      expect(res.status).toBe(200);
      expect(res.body.description).toBeNull();
    });

    it("asks for a resume first when the user has none", async () => {
      mockClaude(tailoring());

      const { client, user } = await signedInClient();
      const id = await createJob(user.id);
      const res = await client.post(`/api/jobs/${id}/tailor`);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Upload your resume first." });
    });

    it("can't tailor for a job that doesn't exist or belongs to someone else", async () => {
      mockClaude(tailoring());

      const { client } = await signedInClient({ email: "dana@example.com" });
      const other = await createUser({ email: "noa@example.com" });
      const theirs = await createJob(other.id);

      await saveProfile(client);

      expect((await client.post(`/api/jobs/${theirs}/tailor`)).status).toBe(404);
      expect((await client.post("/api/jobs/999999/tailor")).status).toBe(404);
      expect((await db.query("SELECT 1 FROM cv_tailorings")).rowCount).toBe(0);
    });

    it("shows Claude's own error when the AI fails", async () => {
      mockClaude({});
      claude.send.mockRejectedValue(new claude.ClaudeError("The AI response was cut off. Please try again."));

      const { client, user } = await signedInClient();
      const id = await createJob(user.id, { description: "x".repeat(1300) });

      await saveProfile(client);

      const res = await client.post(`/api/jobs/${id}/tailor`);

      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: "The AI response was cut off. Please try again." });
    });

    it("allows 10 tailorings an hour per user", async () => {
      mockClaude(tailoring());

      const { client, user } = await signedInClient();
      const id = await createJob(user.id, { description: "x".repeat(1300) });

      await saveProfile(client);

      for (let attempt = 0; attempt < 10; attempt++) {
        expect((await client.post(`/api/jobs/${id}/tailor`)).status).toBe(200);
      }

      const res = await client.post(`/api/jobs/${id}/tailor`);

      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: "You've tailored a lot of resumes this hour. Please try again in 60 minutes." });
    });
  });

  describe("GET and PUT /api/jobs/:id/tailoring", () => {
    // Creates a job with a saved tailoring
    async function tailoredJob(client, user) {
      mockClaude(tailoring({ experience: [{ id: "x1", bullets: [{ source_id: "x1.b1", text: "Built APIs" }] }] }));

      const id = await createJob(user.id, { description: "x".repeat(1300) });

      await saveProfile(client);
      await client.post(`/api/jobs/${id}/tailor`);

      return id;
    }

    it("returns nothing when the job has no tailoring, and the saved one when it has", async () => {
      const { client, user } = await signedInClient();
      const bare = await createJob(user.id);

      expect((await client.get(`/api/jobs/${bare}/tailoring`)).body).toEqual({ tailoring: null });
      expect((await client.get(`/api/jobs/${await tailoredJob(client, user)}/tailoring`)).body.tailoring.cv.name).toBe("Dana Levi");
    });

    it("never returns another user's tailoring", async () => {
      const { client } = await signedInClient({ email: "dana@example.com" });
      const other = await signedInClient({ email: "noa@example.com" });
      const theirs = await tailoredJob(other.client, other.user);

      expect((await client.get(`/api/jobs/${theirs}/tailoring`)).body).toEqual({ tailoring: null });
    });

    it("saves the user's edits to the bullets and headline", async () => {
      const { client, user } = await signedInClient();
      const id = await tailoredJob(client, user);
      const res = await client.put(`/api/jobs/${id}/tailoring`).send({ cv: { headline: "Platform Engineer", experience: [{ id: "x1", bullets: [{ id: "x1.b1", text: "Built internal APIs" }] }] } });

      expect(res.status).toBe(200);
      expect(res.body.tailoring.cv.headline).toBe("Platform Engineer");
      expect(res.body.tailoring.cv.experience[0].bullets).toEqual([{ id: "x1.b1", text: "Built internal APIs", original: "Built APIs" }]);
    });

    it("brings back a bullet that was left out, from the saved resume", async () => {
      const { client, user } = await signedInClient();
      const id = await tailoredJob(client, user);
      const res = await client.put(`/api/jobs/${id}/tailoring`).send({ cv: { experience: [{ id: "x1", bullets: [{ id: "x1.b1", text: "Built APIs" }, { id: "x1.b2", text: "Wrote tests too" }] }] } });

      expect(res.body.tailoring.cv.experience[0].bullets.map((bullet) => bullet.id)).toEqual(["x1.b1", "x1.b2"]);
    });

    it("turns the grade sheet on and off without touching the resume", async () => {
      const { client, user } = await signedInClient();
      const id = await tailoredJob(client, user);

      expect((await client.put(`/api/jobs/${id}/tailoring`).send({ include_grade_sheet: true })).body.tailoring).toMatchObject({ include_grade_sheet: true });
      expect((await client.put(`/api/jobs/${id}/tailoring`).send({ include_grade_sheet: "yes" })).body.tailoring).toMatchObject({ include_grade_sheet: true });
      expect((await client.put(`/api/jobs/${id}/tailoring`).send({ include_grade_sheet: false })).body.tailoring.cv.name).toBe("Dana Levi");
    });

    it("asks to tailor first when there is nothing to edit", async () => {
      const { client, user } = await signedInClient();
      const id = await createJob(user.id);
      const res = await client.put(`/api/jobs/${id}/tailoring`).send({ include_grade_sheet: true });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Tailor your resume for this job first." });
    });

    it("can't edit another user's tailoring", async () => {
      const { client } = await signedInClient({ email: "dana@example.com" });
      const other = await signedInClient({ email: "noa@example.com" });
      const theirs = await tailoredJob(other.client, other.user);

      expect((await client.put(`/api/jobs/${theirs}/tailoring`).send({ include_grade_sheet: true })).status).toBe(404);
    });
  });
});

describe("POST /api/jobs/:id/apply", () => {
  it("creates an application from the job and marks the job as applied", async () => {
    const { client, user } = await signedInClient();
    const id = await createJob(user.id, { company: "Acme", position: "Backend Engineer", location: "Haifa", workplace_model: "Remote", url: "https://example.com/job/1" });
    const res = await client.post(`/api/jobs/${id}/apply`).send({ applied_at: "2026-05-01" });

    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({ company: "Acme", position: "Backend Engineer", location: "Haifa", workplace_model: "Remote", status: "Applied", job_url: "https://example.com/job/1", applied_at: "2026-05-01" });
    expect(res.body.job).toMatchObject({ id: String(id), state: "applied", application_id: res.body.application.id });
    expect((await db.query("SELECT user_id FROM applications")).rows).toEqual([{ user_id: String(user.id) }]);
  });

  it("applies today when no valid date is given, and fills in a missing location", async () => {
    const { client, user } = await signedInClient();
    const id = await createJob(user.id, { location: "" });
    const res = await client.post(`/api/jobs/${id}/apply`).send({ applied_at: "2026-02-30" });
    const today = (await db.query("SELECT TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') AS day")).rows[0].day;

    expect(res.body.application).toMatchObject({ location: "Not specified", applied_at: today });
  });

  it("shows the application's resume on the application list once tailored", async () => {
    mockClaude(tailoring());

    const { client, user } = await signedInClient();
    const id = await createJob(user.id, { description: "x".repeat(1300) });

    await saveProfile(client);
    await client.post(`/api/jobs/${id}/tailor`);
    await client.post(`/api/jobs/${id}/apply`).send({});

    expect((await client.get("/api/applications")).body[0].cv_job_id).toBe(String(id));
  });

  it("refuses a job that was already applied to, without adding a second application", async () => {
    const { client, user } = await signedInClient();
    const id = await createJob(user.id);

    await client.post(`/api/jobs/${id}/apply`).send({});

    const res = await client.post(`/api/jobs/${id}/apply`).send({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "You already marked this job as applied." });
    expect((await db.query("SELECT 1 FROM applications")).rowCount).toBe(1);
  });

  it("can't apply to a job that doesn't exist or belongs to someone else", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });
    const theirs = await createJob(other.id);

    expect((await client.post(`/api/jobs/${theirs}/apply`).send({})).status).toBe(404);
    expect((await client.post("/api/jobs/999999/apply").send({})).status).toBe(404);
    expect((await db.query("SELECT 1 FROM applications")).rowCount).toBe(0);
  });

  it("keeps the application when the job it came from is deleted", async () => {
    const { client, user } = await signedInClient();
    const id = await createJob(user.id);

    await client.post(`/api/jobs/${id}/apply`).send({});
    await db.query("DELETE FROM jobs WHERE id = $1", [id]);

    expect((await db.query("SELECT 1 FROM applications")).rowCount).toBe(1);
  });

  it("deleting the application leaves the job, no longer linked to it", async () => {
    const { client, user } = await signedInClient();
    const id = await createJob(user.id);
    const { body } = await client.post(`/api/jobs/${id}/apply`).send({});

    await client.delete(`/api/applications/${body.application.id}`);

    expect((await db.query("SELECT state, application_id FROM jobs")).rows).toEqual([{ state: "applied", application_id: null }]);
  });
});

describe("POST /api/jobs/search", () => {
  // Waits for the background search to finish and returns its row
  async function finishedSearch() {
    await vi.waitFor(async () => {
      expect((await db.query("SELECT 1 FROM job_searches WHERE status = 'running'")).rowCount).toBe(0);
    });

    return (await db.query("SELECT status, found, error FROM job_searches")).rows[0];
  }

  it("answers 503 when the server has no AI set up", async () => {
    const { client } = await signedInClient();

    expect((await client.post("/api/jobs/search")).status).toBe(503);
  });

  it("starts a search for a user with a profile, and runs it in the background", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.spyOn(feeds, "ensureFresh").mockResolvedValue();

    const { client } = await signedInClient();

    await saveProfile(client);

    const res = await client.post("/api/jobs/search").send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ started: true, search: { running: true, canRefresh: false } });
    expect(await finishedSearch()).toEqual({ status: "done", found: 0, error: null });
    expect(feeds.ensureFresh).toHaveBeenCalledOnce();
  });

  it("doesn't start a search without a resume", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

    const { client } = await signedInClient();
    const res = await client.post("/api/jobs/search").send({});

    expect(res.body.started).toBe(false);
    expect((await db.query("SELECT 1 FROM job_searches")).rowCount).toBe(0);
  });

  it("doesn't start a second search while one is running", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.spyOn(feeds, "ensureFresh").mockResolvedValue();

    const { client, user } = await signedInClient();

    await saveProfile(client);
    await db.query("INSERT INTO job_searches (user_id, status) VALUES ($1, 'running')", [user.id]);

    expect((await client.post("/api/jobs/search").send({})).body.started).toBe(false);
  });

  it("records a failed search with a message the user can read", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.spyOn(feeds, "ensureFresh").mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { client } = await signedInClient();

    await saveProfile(client);
    await client.post("/api/jobs/search").send({});

    expect(await finishedSearch()).toEqual({ status: "failed", found: 0, error: "The search failed. Please try again later." });
  });

  it("shows the search status in the job list", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.spyOn(feeds, "ensureFresh").mockResolvedValue();

    const { client } = await signedInClient();

    await saveProfile(client);
    await client.post("/api/jobs/search").send({});
    await finishedSearch();

    expect((await client.get("/api/jobs")).body.search).toMatchObject({ running: false, lastFound: 0 });
  });
});
