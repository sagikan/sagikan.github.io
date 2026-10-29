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

// Adds an application for a user and returns its row
export async function createApplication(userId, values = {}) {
  const row = { company: "Acme", position: "Backend Engineer", location: "Haifa", status: "Applied", ...values };
  const { rows } = await db.query(
    `INSERT INTO applications (user_id, company, position, location, workplace_model, status, job_url, notes, applied_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, company, position, location, workplace_model, status, job_url, notes, applied_at`,
    [userId, row.company, row.position, row.location, row.workplace_model ?? null, row.status, row.job_url ?? null, row.notes ?? null, row.applied_at ?? null]
  );

  return rows[0];
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
