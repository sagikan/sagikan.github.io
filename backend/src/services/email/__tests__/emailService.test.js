import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const db = require("../../../config/db");
const { APPLICATION_FIELDS } = require("../../applications/applicationFields");
const emailService = require("../emailService");

const APPLIED_STEP = { id: "10", status: "Applied", date: "2026-03-01" };
const ACME = { id: 1, company: "Acme", position: "Backend Engineer", status: "Applied", applied_at: "2026-03-01", steps: [APPLIED_STEP] };
// An application whose interview was on April 1st, before the test emails (April 10th)
const INTERVIEWED = { ...ACME, status: "Interview", steps: [APPLIED_STEP, { id: "12", status: "Interview", date: "2026-04-01" }] };
const GLOBEX = { id: 2, company: "Globex", position: "Data Analyst", status: "Applied", applied_at: "2026-03-01", steps: [APPLIED_STEP] };

// Builds an email as the sync script sends it
function email(id, subject, extra = {}) {
  return { id, date: new Date("2026-04-10T09:00:00Z"), from: "Careers <jobs@acme.com>", subject, body: "Hello there", ...extra };
}

// Builds what Claude records about an email
function verdict(event, extra = {}) {
  return { job_related: true, event, company: "Acme", position: "", confidence: 0.95, ...extra };
}

// Builds a database result with rows
function rows(...list) {
  return { rows: list, rowCount: list.length };
}

describe("generateToken", () => {
  it("returns a long random token with a recognizable prefix", () => {
    expect(emailService.generateToken()).toMatch(/^jt_[A-Za-z0-9_-]{43}$/);
  });

  it("returns a different token each time", () => {
    expect(emailService.generateToken()).not.toBe(emailService.generateToken());
  });
});

describe("hashToken", () => {
  it("returns the SHA-256 hash in hex", () => {
    expect(emailService.hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("APPLICATION_FIELDS", () => {
  it("is shared with the applications service", () => {
    expect(emailService.APPLICATION_FIELDS).toBe(APPLICATION_FIELDS);
  });
});

describe("EMAIL_EVENT", () => {
  const { EMAIL_EVENT } = emailService;

  it.each([
    ["pending", "accept", "accepted"],
    ["pending", "dismiss", "dismissed"],
    ["auto_applied", "undo", "undone"],
    ["accepted", "undo", "undone"],
    ["pending", "expire", "expired"],
    ["ignored", "remove", "removed"],
    ["dismissed", "remove", "removed"],
    ["undone", "remove", "removed"],
    ["expired", "remove", "removed"]
  ])("moves a %s event on %s to %s", (state, event, expected) => {
    expect(EMAIL_EVENT.move(state, event)).toBe(expected);
  });

  it.each([
    ["ignored", "accept"],
    ["accepted", "accept"],
    ["dismissed", "undo"],
    ["undone", "undo"],
    ["pending", "undo"],
    ["pending", "remove"],
    ["accepted", "remove"],
    ["auto_applied", "remove"],
    ["expired", "accept"]
  ])("doesn't let a %s event %s", (state, event) => {
    expect(EMAIL_EVENT.can(state, event)).toBe(false);
  });

  it("records events as ignored, pending or auto-applied", () => {
    expect(EMAIL_EVENT.initial).toEqual(["ignored", "pending", "auto_applied"]);
  });
});

describe("roundRecorded", () => {
  it.each([
    ["the same status dated before the email's day", "Interview", "2026-04-09", false],
    ["the same status dated on the email's day", "Interview", "2026-04-10", true],
    ["the same status dated after the email's day", "Interview", "2026-04-20", true],
    ["another status dated after the email's day", "Applied", "2026-04-20", false]
  ])("tells whether another round is recorded, with %s", (_title, currentStatus, date, expected) => {
    expect(emailService.roundRecorded({ status: currentStatus, date }, "Interview", "2026-04-10")).toBe(expected);
  });
});

describe("ingest", () => {
  let client;

  /* Mocks the database: which emails are known, how many were used today, the user's applications and the suggestions
     already waiting for review */
  function mockDatabase({ known = [], used = 0, applications = [ACME, GLOBEX].map((application) => ({ ...application })), waiting = [] } = {}) {
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT message_id")) return rows(...known.map((id) => ({ message_id: id })));
      if (sql.includes("COUNT(*)")) return rows({ used });
      if (sql.includes("SELECT application_id, suggested_status")) return rows(...waiting);
      if (sql.includes("FROM applications WHERE user_id")) return rows(...applications);

      return rows();
    });
  }

  // Mocks Claude's answers, picked by the email's subject
  function mockClaude(answers, delay = 0) {
    const inFlight = { now: 0, max: 0 };
    const fetchMock = vi.fn(async (_url, options) => {
      const subject = /Subject: (.*)/.exec(JSON.parse(options.body).messages[0].content)[1];
      const answer = answers[subject];

      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      await new Promise((resolve) => setTimeout(resolve, delay));
      inFlight.now -= 1;

      if (!answer) return new Response("overloaded", { status: 529 });

      return jsonResponse({ content: [{ type: "tool_use", name: "record_email", input: answer }] });
    });

    vi.stubGlobal("fetch", fetchMock);

    return { fetchMock, inFlight };
  }

  // Lists the stored email events as plain objects, whichever connection stored them
  function storedEvents() {
    const calls = [...db.query.mock.calls, ...client.query.mock.calls].filter(([sql]) => sql.includes("INSERT INTO email_events"));

    return calls.map(([, p]) => ({ id: p[1], state: p[14], status: p[10], applicationId: p[11], candidateIds: p[12], previousStatus: p[13], stepId: p[15] }));
  }

  // Answers the transaction's queries, keeping each application's steps (an Applied step to start) between emails
  function stepsClient() {
    const journeys = new Map();
    let nextId = 11;

    return vi.fn(async (sql, params) => {
      if (sql.includes("SELECT id FROM applications")) return rows({ id: params[0] });

      if (sql.includes("FROM application_steps")) {
        if (!journeys.has(params[0])) journeys.set(params[0], [{ ...APPLIED_STEP, position: 0 }]);

        return rows(...journeys.get(params[0]).map((step) => ({ ...step })));
      }

      if (sql.includes("INSERT INTO application_steps")) {
        const [applicationId, , position, status, date] = params;
        const id = String(nextId++);

        journeys.get(applicationId).push({ id, position, status, date });

        return rows({ id });
      }

      return rows();
    });
  }

  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    client = { query: stepsClient(), release: vi.fn() };
    vi.spyOn(db, "connect").mockResolvedValue(client);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("skips emails it has already seen, without calling Claude", async () => {
    mockDatabase({ known: ["a", "b"] });
    const { fetchMock } = mockClaude({});
    const counts = await emailService.ingest(7, true, [email("a", "One"), email("b", "Two")]);

    expect(counts).toEqual({ received: 2, known: 2, ignored: 0, pending: 0, autoApplied: 0, failed: 0, deferred: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("defers the emails over the daily limit of 300", async () => {
    mockDatabase({ used: 299 });
    mockClaude({ One: verdict("received"), Two: verdict("received"), Three: verdict("received") });
    const counts = await emailService.ingest(7, true, [email("a", "One"), email("b", "Two"), email("c", "Three")]);

    expect(counts).toMatchObject({ received: 3, ignored: 1, deferred: 2 });
  });

  it("defers everything once the daily limit is used up", async () => {
    mockDatabase({ used: 400 });
    const { fetchMock } = mockClaude({});

    expect(await emailService.ingest(7, true, [email("a", "One")])).toMatchObject({ deferred: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts an email Claude couldn't classify as failed and stores nothing for it", async () => {
    mockDatabase();
    mockClaude({ Known: verdict("received") });
    const counts = await emailService.ingest(7, true, [email("a", "Known"), email("b", "Unreadable")]);

    expect(counts).toMatchObject({ ignored: 1, failed: 1 });
    expect(storedEvents().map(({ id }) => id)).toEqual(["a"]);
    expect(console.error).toHaveBeenCalled();
  });

  it.each([
    ["isn't about a job application", verdict("rejection", { job_related: false })],
    ["only confirms receipt", verdict("received")],
    ["is classified with low confidence", verdict("rejection", { confidence: 0.4 })]
  ])("ignores an email that %s", async (_title, answer) => {
    mockDatabase();
    mockClaude({ Mail: answer });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ ignored: 1, pending: 0, autoApplied: 0 });
    expect(storedEvents()).toEqual([expect.objectContaining({ state: "ignored", applicationId: null })]);
  });

  it("leaves a decision from an unknown company for the user to review", async () => {
    mockDatabase();
    mockClaude({ Mail: verdict("rejection", { company: "Initech" }) });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ pending: 1 });
    expect(storedEvents()).toEqual([expect.objectContaining({ state: "pending", status: "Rejected", applicationId: null })]);
  });

  it("ignores an email that arrived before the application was made", async () => {
    mockDatabase();
    mockClaude({ Mail: verdict("interview") });

    expect(await emailService.ingest(7, true, [email("a", "Mail", { date: new Date("2026-02-01T09:00:00Z") })])).toMatchObject({ ignored: 1 });
  });

  it("adds a step dated the day of the email when everything matches with confidence, and records it", async () => {
    mockDatabase();
    mockClaude({ Mail: verdict("interview") });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ autoApplied: 1, pending: 0 });
    expect(storedEvents()).toEqual([{ id: "a", state: "auto_applied", status: "Interview", applicationId: 1, candidateIds: [], previousStatus: "Applied", stepId: "11" }]);
    expect(client.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0])).toEqual(["BEGIN", "SELECT", "SELECT", "INSERT", "UPDATE", "INSERT", "COMMIT"]);
    expect(client.query.mock.calls[3][1]).toEqual([1, 7, 1, "Interview", "2026-04-10"]);
  });

  it("dates the step today when the email claims a later date", async () => {
    mockDatabase();
    mockClaude({ Mail: verdict("interview") });

    expect(await emailService.ingest(7, true, [email("a", "Mail", { date: new Date("2099-01-01T09:00:00Z") })])).toMatchObject({ autoApplied: 1 });
    expect(client.query.mock.calls[3][1]).toEqual([1, 7, 1, "Interview", new Date().toISOString().slice(0, 10)]);
  });

  it("ignores an email for an application whose journey is full", async () => {
    const steps = Array.from({ length: 10 }, (_, index) => ({ ...APPLIED_STEP, id: String(index) }));

    mockDatabase({ applications: [{ ...ACME, steps }] });
    mockClaude({ Mail: verdict("interview") });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ ignored: 1, autoApplied: 0 });
    expect(client.query).not.toHaveBeenCalled();
  });

  it("asks the user first when automatic updates are off", async () => {
    mockDatabase();
    mockClaude({ Mail: verdict("interview") });

    expect(await emailService.ingest(7, false, [email("a", "Mail")])).toMatchObject({ pending: 1, autoApplied: 0 });
    expect(storedEvents()).toEqual([expect.objectContaining({ state: "pending", status: "Interview", applicationId: 1 })]);
    expect(client.query.mock.calls.some(([sql]) => sql.includes("UPDATE applications"))).toBe(false);
  });

  it("asks the user first when Claude isn't confident enough for an automatic update", async () => {
    mockDatabase();
    mockClaude({ Mail: verdict("interview", { confidence: 0.8 }) });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ pending: 1, autoApplied: 0 });
  });

  it("asks the user first when the application has an upcoming interview", async () => {
    const steps = [APPLIED_STEP, { id: "11", status: "Interview", date: "2099-01-01" }];

    mockDatabase({ applications: [{ ...ACME, status: "Interview", steps }] });
    mockClaude({ Mail: verdict("rejection") });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ pending: 1, autoApplied: 0 });
    expect(client.query).not.toHaveBeenCalled();
  });

  it("asks the user first before marking an offer as rejected", async () => {
    mockDatabase({ applications: [{ ...ACME, status: "Offer" }] });
    mockClaude({ Mail: verdict("rejection") });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ pending: 1, autoApplied: 0 });
  });

  it("ignores a decision that wouldn't move the application forward", async () => {
    mockDatabase({ applications: [{ ...ACME, status: "Offer" }] });
    mockClaude({ Mail: verdict("interview") });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ ignored: 1 });
  });

  it("offers the user the candidate applications when several fit", async () => {
    const second = { ...ACME, id: 3, position: "Frontend Developer" };

    mockDatabase({ applications: [{ ...ACME }, second] });
    mockClaude({ Mail: verdict("interview") });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ pending: 1 });
    expect(storedEvents()[0]).toMatchObject({ state: "pending", applicationId: null, candidateIds: expect.arrayContaining([1, 3]) });
  });

  it("offers only the candidates the decision could still apply to", async () => {
    const closed = { ...ACME, id: 3, position: "Frontend Developer", status: "Rejected" };

    mockDatabase({ applications: [{ ...ACME }, closed] });
    mockClaude({ Mail: verdict("interview") });
    await emailService.ingest(7, true, [email("a", "Mail")]);

    expect(storedEvents()[0].candidateIds).toEqual([1]);
  });

  it("ignores an ambiguous email when no candidate could change", async () => {
    mockDatabase({ applications: [{ ...ACME, status: "Rejected" }, { ...ACME, id: 3, position: "Frontend Developer", status: "Withdrawn" }] });
    mockClaude({ Mail: verdict("interview") });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ ignored: 1 });
  });

  it("suggests another interview for an invitation to a new round after the current interview, for review only", async () => {
    mockDatabase({ applications: [{ ...INTERVIEWED }] });
    mockClaude({ Mail: verdict("interview", { interview_kind: "new_round" }) });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ pending: 1, autoApplied: 0 });
    expect(storedEvents()).toEqual([expect.objectContaining({ state: "pending", status: "Interview", applicationId: 1 })]);
    expect(client.query).not.toHaveBeenCalled();
  });

  it.each([
    ["is about arranging the current interview", "logistics", "2026-04-01"],
    ["isn't clearly a new round", "unclear", "2026-04-01"],
    ["arrived on the current interview's day", "new_round", "2026-04-10"],
    ["arrived before the current interview", "new_round", "2026-04-20"]
  ])("ignores an interview email for an application at Interview that %s", async (_title, kind, interviewDate) => {
    const steps = [APPLIED_STEP, { id: "12", status: "Interview", date: interviewDate }];

    mockDatabase({ applications: [{ ...ACME, status: "Interview", steps }] });
    mockClaude({ Mail: verdict("interview", { interview_kind: kind }) });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ ignored: 1, pending: 0 });
  });

  it("ignores another round while a suggestion of it already waits for review", async () => {
    mockDatabase({ applications: [{ ...INTERVIEWED }], waiting: [{ application_id: 1, suggested_status: "Interview" }] });
    mockClaude({ Mail: verdict("interview", { interview_kind: "new_round" }) });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ ignored: 1, pending: 0 });
  });

  it("suggests another round only once for several invitations in the same sync", async () => {
    mockDatabase({ applications: [{ ...INTERVIEWED }] });
    mockClaude({ One: verdict("interview", { interview_kind: "new_round" }), Two: verdict("interview", { interview_kind: "new_round" }) });
    const counts = await emailService.ingest(7, true, [email("a", "One"), email("b", "Two")]);

    expect(counts).toMatchObject({ pending: 1, ignored: 1 });
    expect(storedEvents().map(({ id, state }) => [id, state])).toEqual([["a", "pending"], ["b", "ignored"]]);
  });

  it("offers an application at Interview as a candidate only for a new round", async () => {
    const second = { ...ACME, id: 3, position: "Frontend Developer" };

    mockDatabase({ applications: [{ ...INTERVIEWED }, second] });
    mockClaude({ New: verdict("interview", { interview_kind: "new_round" }), Logistics: verdict("interview", { interview_kind: "logistics" }) });
    await emailService.ingest(7, true, [email("a", "New"), email("b", "Logistics")]);

    expect(storedEvents().map(({ candidateIds }) => [...candidateIds].sort())).toEqual([[1, 3], [3]]);
  });

  it("processes the oldest emails first, so later ones see the updated status", async () => {
    mockDatabase();
    mockClaude({ Offer: verdict("offer"), Interview: verdict("interview") });
    const counts = await emailService.ingest(7, true, [
      email("late", "Offer", { date: new Date("2026-04-12T09:00:00Z") }),
      email("early", "Interview", { date: new Date("2026-04-10T09:00:00Z") })
    ]);

    expect(counts).toMatchObject({ autoApplied: 2 });
    expect(storedEvents().map(({ id, previousStatus }) => [id, previousStatus])).toEqual([["early", "Applied"], ["late", "Interview"]]);
  });

  it("classifies at most 4 emails at the same time", async () => {
    mockDatabase();
    const answers = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`Mail ${index}`, verdict("received")]));
    const { inFlight } = mockClaude(answers, 5);

    await emailService.ingest(7, true, Array.from({ length: 10 }, (_, index) => email(`m${index}`, `Mail ${index}`)));

    expect(inFlight.max).toBe(4);
  });

  it("stores a one-line preview of up to 200 characters", async () => {
    mockDatabase();
    mockClaude({ Mail: verdict("received") });
    await emailService.ingest(7, true, [email("a", "Mail", { body: `  Line one\n\n\tline   two ${"x".repeat(300)}` })]);

    const [, params] = db.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO email_events"));

    expect(params[5]).toHaveLength(200);
    expect(params[5].startsWith("Line one line two xxx")).toBe(true);
  });

  it("returns early when there is nothing new to classify", async () => {
    mockDatabase();

    expect(await emailService.ingest(7, true, [])).toMatchObject({ received: 0, known: 0 });
    expect(db.query.mock.calls.some(([sql]) => sql.includes("FROM applications"))).toBe(false);
  });
});
