import { createRequire } from "node:module";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApplication, createUser } from "../../../tests/db/helpers";
import { jsonResponse } from "../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const app = require("../../app");
const db = require("../../config/db");
const { generateToken, hashToken } = require("../../services/email/emailService");

let token;
let user;

// Sends a request to the ingest endpoint the way the Apps Script does
function ingest(body, authorization = `Bearer ${token}`) {
  const req = request(app).post("/api/email/ingest");

  return (authorization ? req.set("Authorization", authorization) : req).send(body);
}

// Builds an email as the Apps Script sends it
function message(id, extra = {}) {
  return { id, date: "2026-04-10T09:00:00Z", from: "Careers <jobs@acme.com>", subject: "Your application", body: "Thank you for applying.", ...extra };
}

// Mocks Claude's answers, picked by the email's subject
function mockClaude(answers) {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const subject = /Subject: (.*)/.exec(JSON.parse(options.body).messages[0].content)[1];
    const input = { job_related: true, event: "received", company: "Acme", position: "", confidence: 0.95, ...answers[subject] };

    return jsonResponse({ content: [{ type: "tool_use", name: "record_email", input }] });
  }));
}

// Reads the stored email events
async function storedEvents() {
  return (await db.query("SELECT message_id, subject, sender, snippet, state, suggested_status, application_id, received_at FROM email_events ORDER BY id")).rows;
}

beforeEach(async () => {
  user = await createUser();
  token = generateToken();

  await db.query("INSERT INTO email_sync (user_id, token_hash, auto_update) VALUES ($1, $2, TRUE)", [user.id, hashToken(token)]);
});

describe("authentication", () => {
  it.each([
    ["no Authorization header", null],
    ["a header that isn't a bearer token", "Basic abc"],
    ["an empty bearer token", "Bearer   "]
  ])("refuses %s", async (_title, authorization) => {
    const res = await ingest({ ids: [] }, authorization);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Missing token." });
  });

  it("refuses a token that was never issued", async () => {
    const res = await ingest({ ids: [] }, `Bearer ${generateToken()}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid token." });
  });

  it("refuses a token after a new one replaced it", async () => {
    await db.query("UPDATE email_sync SET token_hash = $1", [hashToken(generateToken())]);

    expect((await ingest({ ids: [] })).status).toBe(401);
  });

  it("needs no cookie, CSRF token or origin, since the Apps Script has none", async () => {
    expect((await ingest({ ids: [] })).status).toBe(200);
  });

  it("allows 60 requests per token every 15 minutes", async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      expect((await ingest({ ids: [] })).status).toBe(200);
    }

    const res = await ingest({ ids: [] });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Too many requests. Please try again later." });
  });

  it("counts each token separately", async () => {
    for (let attempt = 0; attempt < 60; attempt++) await ingest({ ids: [] });

    const other = await createUser({ email: "noa@example.com" });
    const otherToken = generateToken();

    await db.query("INSERT INTO email_sync (user_id, token_hash) VALUES ($1, $2)", [other.id, hashToken(otherToken)]);

    expect((await ingest({ ids: [] }, `Bearer ${otherToken}`)).status).toBe(200);
  });
});

describe("checking which emails are new", () => {
  it("returns the ids it hasn't seen, and notes the sync time", async () => {
    await db.query("INSERT INTO email_events (user_id, message_id, state) VALUES ($1, 'seen', 'ignored')", [user.id]);

    const res = await ingest({ ids: ["seen", "fresh-1", "fresh-2"] });

    expect(res.body).toEqual({ unknown: ["fresh-1", "fresh-2"] });
    expect((await db.query("SELECT last_ingest_at FROM email_sync")).rows[0].last_ingest_at).toBeTruthy();
  });

  it("doesn't treat another user's emails as seen", async () => {
    const other = await createUser({ email: "noa@example.com" });

    await db.query("INSERT INTO email_events (user_id, message_id, state) VALUES ($1, 'shared-id', 'ignored')", [other.id]);

    expect((await ingest({ ids: ["shared-id"] })).body).toEqual({ unknown: ["shared-id"] });
  });

  it("ignores ids that aren't text", async () => {
    expect((await ingest({ ids: ["a", 5, null, { x: 1 }] })).body).toEqual({ unknown: ["a"] });
  });

  it("refuses more than 100 ids", async () => {
    const res = await ingest({ ids: Array.from({ length: 101 }, (_, index) => `m${index}`) });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Send at most 100 ids." });
  });
});

describe("receiving emails", () => {
  it("classifies new emails, stores what it found and reports the counts", async () => {
    mockClaude({ "Your application": { event: "received" }, "Newsletter": { job_related: false } });

    const res = await ingest({ messages: [message("a"), message("b", { subject: "Newsletter" })] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 2, known: 0, ignored: 2, pending: 0, autoApplied: 0, failed: 0, deferred: 0 });
    expect((await storedEvents()).map((event) => [event.message_id, event.state])).toEqual([["a", "ignored"], ["b", "ignored"]]);
  });

  it("updates an application's status when the email clearly says so and automatic updates are on", async () => {
    const application = await createApplication(user.id, { company: "Acme", position: "Backend Engineer", applied_at: "2026-03-01" });

    mockClaude({ "Interview": { event: "interview", position: "Backend Engineer" } });

    const res = await ingest({ messages: [message("a", { subject: "Interview" })] });

    expect(res.body).toMatchObject({ autoApplied: 1, pending: 0 });
    expect((await db.query("SELECT status FROM applications WHERE id = $1", [application.id])).rows[0].status).toBe("Interview");
    expect(await storedEvents()).toEqual([expect.objectContaining({ state: "auto_applied", suggested_status: "Interview", application_id: String(application.id) })]);
  });

  it("leaves the update for the user when automatic updates are off", async () => {
    const application = await createApplication(user.id, { company: "Acme", applied_at: "2026-03-01" });

    await db.query("UPDATE email_sync SET auto_update = FALSE");
    mockClaude({ "Interview": { event: "interview" } });

    const res = await ingest({ messages: [message("a", { subject: "Interview" })] });

    expect(res.body).toMatchObject({ pending: 1, autoApplied: 0 });
    expect((await db.query("SELECT status FROM applications WHERE id = $1", [application.id])).rows[0].status).toBe("Applied");
  });

  it("never touches another user's applications", async () => {
    const other = await createUser({ email: "noa@example.com" });
    const theirs = await createApplication(other.id, { company: "Acme", applied_at: "2026-03-01" });

    mockClaude({ "Interview": { event: "interview" } });

    const res = await ingest({ messages: [message("a", { subject: "Interview" })] });

    expect(res.body).toMatchObject({ pending: 1, autoApplied: 0 });
    expect((await db.query("SELECT status FROM applications WHERE id = $1", [theirs.id])).rows[0].status).toBe("Applied");
  });

  it("skips emails it has already stored, without classifying them again", async () => {
    mockClaude({ "Your application": {} });
    await ingest({ messages: [message("a")] });

    const res = await ingest({ messages: [message("a")] });

    expect(res.body).toMatchObject({ received: 1, known: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("accepts an empty batch without needing a classifier", async () => {
    const res = await ingest({ messages: [] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 0 });
  });

  it("answers 503 when emails arrive and the server can't classify them", async () => {
    const res = await ingest({ messages: [message("a")] });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "Email classification is not configured on the server." });
    expect(await storedEvents()).toEqual([]);
  });

  it.each([
    ["no messages list", {}, "Send between 0 and 25 messages."],
    ["a messages list that isn't a list", { messages: "x" }, "Send between 0 and 25 messages."],
    ["more than 25 messages", { messages: Array.from({ length: 26 }, (_, index) => message(`m${index}`)) }, "Send between 0 and 25 messages."]
  ])("refuses %s", async (_title, body, error) => {
    const res = await ingest(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error });
  });

  describe("cleaning what arrives", () => {
    it("drops messages without an id, or that aren't objects", async () => {
      mockClaude({ "Your application": {} });

      const res = await ingest({ messages: [message("a"), { subject: "No id" }, { id: "" }, { id: 5 }, null, "text"] });

      expect(res.body.received).toBe(1);
      expect((await storedEvents()).map((event) => event.message_id)).toEqual(["a"]);
    });

    it("decodes HTML entities and strips invisible characters from the subject and body", async () => {
      mockClaude({ "Offer & more": {} });
      await ingest({ messages: [message("a", { subject: "Offer &amp; ​more", body: "Hello&nbsp;&#x41;&#66;­ there\n\n  now" })] });

      const [stored] = await storedEvents();

      expect(stored.subject).toBe("Offer & more");
      expect(stored.snippet).toBe("Hello AB there now");
    });

    it("keeps an entity it can't decode as written", async () => {
      mockClaude({ "Price &bogus; &#99999999;": {} });
      await ingest({ messages: [message("a", { subject: "Price &bogus; &#99999999;" })] });

      expect((await storedEvents())[0].subject).toBe("Price &bogus; &#99999999;");
    });

    it("cuts long fields to their limits", async () => {
      mockClaude({ [`${"s".repeat(400)}`]: {} });
      await ingest({ messages: [message("m".repeat(300), { subject: "s".repeat(500), from: "f".repeat(500), body: "b".repeat(9000) })] });

      const [stored] = await storedEvents();

      expect(stored.message_id).toHaveLength(200);
      expect(stored.subject).toHaveLength(400);
      expect(stored.sender).toHaveLength(300);
      expect(stored.snippet).toHaveLength(200);
    });

    it("uses the time of arrival when the date is missing or invalid", async () => {
      mockClaude({ "Your application": {} });

      const before = Date.now();

      await ingest({ messages: [message("a", { date: "not a date" }), message("b", { date: undefined })] });

      for (const event of await storedEvents()) {
        expect(new Date(event.received_at).getTime()).toBeGreaterThanOrEqual(before - 1000);
      }
    });
  });
});
