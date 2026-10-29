import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const db = require("../../../config/db");
const { APPLICATION_FIELDS } = require("../../applications/applicationFields");
const emailService = require("../emailService");

const ACME = { id: 1, company: "Acme", position: "Backend Engineer", status: "Applied", applied_at: "2026-03-01" };
const GLOBEX = { id: 2, company: "Globex", position: "Data Analyst", status: "Applied", applied_at: "2026-03-01" };

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

describe("ingest", () => {
  let client;

  // Mocks the database: which emails are known, how many were used today and the user's applications
  function mockDatabase({ known = [], used = 0, applications = [ACME, GLOBEX].map((application) => ({ ...application })) } = {}) {
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("SELECT message_id")) return rows(...known.map((id) => ({ message_id: id })));
      if (sql.includes("COUNT(*)")) return rows({ used });
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

    return calls.map(([, p]) => ({ id: p[1], state: p[14], status: p[10], applicationId: p[11], candidateIds: p[12], previousStatus: p[13] }));
  }

  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    client = { query: vi.fn().mockResolvedValue(rows()), release: vi.fn() };
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

  it("updates the application's status when everything matches with confidence", async () => {
    mockDatabase();
    mockClaude({ Mail: verdict("interview") });

    expect(await emailService.ingest(7, true, [email("a", "Mail")])).toMatchObject({ autoApplied: 1, pending: 0 });
    expect(storedEvents()).toEqual([{ id: "a", state: "auto_applied", status: "Interview", applicationId: 1, candidateIds: [], previousStatus: "Applied" }]);
    expect(client.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0])).toEqual(["BEGIN", "UPDATE", "INSERT", "COMMIT"]);
    expect(client.query.mock.calls[1][1]).toEqual([1, 7, "Interview"]);
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
