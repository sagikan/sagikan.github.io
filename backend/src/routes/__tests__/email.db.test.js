import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { api, createApplication, createUser, signedInClient } from "../../../tests/db/helpers";

const require = createRequire(import.meta.url);
const db = require("../../config/db");
const { hashToken } = require("../../services/email/emailService");

// Adds an email event for a user and returns its ID
async function createEvent(userId, values = {}) {
  const row = {
    message_id: `m${Math.random().toString(36).slice(2)}`,
    received_at: new Date(),
    sender: "Careers <jobs@acme.com>",
    subject: "Interview",
    snippet: "We'd like to talk",
    event_type: "interview",
    company: "Acme",
    position: "Backend Engineer",
    confidence: 0.9,
    suggested_status: "Interview",
    application_id: null,
    candidate_ids: [],
    previous_status: null,
    state: "pending",
    resolved_at: null,
    ...values
  };
  const { rows } = await db.query(
    `INSERT INTO email_events
       (user_id, message_id, received_at, sender, subject, snippet, event_type, company, position, confidence,
        suggested_status, application_id, candidate_ids, previous_status, state, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [userId, row.message_id, row.received_at, row.sender, row.subject, row.snippet, row.event_type, row.company, row.position, row.confidence,
      row.suggested_status, row.application_id, row.candidate_ids, row.previous_status, row.state, row.resolved_at]
  );

  return rows[0].id;
}

// Reads an event row
async function eventRow(id) {
  return (await db.query("SELECT * FROM email_events WHERE id = $1", [id])).rows[0];
}

// Reads an application's status
async function statusOf(id) {
  return (await db.query("SELECT status FROM applications WHERE id = $1", [id])).rows[0].status;
}

describe("authentication", () => {
  it.each([
    ["get", "/api/email/status"],
    ["post", "/api/email/token"],
    ["post", "/api/email/settings"],
    ["post", "/api/email/disconnect"],
    ["get", "/api/email/events"],
    ["post", "/api/email/events/1/accept"],
    ["post", "/api/email/events/1/dismiss"],
    ["post", "/api/email/events/1/undo"]
  ])("refuses %s %s without a session", async (method, path) => {
    expect((await api()[method](path)).status).toBe(401);
  });

  it("refuses changes without the CSRF token", async () => {
    const { client } = await signedInClient();

    expect((await client.post("/api/email/token").unset("X-CSRF-Token")).status).toBe(403);
  });
});

describe("GET /api/email/status", () => {
  it("reports that sync isn't connected for a new user", async () => {
    const { client } = await signedInClient();
    const res = await client.get("/api/email/status");

    expect(res.body).toEqual({ connected: false, autoUpdate: false, lastIngestAt: null, classifierConfigured: false });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("reports the connection, the setting and the last sync", async () => {
    const { client, user } = await signedInClient();

    await db.query("INSERT INTO email_sync (user_id, token_hash, auto_update, last_ingest_at) VALUES ($1, 'h', TRUE, '2026-05-01T10:00:00Z')", [user.id]);

    expect((await client.get("/api/email/status")).body).toEqual({ connected: true, autoUpdate: true, lastIngestAt: "2026-05-01T10:00:00.000Z", classifierConfigured: false });
  });

  it("reports whether the server can classify emails", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

    const { client } = await signedInClient();

    expect((await client.get("/api/email/status")).body.classifierConfigured).toBe(true);
  });

  it("doesn't show another user's connection", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });

    await db.query("INSERT INTO email_sync (user_id, token_hash) VALUES ($1, 'h')", [other.id]);

    expect((await client.get("/api/email/status")).body.connected).toBe(false);
  });
});

describe("POST /api/email/token", () => {
  it("creates a token and stores only its hash", async () => {
    const { client, user } = await signedInClient();
    const res = await client.post("/api/email/token");

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^jt_[A-Za-z0-9_-]{43}$/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((await db.query("SELECT user_id, token_hash FROM email_sync")).rows).toEqual([{ user_id: String(user.id), token_hash: hashToken(res.body.token) }]);
  });

  it("replaces the old token, so the old one stops working, and starts the sync history over", async () => {
    const { client } = await signedInClient();
    const first = (await client.post("/api/email/token")).body.token;

    await db.query("UPDATE email_sync SET last_ingest_at = NOW()");

    const second = (await client.post("/api/email/token")).body.token;
    const rows = (await db.query("SELECT token_hash, last_ingest_at FROM email_sync")).rows;

    expect(rows).toEqual([{ token_hash: hashToken(second), last_ingest_at: null }]);
    expect(first).not.toBe(second);
  });
});

describe("POST /api/email/settings", () => {
  it("turns automatic updates on and off", async () => {
    const { client } = await signedInClient();

    await client.post("/api/email/token");

    expect((await client.post("/api/email/settings").send({ autoUpdate: true })).body).toEqual({ autoUpdate: true });
    expect((await db.query("SELECT auto_update FROM email_sync")).rows[0].auto_update).toBe(true);
    expect((await client.post("/api/email/settings").send({ autoUpdate: false })).body).toEqual({ autoUpdate: false });
  });

  it.each([["a string", "true"], ["a number", 1], ["nothing", undefined]])("refuses %s as the setting", async (_title, value) => {
    const { client } = await signedInClient();
    const res = await client.post("/api/email/settings").send({ autoUpdate: value });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "autoUpdate must be true or false." });
  });

  it("refuses when sync isn't set up", async () => {
    const { client } = await signedInClient();
    const res = await client.post("/api/email/settings").send({ autoUpdate: true });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Email sync is not set up." });
  });

  it("changes only the user's own setting", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });

    await client.post("/api/email/token");
    await db.query("INSERT INTO email_sync (user_id, token_hash) VALUES ($1, 'h')", [other.id]);
    await client.post("/api/email/settings").send({ autoUpdate: true });

    expect((await db.query("SELECT auto_update FROM email_sync WHERE user_id = $1", [other.id])).rows[0].auto_update).toBe(false);
  });
});

describe("POST /api/email/disconnect", () => {
  it("removes the connection and the user's email events, and nobody else's", async () => {
    const { client, user } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });

    await client.post("/api/email/token");
    await createEvent(user.id);
    await db.query("INSERT INTO email_sync (user_id, token_hash) VALUES ($1, 'h')", [other.id]);
    await createEvent(other.id);

    const res = await client.post("/api/email/disconnect");

    expect(res.body).toEqual({ ok: true });
    expect((await db.query("SELECT user_id FROM email_sync")).rows).toEqual([{ user_id: String(other.id) }]);
    expect((await db.query("SELECT user_id FROM email_events")).rows).toEqual([{ user_id: String(other.id) }]);
  });

  it("succeeds when there was nothing to remove", async () => {
    const { client } = await signedInClient();

    expect((await client.post("/api/email/disconnect")).status).toBe(200);
  });
});

describe("GET /api/email/events", () => {
  it("lists pending events, newest first", async () => {
    const { client, user } = await signedInClient();
    const older = await createEvent(user.id, { received_at: new Date("2026-05-01T10:00:00Z") });
    const newer = await createEvent(user.id, { received_at: new Date("2026-05-02T10:00:00Z") });
    const res = await client.get("/api/email/events");

    expect(res.body.pending.map((event) => event.id)).toEqual([String(newer), String(older)]);
    expect(res.body.pending[0]).toMatchObject({ sender: "Careers <jobs@acme.com>", subject: "Interview", event_type: "interview", suggested_status: "Interview", state: "pending" });
    expect(res.body.pending[0]).not.toHaveProperty("user_id");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("leaves out events that were handled, ignored, or belong to someone else", async () => {
    const { client, user } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });
    const kept = await createEvent(user.id);

    await createEvent(user.id, { state: "ignored" });
    await createEvent(user.id, { state: "dismissed" });
    await createEvent(other.id);

    expect((await client.get("/api/email/events")).body.pending.map((event) => event.id)).toEqual([String(kept)]);
  });

  it("leaves out a pending event whose application already has the suggested status", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id, { status: "Interview" });
    const behind = await createApplication(user.id, { company: "Globex", status: "Applied" });

    await createEvent(user.id, { application_id: application.id });

    const open = await createEvent(user.id, { application_id: behind.id });

    expect((await client.get("/api/email/events")).body.pending.map((event) => event.id)).toEqual([String(open)]);
  });

  it("lists recent updates from the last 24 hours with their application, and whether they can be undone", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id, { status: "Interview" });
    const changed = await createApplication(user.id, { company: "Globex", status: "Rejected" });
    const auto = await createEvent(user.id, { state: "auto_applied", application_id: application.id, resolved_at: new Date(Date.now() - 3600 * 1000) });
    const accepted = await createEvent(user.id, { state: "accepted", application_id: changed.id, resolved_at: new Date(Date.now() - 1800 * 1000) });

    await createEvent(user.id, { state: "auto_applied", application_id: application.id, resolved_at: new Date(Date.now() - 30 * 3600 * 1000) });

    const { recent } = (await client.get("/api/email/events")).body;

    expect(recent.map((event) => event.id)).toEqual([String(accepted), String(auto)]);
    expect(recent[0]).toMatchObject({ application_company: "Globex", undoable: false });
    expect(recent[1]).toMatchObject({ application_company: "Acme", application_position: "Backend Engineer", undoable: true });
  });
});

describe("POST /api/email/events/:id/accept", () => {
  it("applies the suggested status and remembers the previous one", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id);
    const event = await createEvent(user.id, { application_id: application.id });
    const res = await client.post(`/api/email/events/${event}/accept`);

    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({ id: application.id, status: "Interview" });
    expect(await eventRow(event)).toMatchObject({ state: "accepted", previous_status: "Applied" });
    expect((await eventRow(event)).resolved_at).toBeTruthy();
  });

  it("applies it to the application the user chose among the candidates", async () => {
    const { client, user } = await signedInClient();
    const first = await createApplication(user.id);
    const second = await createApplication(user.id, { position: "Frontend Developer" });
    const event = await createEvent(user.id, { candidate_ids: [first.id, second.id] });
    const res = await client.post(`/api/email/events/${event}/accept`).send({ applicationId: second.id });

    expect(res.body.application.id).toBe(second.id);
    expect(await statusOf(second.id)).toBe("Interview");
    expect(await statusOf(first.id)).toBe("Applied");
    expect((await eventRow(event)).application_id).toBe(String(second.id));
  });

  it.each([
    ["no choice", undefined],
    ["an application that isn't a candidate", 999]
  ])("asks which application it is about when given %s", async (_title, applicationId) => {
    const { client, user } = await signedInClient();
    const first = await createApplication(user.id);
    const outsider = await createApplication(user.id, { company: "Globex" });
    const event = await createEvent(user.id, { candidate_ids: [first.id] });
    const res = await client.post(`/api/email/events/${event}/accept`).send({ applicationId: applicationId === 999 ? outsider.id : applicationId });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Choose which application this email is about." });
    expect(await statusOf(outsider.id)).toBe("Applied");
  });

  it("refuses an event that was already handled", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id);
    const event = await createEvent(user.id, { application_id: application.id, state: "dismissed" });
    const res = await client.post(`/api/email/events/${event}/accept`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "This update was already handled." });
    expect(await statusOf(application.id)).toBe("Applied");
  });

  it("can't be used on another user's event or application", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });
    const theirs = await createApplication(other.id);
    const theirEvent = await createEvent(other.id, { application_id: theirs.id });
    const res = await client.post(`/api/email/events/${theirEvent}/accept`);

    expect(res.status).toBe(404);
    expect(await statusOf(theirs.id)).toBe("Applied");
  });

  it("can't be pointed at another user's application through the candidates", async () => {
    const { client, user } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });
    const theirs = await createApplication(other.id);
    const event = await createEvent(user.id, { candidate_ids: [theirs.id] });
    const res = await client.post(`/api/email/events/${event}/accept`).send({ applicationId: theirs.id });

    expect(res.status).toBe(404);
    expect(await statusOf(theirs.id)).toBe("Applied");
    expect((await eventRow(event)).state).toBe("pending");
  });

  it.each(["abc", "0", "-1", "1.5"])("refuses the event ID %s", async (id) => {
    const { client } = await signedInClient();
    const res = await client.post(`/api/email/events/${id}/accept`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid event ID." });
  });
});

describe("POST /api/email/events/:id/dismiss", () => {
  it("dismisses a pending event without touching the application", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id);
    const event = await createEvent(user.id, { application_id: application.id });
    const res = await client.post(`/api/email/events/${event}/dismiss`);

    expect(res.body).toEqual({ ok: true });
    expect((await eventRow(event)).state).toBe("dismissed");
    expect(await statusOf(application.id)).toBe("Applied");
  });

  it.each(["accepted", "auto_applied", "dismissed", "ignored", "undone"])("refuses an event that is %s", async (state) => {
    const { client, user } = await signedInClient();
    const event = await createEvent(user.id, { state });

    expect((await client.post(`/api/email/events/${event}/dismiss`)).status).toBe(409);
  });

  it("can't dismiss another user's event", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });
    const event = await createEvent(other.id);

    expect((await client.post(`/api/email/events/${event}/dismiss`)).status).toBe(404);
    expect((await eventRow(event)).state).toBe("pending");
  });
});

describe("POST /api/email/events/:id/undo", () => {
  it.each(["auto_applied", "accepted"])("puts an %s update back to the previous status", async (state) => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id, { status: "Interview" });
    const event = await createEvent(user.id, { state, application_id: application.id, previous_status: "Applied" });
    const res = await client.post(`/api/email/events/${event}/undo`);

    expect(res.body.application).toMatchObject({ id: application.id, status: "Applied" });
    expect((await eventRow(event)).state).toBe("undone");
  });

  it("refuses when the status has changed since, so newer changes aren't lost", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id, { status: "Offer" });
    const event = await createEvent(user.id, { state: "auto_applied", application_id: application.id, previous_status: "Applied" });
    const res = await client.post(`/api/email/events/${event}/undo`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "The status changed since this update, so it can't be undone." });
    expect(await statusOf(application.id)).toBe("Offer");
  });

  it.each(["pending", "dismissed", "undone", "ignored"])("refuses an event that is %s", async (state) => {
    const { client, user } = await signedInClient();
    const event = await createEvent(user.id, { state });

    expect((await client.post(`/api/email/events/${event}/undo`)).status).toBe(409);
  });

  it("reports an update whose application was deleted", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id, { status: "Interview" });
    const event = await createEvent(user.id, { state: "auto_applied", application_id: application.id, previous_status: "Applied" });

    await db.query("DELETE FROM applications WHERE id = $1", [application.id]);

    const res = await client.post(`/api/email/events/${event}/undo`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Application not found." });
  });

  it("can't undo another user's update", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });
    const application = await createApplication(other.id, { status: "Interview" });
    const event = await createEvent(other.id, { state: "auto_applied", application_id: application.id, previous_status: "Applied" });

    expect((await client.post(`/api/email/events/${event}/undo`)).status).toBe(404);
    expect(await statusOf(application.id)).toBe("Interview");
  });
});
