import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookieOptions, cookieValue, mockResponse } from "../../../../tests/helpers/http";
import { mockFetch } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken");
const db = require("../../../config/db");
const mfa = require("../mfa");
const auth = require("../authService");

const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const USER = { id: 7, email: "dana.levi@example.com", token_version: 3 };
const STRONG = "Str0ng!Passw0rd";

// Signs a token with the test secret, the way the service does
function sign(payload, options = {}) {
  return jwt.sign(payload, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: 600, ...options });
}

// Freezes the clock, leaving timers alone
function freezeTime(iso = "2026-10-29T12:00:00Z") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

// Builds a database result with rows
function rows(...list) {
  return { rows: list, rowCount: list.length };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("validatePassword", () => {
  it("accepts a strong password", () => {
    expect(auth.validatePassword(STRONG, USER.email)).toBeNull();
  });

  it.each([
    ["not a string", 12345, "Invalid password."],
    ["too short", "Aa1!aaaa", "Password must be 12–72 characters long."],
    ["longer than 72 bytes", `Aa1!${"é".repeat(40)}`, "Password must be 12–72 characters long."],
    ["missing a class of characters", "strongpassword1!", "Password must include uppercase and lowercase letters, a number and a symbol."],
    ["containing the email handle", "My-dana.levi-9!X", "Password must not contain your email address."]
  ])("rejects a password that is %s", (_title, password, message) => {
    expect(auth.validatePassword(password, USER.email)).toBe(message);
  });

  it("ignores an email handle shorter than 3 characters", () => {
    expect(auth.validatePassword("Jo-Str0ng!Password", "jo@example.com")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it.each([
    ["  Dana@Example.COM ", "dana@example.com"],
    [null, ""],
    [undefined, ""]
  ])("turns %j into %j", (value, expected) => {
    expect(auth.normalizeEmail(value)).toBe(expected);
  });
});

describe("isValidEmail", () => {
  it.each([
    ["dana@example.com", true],
    ["dana.levi+jobs@mail.example.co.il", true],
    ["dana@example", false],
    ["dana example@mail.com", false],
    ["@example.com", false],
    ["dana@@example.com", false],
    ["dana@example..com", false],
    ["dana@.example.com", false],
    ["dana@example.com.", false],
    ["", false],
    [undefined, false],
    [42, false]
  ])("treats %j as valid: %s", (email, expected) => {
    expect(auth.isValidEmail(email)).toBe(expected);
  });

  it("accepts an address of 254 characters and refuses one of 255", () => {
    const domain = "@example.com";

    expect(auth.isValidEmail(`${"a".repeat(254 - domain.length)}${domain}`)).toBe(true);
    expect(auth.isValidEmail(`${"a".repeat(255 - domain.length)}${domain}`)).toBe(false);
  });

  it.each([
    ["many dot-separated parts that end badly", `!@!.${"!.".repeat(50000)} `],
    ["many dot-separated parts that end well", `a@${"!.".repeat(50000)}x`],
    ["a long local part", `${"!".repeat(100000)}@`],
    ["a long domain without a dot", `a@${"!".repeat(100000)}`]
  ])("answers quickly for %s, so a crafted email can't tie the server up", (_title, email) => {
    const started = performance.now();

    expect(auth.isValidEmail(email)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("hashSessionId", () => {
  it("returns the same 64-character hex hash for the same ID", () => {
    expect(auth.hashSessionId("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(auth.hashSessionId("abc")).toBe(auth.hashSessionId("abc"));
    expect(auth.hashSessionId("abd")).not.toBe(auth.hashSessionId("abc"));
  });
});

describe("verifyToken", () => {
  it("returns the payload of a valid token", () => {
    expect(auth.verifyToken(sign({ id: 1 }))).toMatchObject({ id: 1 });
  });

  it("rejects a token signed with another secret", () => {
    expect(() => auth.verifyToken(jwt.sign({ id: 1 }, "another-secret", { algorithm: "HS256" }))).toThrow();
  });

  it("rejects an expired token", () => {
    freezeTime();
    const token = sign({ id: 1 }, { expiresIn: 60 });

    vi.setSystemTime(new Date("2026-10-29T12:02:00Z"));

    expect(() => auth.verifyToken(token)).toThrow("jwt expired");
  });

  it("rejects a token signed with another algorithm", () => {
    expect(() => auth.verifyToken(sign({ id: 1 }, { algorithm: "HS512" }))).toThrow();
  });

  it("rejects a token with no signature", () => {
    expect(() => auth.verifyToken(jwt.sign({ id: 1 }, null, { algorithm: "none" }))).toThrow();
  });

  it("rejects a missing token", () => {
    expect(() => auth.verifyToken(undefined)).toThrow();
  });
});

describe("issueSession", () => {
  it("stores the hashed session and sets a session cookie that ends with the session", async () => {
    freezeTime();
    const query = vi.spyOn(db, "query").mockResolvedValue(rows({ expires_at: new Date("2026-10-30T12:00:00Z") }));
    const res = mockResponse();

    await auth.issueSession(res, USER);

    const [sql, params] = query.mock.calls[0];
    const payload = jwt.decode(cookieValue(res, "token"));

    expect(sql).toContain("INSERT INTO sessions");
    expect(params).toEqual([auth.hashSessionId(payload.sid), 7, 24]);
    expect(payload).toMatchObject({ id: 7, typ: "session", ver: 3 });
    expect(payload.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.exp - payload.iat).toBe(3600);
    expect(cookieOptions(res, "token")).toMatchObject({ httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 3600 * 1000 });
  });

  it("shortens the cookie to the time the session has left", async () => {
    freezeTime();
    vi.spyOn(db, "query").mockResolvedValue(rows({ expires_at: new Date("2026-10-29T12:02:00Z") }));
    const res = mockResponse();

    await auth.issueSession(res, USER);

    expect(cookieOptions(res, "token").maxAge).toBe(120 * 1000);
    expect(jwt.decode(cookieValue(res, "token")).exp - jwt.decode(cookieValue(res, "token")).iat).toBe(120);
  });

  it("clears the pending sign-in cookie", async () => {
    vi.spyOn(db, "query").mockResolvedValue(rows({ expires_at: new Date(Date.now() + 3600 * 1000) }));
    const res = mockResponse();

    await auth.issueSession(res, USER);

    expect(res.clearCookie).toHaveBeenCalledWith("pending_auth", expect.objectContaining({ httpOnly: true }));
  });
});

describe("renewSession", () => {
  const claims = { id: 7, typ: "session", ver: 3, sid: "abc", csrfToken: "csrf" };

  it("leaves a fresh cookie alone", () => {
    freezeTime();
    const res = mockResponse();

    auth.renewSession(res, { ...claims, iat: Math.floor(Date.now() / 1000) - 60 }, Date.now() + 3600 * 1000);

    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("issues a new cookie with the same claims once the old one is 5 minutes old", () => {
    freezeTime();
    const res = mockResponse();

    auth.renewSession(res, { ...claims, iat: Math.floor(Date.now() / 1000) - 300, exp: 1 }, Date.now() + 3600 * 1000);

    expect(jwt.decode(cookieValue(res, "token"))).toMatchObject({ ...claims, iat: Math.floor(Date.now() / 1000) });
  });
});

describe("session cleanup", () => {
  it("ends one session by its hashed ID", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValue(rows());

    await auth.endSession("abc");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM sessions WHERE id_hash"), [auth.hashSessionId("abc")]);
  });

  it("ends every session of a user on the given connection", async () => {
    const client = { query: vi.fn().mockResolvedValue(rows()) };

    await auth.endAllSessions(client, 7);

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("WHERE user_id"), [7]);
  });

  it("removes expired sessions", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValue(rows());

    await auth.removeExpiredSessions();

    expect(query).toHaveBeenCalledWith(expect.stringContaining("expires_at < NOW()"));
  });

  it("clears the session and pending cookies", () => {
    const res = mockResponse();

    auth.clearSessionCookies(res);

    expect(res.clearCookie.mock.calls.map(([name]) => name)).toEqual(["token", "pending_auth"]);
  });
});

describe("setPending and requirePending", () => {
  // Runs the middleware and returns what it did
  async function run(stage, cookies) {
    const next = vi.fn();
    const res = mockResponse();
    const req = { cookies };

    await auth.requirePending(stage)(req, res, next);

    return { req, res, next };
  }

  it("sets a short-lived pending cookie for the stage", () => {
    const res = mockResponse();

    auth.setPending(res, USER, "mfa");

    expect(jwt.decode(cookieValue(res, "pending_auth"))).toMatchObject({ id: 7, typ: "pending", ver: 3, stage: "mfa" });
    expect(cookieOptions(res, "pending_auth")).toMatchObject({ httpOnly: true, maxAge: 15 * 60 * 1000 });
  });

  it("lets a matching pending sign-in through and exposes it on the request", async () => {
    vi.spyOn(db, "query").mockResolvedValue(rows({ token_version: 3 }));
    const { req, next, res } = await run("mfa", { pending_auth: sign({ id: 7, typ: "pending", ver: 3, stage: "mfa" }) });

    expect(next).toHaveBeenCalledOnce();
    expect(req.pending).toMatchObject({ id: 7, stage: "mfa" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ["has no cookie", undefined, rows({ token_version: 3 })],
    ["has a token for another stage", sign({ id: 7, typ: "pending", ver: 3, stage: "verify_email" }), rows({ token_version: 3 })],
    ["has a session token instead of a pending one", sign({ id: 7, typ: "session", ver: 3, stage: "mfa" }), rows({ token_version: 3 })],
    ["has a stale token version", sign({ id: 7, typ: "pending", ver: 2, stage: "mfa" }), rows({ token_version: 3 })],
    ["belongs to a deleted user", sign({ id: 7, typ: "pending", ver: 3, stage: "mfa" }), rows()],
    ["has a garbled token", "not.a.token", rows({ token_version: 3 })]
  ])("restarts the sign-in when the request %s", async (_title, cookie, result) => {
    vi.spyOn(db, "query").mockResolvedValue(result);
    const { res, next, req } = await run("mfa", { pending_auth: cookie });

    expect(next).not.toHaveBeenCalled();
    expect(req.pending).toBeUndefined();
    expect(res.clearCookie).toHaveBeenCalledWith("pending_auth", expect.anything());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Your sign-in session expired. Please log in again.", restart: true });
  });

  it("restarts the sign-in when the request has no cookies at all", async () => {
    const { res, next } = await run("mfa", undefined);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("nextStage", () => {
  it.each([
    ["an unverified email", { email_verified: false, totp_enabled: false }, "verify_email"],
    ["no authenticator yet", { email_verified: true, totp_enabled: false }, "mfa_setup"],
    ["everything set up", { email_verified: true, totp_enabled: true }, "mfa"]
  ])("asks for the next step for %s", (_title, user, expected) => {
    expect(auth.nextStage(user)).toBe(expected);
  });
});

describe("getUser", () => {
  it("returns the user's row, or undefined", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValueOnce(rows(USER)).mockResolvedValueOnce(rows());

    expect(await auth.getUser(7)).toEqual(USER);
    expect(await auth.getUser(8)).toBeUndefined();
    expect(query.mock.calls[0][1]).toEqual([7]);
  });
});

describe("withTransaction", () => {
  // Stands in for a pooled connection
  function connection() {
    const client = { query: vi.fn().mockResolvedValue(rows()), release: vi.fn() };

    vi.spyOn(db, "connect").mockResolvedValue(client);

    return client;
  }

  it("commits and returns the callback's result", async () => {
    const client = connection();
    const result = await auth.withTransaction(async () => "done");

    expect(result).toBe("done");
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "COMMIT"]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back, rethrows and releases the connection when the callback fails", async () => {
    const client = connection();

    await expect(auth.withTransaction(async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("hands the connection to the callback", async () => {
    const client = connection();

    await auth.withTransaction(async (given) => expect(given).toBe(client));
  });
});

describe("sendEmailCode", () => {
  beforeEach(() => {
    vi.stubEnv("MFA_ENCRYPTION_KEY", KEY);
    vi.stubEnv("BREVO_API_KEY", "brevo-key");
    vi.stubEnv("MAIL_FROM", "no-reply@acme.com");
  });

  // Mocks the lookup of the user's last code, then the insert
  function lastCode(row) {
    return vi.spyOn(db, "query").mockResolvedValueOnce(rows(...(row ? [row] : []))).mockResolvedValue(rows());
  }

  it("emails a new code and stores only its hash", async () => {
    const query = lastCode(null);
    const fetchMock = mockFetch(() => new Response("{}", { status: 201 }));

    expect(await auth.sendEmailCode(USER, "verify")).toEqual({ sent: true });

    const code = /^(\d{6}) is/.exec(JSON.parse(fetchMock.mock.calls[0][1].body).subject)[1];
    const [sql, params] = query.mock.calls[1];

    expect(sql).toContain("INSERT INTO email_verifications");
    expect(params).toEqual([7, mfa.hashCode(code), 15]);
  });

  it("uses the password reset table for reset codes", async () => {
    const query = lastCode(null);

    mockFetch(() => new Response("{}", { status: 201 }));
    await auth.sendEmailCode(USER, "reset");

    expect(query.mock.calls[0][0]).toContain("FROM password_resets");
  });

  it("asks to wait when the last code was sent less than a minute ago", async () => {
    lastCode({ age: "10.2", valid: true, sends_today: 1 });
    const fetchMock = mockFetch(() => new Response("{}", { status: 201 }));

    expect(await auth.sendEmailCode(USER, "verify", { force: true })).toEqual({ retryAfter: 50 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't send again while the last code is still valid, unless forced", async () => {
    lastCode({ age: "120", valid: true, sends_today: 1 });
    const fetchMock = mockFetch(() => new Response("{}", { status: 201 }));

    expect(await auth.sendEmailCode(USER, "verify")).toEqual({ sent: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends again when forced and the wait is over", async () => {
    lastCode({ age: "120", valid: true, sends_today: 1 });
    mockFetch(() => new Response("{}", { status: 201 }));

    expect(await auth.sendEmailCode(USER, "verify", { force: true })).toEqual({ sent: true });
  });

  it("stops at 8 codes a day", async () => {
    lastCode({ age: "9999", valid: false, sends_today: 8 });
    const fetchMock = mockFetch(() => new Response("{}", { status: 201 }));

    expect(await auth.sendEmailCode(USER, "verify")).toEqual({ dailyLimit: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't store a code that couldn't be emailed", async () => {
    const query = lastCode(null);

    mockFetch(() => new Response("down", { status: 500 }));

    await expect(auth.sendEmailCode(USER, "verify")).rejects.toThrow("Brevo responded 500");
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("checkEmailCode", () => {
  beforeEach(() => {
    vi.stubEnv("MFA_ENCRYPTION_KEY", KEY);
  });

  // Mocks the stored code row and records the attempt update
  function stored(row) {
    return vi.spyOn(db, "query").mockResolvedValueOnce(rows(...(row ? [row] : []))).mockResolvedValue(rows());
  }

  it("accepts the right code, ignoring spaces, without counting an attempt", async () => {
    const query = stored({ code_hash: mfa.hashCode("123456"), attempts: 0, valid: true });

    expect(await auth.checkEmailCode("verify", 7, "123 456")).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no code was requested", null],
    ["the code expired", { code_hash: "x", attempts: 0, valid: false }]
  ])("reports an expired code when %s", async (_title, row) => {
    stored(row);

    expect(await auth.checkEmailCode("verify", 7, "123456")).toEqual({ status: 400, error: "This code has expired. Request a new one." });
  });

  it("refuses after 5 attempts, even for the right code", async () => {
    stored({ code_hash: mfa.hashCode("123456"), attempts: 5, valid: true });

    expect(await auth.checkEmailCode("verify", 7, "123456")).toEqual({ status: 429, error: "Too many attempts. Request a new code." });
  });

  it.each([
    ["a wrong code", "654321"],
    ["a short code", "12345"],
    ["letters", "abcdef"],
    ["no code", undefined]
  ])("counts an attempt for %s", async (_title, code) => {
    const query = stored({ code_hash: mfa.hashCode("123456"), attempts: 1, valid: true });

    expect(await auth.checkEmailCode("reset", 7, code)).toEqual({ status: 400, error: "Incorrect code. Please try again." });
    expect(query.mock.calls[1]).toEqual([expect.stringContaining("UPDATE password_resets SET attempts = attempts + 1"), [7]]);
  });
});

describe("lockedMessage", () => {
  it.each([
    ["no lock", null],
    ["a lock in the past", "2026-10-29T11:00:00Z"]
  ])("returns nothing for %s", (_title, until) => {
    freezeTime();

    expect(auth.lockedMessage(until)).toBeNull();
  });

  it.each([
    ["2026-10-29T12:05:00Z", "Too many failed attempts. Try again in 5 minutes."],
    ["2026-10-29T12:00:30Z", "Too many failed attempts. Try again in 1 minute."]
  ])("tells how long a lock until %s lasts, rounded up", (until, message) => {
    freezeTime();

    expect(auth.lockedMessage(until)).toBe(message);
  });
});

describe("recordFailure", () => {
  it("counts a failed login, locking for 15 minutes after 10", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValue(rows());

    await auth.recordFailure(7, "login");

    expect(query.mock.calls[0][0]).toContain("failed_login_attempts");
    expect(query.mock.calls[0][0]).toContain("login_locked_until");
    expect(query.mock.calls[0][1]).toEqual([7, 10, 15]);
  });

  it("counts a failed second factor, locking for 15 minutes after 5", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValue(rows());

    await auth.recordFailure(7, "mfa");

    expect(query.mock.calls[0][0]).toContain("mfa_failed_attempts");
    expect(query.mock.calls[0][0]).toContain("mfa_locked_until");
    expect(query.mock.calls[0][1]).toEqual([7, 5, 15]);
  });
});

describe("verifySecondFactor", () => {
  beforeEach(() => {
    vi.stubEnv("MFA_ENCRYPTION_KEY", KEY);
  });

  // Builds a user with an authenticator secret
  function userWithTotp(extra = {}) {
    return { id: 7, totp_secret: mfa.encryptSecret(RFC_SECRET), totp_last_step: null, mfa_locked_until: null, ...extra };
  }

  // Lists the first words of each SQL statement run
  function statements(query) {
    return query.mock.calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 3).join(" "));
  }

  it("refuses while the account is locked, without touching the database", async () => {
    freezeTime();
    const query = vi.spyOn(db, "query");
    const result = await auth.verifySecondFactor(userWithTotp({ mfa_locked_until: "2026-10-29T12:10:00Z" }), { code: "287082" });

    expect(result).toEqual({ verified: false, status: 429, error: "Too many failed attempts. Try again in 10 minutes." });
    expect(query).not.toHaveBeenCalled();
  });

  it("accepts a correct authenticator code, remembers its time step and clears the failures", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(59_000);
    const query = vi.spyOn(db, "query").mockResolvedValue(rows({}));
    const result = await auth.verifySecondFactor(userWithTotp(), { code: "287082" });

    expect(result).toEqual({ verified: true, recoveryCodesLeft: undefined });
    expect(query.mock.calls[0][1]).toEqual([7, 1]);
    expect(statements(query)).toEqual(["UPDATE users SET", "UPDATE users SET"]);
    expect(query.mock.calls[1][0]).toContain("mfa_failed_attempts = 0");
  });

  it("rejects a wrong authenticator code and counts the failure", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(59_000);
    const query = vi.spyOn(db, "query").mockResolvedValue(rows());
    const result = await auth.verifySecondFactor(userWithTotp(), { code: "000000" });

    expect(result).toEqual({ verified: false, status: 400, error: "Incorrect code. Check your authenticator app and try again." });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([7, 5, 15]);
  });

  it("rejects a code whose time step was already used", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(59_000);
    vi.spyOn(db, "query").mockResolvedValue(rows());

    expect(await auth.verifySecondFactor(userWithTotp({ totp_last_step: 1 }), { code: "287082" })).toMatchObject({ verified: false, status: 400 });
  });

  it("rejects a valid code when another request stored the same step first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(59_000);
    vi.spyOn(db, "query").mockResolvedValue({ rows: [], rowCount: 0 });

    expect(await auth.verifySecondFactor(userWithTotp(), { code: "287082" })).toMatchObject({ verified: false });
  });

  it("accepts an unused recovery code and reports how many are left", async () => {
    const query = vi.spyOn(db, "query")
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
      .mockResolvedValueOnce(rows({ count: 7 }))
      .mockResolvedValue(rows());
    const result = await auth.verifySecondFactor(userWithTotp(), { recoveryCode: "abcde-fgh23" });

    expect(result).toEqual({ verified: true, recoveryCodesLeft: 7 });
    expect(query.mock.calls[0][1]).toEqual([7, mfa.hashCode("ABCDEFGH23")]);
  });

  it("rejects a recovery code that is wrong or used, and counts the failure", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValue({ rows: [], rowCount: 0 });
    const result = await auth.verifySecondFactor(userWithTotp(), { recoveryCode: "ABCDE-FGH23" });

    expect(result).toEqual({ verified: false, status: 400, error: "That recovery code is invalid or has already been used." });
    expect(query.mock.calls[1][1]).toEqual([7, 5, 15]);
  });
});

describe("recovery codes", () => {
  beforeEach(() => {
    vi.stubEnv("MFA_ENCRYPTION_KEY", KEY);
  });

  it("counts the unused recovery codes", async () => {
    vi.spyOn(db, "query").mockResolvedValue(rows({ count: 4 }));

    expect(await auth.countRecoveryCodes(7)).toBe(4);
  });

  it("replaces the old codes with 10 new ones, storing only their hashes", async () => {
    const client = { query: vi.fn().mockResolvedValue(rows()) };
    const codes = await auth.replaceRecoveryCodes(client, 7);
    const [deleteCall, ...inserts] = client.query.mock.calls;

    expect(codes).toHaveLength(10);
    expect(deleteCall[0]).toContain("DELETE FROM recovery_codes");
    expect(inserts).toHaveLength(10);
    expect(inserts.map(([, params]) => params)).toEqual(codes.map((code) => [7, mfa.hashCode(mfa.normalizeRecoveryCode(code))]));
  });
});

describe("mfaSetupPayload", () => {
  it("returns a QR code image and the secret in groups of four", async () => {
    const payload = await auth.mfaSetupPayload("ABCDEFGHIJKLMNOP", USER.email);

    expect(payload.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(payload.secret).toBe("ABCD EFGH IJKL MNOP");
  });
});

describe("notifySecurityChange", () => {
  beforeEach(() => {
    vi.stubEnv("BREVO_API_KEY", "brevo-key");
    vi.stubEnv("MAIL_FROM", "no-reply@acme.com");
  });

  it("sends the notice without making the caller wait for it", async () => {
    const fetchMock = mockFetch(() => new Response("{}", { status: 201 }));

    expect(auth.notifySecurityChange(USER.email, "password_reset")).toBeUndefined();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });

  it("logs a failure instead of throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    mockFetch(() => new Response("down", { status: 500 }));
    auth.notifySecurityChange(USER.email, "mfa_reset");

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("Could not send the mfa_reset notice:", expect.stringContaining("Brevo responded 500")));
  });
});
