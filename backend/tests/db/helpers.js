import { createRequire } from "node:module";
import crypto from "node:crypto";
import request from "supertest";
import { vi } from "vitest";

const require = createRequire(import.meta.url);
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const db = require("../../src/config/db");
const auth = require("../../src/services/auth/authService");
const mfa = require("../../src/services/auth/mfa");
const { FIRST_STATUS } = require("../../src/services/applications/statusStates");

export const ORIGIN = process.env.FRONTEND_ORIGIN;
export const PASSWORD = "Str0ng!Passw0rd";

// Creates a user, verified and with an authenticator by default
export async function createUser({ email = "dana@example.com", password = PASSWORD, verified = true, authenticator = true } = {}) {
  const secret = authenticator ? mfa.generateTotpSecret() : null;
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, email_verified, totp_secret, totp_enabled)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, token_version`,
    [email, await bcrypt.hash(password, 4), verified, secret && mfa.encryptSecret(secret), authenticator]
  );

  return { ...rows[0], password, totpSecret: secret };
}

// Signs a user in without going through the login steps, returning what a browser would send
export async function signIn(user) {
  const cookies = {};
  const res = { cookie: (name, value) => { cookies[name] = value; }, clearCookie: () => {} };

  await auth.issueSession(res, user);

  return { cookie: `token=${cookies.token}`, csrfToken: jwt.decode(cookies.token).csrfToken };
}

// Builds a client for the API that sends the headers a signed-in browser would
export function api(session = null) {
  // Starts a request with the browser's headers
  const start = (method) => (path) => {
    const req = request(app)[method](path).set("Origin", ORIGIN);

    return session ? req.set("Cookie", session.cookie).set("X-CSRF-Token", session.csrfToken) : req;
  };

  return { get: start("get"), post: start("post"), put: start("put"), patch: start("patch"), delete: start("delete") };
}

// Creates a user and returns a client signed in as them
export async function signedInClient(options) {
  const user = await createUser(options);

  return { user, client: api(await signIn(user)) };
}

/* Adds an application for a user with its steps and returns its row. The steps are the given journey (a list of
   [status, date]), or as the schema's backfill makes them: the first status on the applied date (or today), then the
   status when it's another one */
export async function createApplication(userId, values = {}) {
  const row = { company: "Acme", position: "Backend Engineer", location: "Haifa", status: FIRST_STATUS, ...values };
  const today = new Date().toISOString().slice(0, 10);
  const firstDate = row.applied_at || today;
  const journey = row.journey ?? [[FIRST_STATUS, firstDate], ...(row.status === FIRST_STATUS ? [] : [[row.status, firstDate > today ? firstDate : today]])];
  const status = journey[journey.length - 1][0];
  const { rows } = await db.query(
    `INSERT INTO applications (user_id, company, position, location, workplace_model, status, job_url, notes, applied_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, company, position, location, workplace_model, status, job_url, notes, applied_at`,
    [userId, row.company, row.position, row.location, row.workplace_model ?? null, status, row.job_url ?? null, row.notes ?? null, row.applied_at ?? null]
  );

  for (const [position, [stepStatus, date]] of journey.entries()) {
    await db.query(
      `INSERT INTO application_steps (application_id, user_id, position, status, step_date) VALUES ($1, $2, $3, $4, $5)`,
      [rows[0].id, userId, position, stepStatus, date]
    );
  }

  return rows[0];
}

// Lists an application's steps as [status, date], oldest first
export async function stepsOf(applicationId) {
  const { rows } = await db.query(
    `SELECT status, TO_CHAR(step_date, 'YYYY-MM-DD') AS date FROM application_steps WHERE application_id = $1 ORDER BY position`,
    [applicationId]
  );

  return rows.map(({ status, date }) => [status, date]);
}

// Adds an email event for a user and returns its ID
export async function createEvent(userId, values = {}) {
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
    step_id: null,
    ...values
  };
  const { rows } = await db.query(
    `INSERT INTO email_events
       (user_id, message_id, received_at, sender, subject, snippet, event_type, company, position, confidence,
        suggested_status, application_id, candidate_ids, previous_status, state, resolved_at, step_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING id`,
    [userId, row.message_id, row.received_at, row.sender, row.subject, row.snippet, row.event_type, row.company, row.position, row.confidence,
      row.suggested_status, row.application_id, row.candidate_ids, row.previous_status, row.state, row.resolved_at, row.step_id]
  );

  return rows[0].id;
}

// Computes the authenticator app's 6-digit code for a secret at a time, written separately from the server's own code
export function totp(secret, at = Date.now()) {
  const bytes = [];
  let bits = 0;
  let value = 0;

  for (const char of secret.replace(/\s/g, "")) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  const message = Buffer.alloc(8);

  message.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));

  const digest = crypto.createHmac("sha1", Buffer.from(bytes)).update(message).digest();
  const offset = digest[digest.length - 1] & 0xf;

  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// Builds a browser that keeps the cookies the API sets, and the CSRF token once it has asked for it
export function browser() {
  const jar = new Map();
  const state = { csrfToken: null };

  // Stores the cookies a response sets, and forgets the ones it clears
  const remember = (res) => {
    for (const line of res.headers["set-cookie"] ?? []) {
      const [pair] = line.split(";");
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);

      if (value) jar.set(name, value);
      else jar.delete(name);
    }
  };

  // Starts a request with the stored cookies
  const start = (method) => (path) => {
    const req = request(app)[method](path).set("Origin", ORIGIN).on("response", remember);

    if (jar.size) req.set("Cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
    if (state.csrfToken) req.set("X-CSRF-Token", state.csrfToken);

    return req;
  };

  return {
    get: start("get"),
    post: start("post"),
    put: start("put"),
    patch: start("patch"),
    delete: start("delete"),
    cookies: () => Object.fromEntries(jar),
    async useSession() {
      state.csrfToken = (await start("get")("/api/auth/csrf")).body.csrfToken;
    }
  };
}

// Records the emails the server would send, which it logs when no mail provider is set
export function captureMail() {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const lines = () => log.mock.calls.map(([line]) => String(line));

  return {
    codes: (kind) => lines().filter((line) => line.includes(`${kind} code for`)).map((line) => /: (\d{6})$/.exec(line)[1]),
    notices: () => lines().filter((line) => / notice for /.test(line)).map((line) => / (\w+) notice for (.+?)( \(|$)/.exec(line).slice(1, 3).join(" "))
  };
}
