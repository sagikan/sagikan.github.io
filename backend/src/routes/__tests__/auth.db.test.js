import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD, api, browser, captureMail, createUser, signedInClient, totp } from "../../../tests/db/helpers";

const require = createRequire(import.meta.url);
const db = require("../../config/db");
const auth = require("../../services/auth/authService");
const mfa = require("../../services/auth/mfa");

let mail;

// Reads one row of a user by email
async function userRow(email = "dana@example.com") {
  return (await db.query("SELECT * FROM users WHERE email = $1", [email])).rows[0];
}

// Logs a user in as far as the pending second-factor step, returning the browser
async function loginUntilCode(user) {
  const b = browser();
  const res = await b.post("/api/auth/login").send({ email: user.email, password: user.password });

  expect(res.status).toBe(200);

  return b;
}

// Signs a user in fully, with the authenticator code for the current time
async function loginFully(user, at = Date.now()) {
  const b = await loginUntilCode(user);
  const res = await b.post("/api/auth/mfa/verify").send({ code: totp(user.totpSecret, at) });

  expect(res.status).toBe(200);
  await b.useSession();

  return b;
}

beforeEach(() => {
  mail = captureMail();
});

describe("GET /api/auth/csrf and /api/auth/me", () => {
  it("returns the CSRF token and the user for a signed-in browser", async () => {
    const user = await createUser();
    const b = await loginFully(user);

    expect((await b.get("/api/auth/me")).body).toEqual({ user: { id: user.id, email: user.email } });
    expect((await b.get("/api/auth/csrf")).body.csrfToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(["/api/auth/csrf", "/api/auth/me"])("refuses %s without a session", async (path) => {
    expect((await api().get(path)).status).toBe(401);
  });

  it("refuses a session whose user no longer exists", async () => {
    const { client, user } = await signedInClient();

    await db.query("DELETE FROM users WHERE id = $1", [user.id]);

    expect((await client.get("/api/auth/me")).status).toBe(401);
  });
});

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.stubEnv("SIGNUPS_OPEN", "true");
  });

  it("creates an unverified account, emails a code and starts the verification step", async () => {
    const b = browser();
    const res = await b.post("/api/auth/register").send({ email: " Dana@Example.com ", password: PASSWORD });
    const user = await userRow();

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ next: "verify_email", email: "dana@example.com", emailSent: true });
    expect(user).toMatchObject({ email: "dana@example.com", email_verified: false, totp_enabled: false });
    expect(user.password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(Object.keys(b.cookies())).toEqual(["pending_auth"]);

    const [code] = mail.codes("verify");
    const stored = (await db.query("SELECT code_hash, attempts FROM email_verifications")).rows[0];

    expect(code).toMatch(/^\d{6}$/);
    expect(stored).toEqual({ code_hash: mfa.hashCode(code), attempts: 0 });
  });

  it("still creates the account when the email can't be sent, and says so", async () => {
    vi.stubEnv("BREVO_API_KEY", "brevo-key");
    vi.stubEnv("MAIL_FROM", "no-reply@example.com");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await browser().post("/api/auth/register").send({ email: "dana@example.com", password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
    expect(await userRow()).toBeTruthy();
  });

  it("refuses an email that is already registered", async () => {
    await createUser();

    const res = await browser().post("/api/auth/register").send({ email: "DANA@example.com", password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "An account with this email already exists." });
  });

  it.each([
    ["an invalid email", { email: "not-an-email", password: PASSWORD }, "Enter a valid email address."],
    ["a missing email", { password: PASSWORD }, "Enter a valid email address."],
    ["a short password", { email: "dana@example.com", password: "Aa1!" }, "Password must be 12–72 characters long."],
    ["a password without a symbol", { email: "dana@example.com", password: "Strongpassword1" }, "Password must include uppercase and lowercase letters, a number and a symbol."],
    ["a password with the email handle", { email: "dana.levi@example.com", password: "My-dana.levi-9!X" }, "Password must not contain your email address."],
    ["a missing password", { email: "dana@example.com" }, "Invalid password."]
  ])("refuses %s", async (_title, body, message) => {
    const res = await browser().post("/api/auth/register").send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
    expect((await db.query("SELECT 1 FROM users")).rowCount).toBe(0);
  });

  it("refuses sign-ups while they are paused", async () => {
    vi.stubEnv("SIGNUPS_OPEN", "false");

    const res = await browser().post("/api/auth/register").send({ email: "dana@example.com", password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Sign-ups are paused");
    expect((await db.query("SELECT 1 FROM users")).rowCount).toBe(0);
  });

  it("allows 5 sign-up attempts an hour from one network", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await browser().post("/api/auth/register").send({ email: "bad" })).status).toBe(400);
    }

    const res = await browser().post("/api/auth/register").send({ email: "bad" });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Too many accounts created from this network. Please try again in 60 minutes." });
  });
});

describe("POST /api/auth/login", () => {
  it("starts the second-factor step for a user who has everything set up", async () => {
    const user = await createUser();
    const b = browser();
    const res = await b.post("/api/auth/login").send({ email: user.email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ next: "mfa", email: user.email, emailSent: true });
    expect(Object.keys(b.cookies())).toEqual(["pending_auth"]);
    expect(mail.codes("verify")).toEqual([]);
  });

  it("ignores case and spaces in the email", async () => {
    await createUser();

    const res = await browser().post("/api/auth/login").send({ email: "  DANA@Example.com ", password: PASSWORD });

    expect(res.status).toBe(200);
  });

  it("sends a new code to a user who hasn't verified their email", async () => {
    await createUser({ verified: false, authenticator: false });

    const res = await browser().post("/api/auth/login").send({ email: "dana@example.com", password: PASSWORD });

    expect(res.body).toEqual({ next: "verify_email", email: "dana@example.com", emailSent: true });
    expect(mail.codes("verify")).toHaveLength(1);
  });

  it("sends a user without an authenticator to set one up", async () => {
    await createUser({ authenticator: false });

    const res = await browser().post("/api/auth/login").send({ email: "dana@example.com", password: PASSWORD });

    expect(res.body.next).toBe("mfa_setup");
  });

  it("refuses a wrong password and counts the failure", async () => {
    await createUser();

    const b = browser();
    const res = await b.post("/api/auth/login").send({ email: "dana@example.com", password: "Wrong!Passw0rd1" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials." });
    expect(b.cookies()).toEqual({});
    expect((await userRow()).failed_login_attempts).toBe(1);
  });

  it("answers an unknown email exactly like a wrong password", async () => {
    const res = await browser().post("/api/auth/login").send({ email: "nobody@example.com", password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials." });
  });

  it("refuses a password that isn't text", async () => {
    const res = await browser().post("/api/auth/login").send({ email: "dana@example.com", password: { $ne: "" } });

    expect(res.status).toBe(400);
  });

  it("locks the account for 15 minutes after 10 wrong passwords, even for the right one", async () => {
    await createUser();

    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await browser().post("/api/auth/login").send({ email: "dana@example.com", password: "Wrong!Passw0rd1" })).status).toBe(401);
    }

    const res = await browser().post("/api/auth/login").send({ email: "dana@example.com", password: PASSWORD });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Too many failed attempts. Try again in 15 minutes. You can also reset your password." });
  });

  it("lets the user in again once the lock has passed, and clears the count", async () => {
    await createUser();
    await db.query("UPDATE users SET failed_login_attempts = 4, login_locked_until = NOW() - INTERVAL '1 minute'");

    expect((await browser().post("/api/auth/login").send({ email: "dana@example.com", password: PASSWORD })).status).toBe(200);
    expect(await userRow()).toMatchObject({ failed_login_attempts: 0, login_locked_until: null });
  });

  it("allows 20 sign-in attempts per 15 minutes from one network", async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await browser().post("/api/auth/login").send({ email: "dana@example.com", password: 5 })).status).toBe(400);
    }

    const res = await browser().post("/api/auth/login").send({ email: "dana@example.com", password: 5 });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain("Too many login attempts.");
  });
});

describe("the email verification step", () => {
  // Registers-like start: an unverified user, logged in as far as the verification step
  async function unverified() {
    const user = await createUser({ verified: false, authenticator: false });
    const b = await loginUntilCode(user);

    return { user, b, code: mail.codes("verify")[0] };
  }

  it("verifies the email with the right code and moves on to authenticator setup", async () => {
    const { b, code } = await unverified();
    const res = await b.post("/api/auth/verify-email").send({ code });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ next: "mfa_setup" });
    expect((await userRow()).email_verified).toBe(true);
    expect((await db.query("SELECT 1 FROM email_verifications")).rowCount).toBe(0);
  });

  it("ignores spaces in the code", async () => {
    const { b, code } = await unverified();

    expect((await b.post("/api/auth/verify-email").send({ code: ` ${code.slice(0, 3)} ${code.slice(3)} ` })).status).toBe(200);
  });

  it("refuses a wrong code and counts the attempt", async () => {
    const { b, code } = await unverified();
    const wrong = code === "000000" ? "111111" : "000000";
    const res = await b.post("/api/auth/verify-email").send({ code: wrong });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Incorrect code. Please try again." });
    expect((await db.query("SELECT attempts FROM email_verifications")).rows[0].attempts).toBe(1);
    expect((await userRow()).email_verified).toBe(false);
  });

  it("stops accepting a code after 5 wrong attempts, even the right one", async () => {
    const { b, code } = await unverified();
    const wrong = code === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < 5; attempt++) {
      await b.post("/api/auth/verify-email").send({ code: wrong });
    }

    const res = await b.post("/api/auth/verify-email").send({ code });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Too many attempts. Request a new code." });
  });

  it("refuses a code that has expired", async () => {
    const { b, code } = await unverified();

    await db.query("UPDATE email_verifications SET expires_at = NOW() - INTERVAL '1 minute'");

    const res = await b.post("/api/auth/verify-email").send({ code });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "This code has expired. Request a new one." });
  });

  it.each([
    ["no sign-in in progress", () => browser()],
    ["a sign-in at another step", async () => loginUntilCode(await createUser({ email: "noa@example.com" }))]
  ])("asks to start over with %s", async (_title, makeBrowser) => {
    const res = await (await makeBrowser()).post("/api/auth/verify-email").send({ code: "123456" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Your sign-in session expired. Please log in again.", restart: true });
  });

  it("asks to start over after the password was reset elsewhere", async () => {
    const { b, code } = await unverified();

    await db.query("UPDATE users SET token_version = token_version + 1");

    expect((await b.post("/api/auth/verify-email").send({ code })).status).toBe(401);
  });

  describe("sending a new code", () => {
    it("asks to wait when the last code was sent less than a minute ago", async () => {
      const { b } = await unverified();
      const res = await b.post("/api/auth/resend-verification");

      expect(res.status).toBe(429);
      expect(res.body.retryAfter).toBeGreaterThan(0);
      expect(res.body.retryAfter).toBeLessThanOrEqual(60);
      expect(res.body.error).toContain("Please wait");
      expect(mail.codes("verify")).toHaveLength(1);
    });

    it("sends a new code, replacing the old one, after the wait", async () => {
      const { b, code } = await unverified();

      await db.query("UPDATE email_verifications SET sent_at = NOW() - INTERVAL '2 minutes'");

      const res = await b.post("/api/auth/resend-verification");
      const [, fresh] = mail.codes("verify");

      expect(res.body).toEqual({ message: "A new code has been sent." });
      expect((await db.query("SELECT code_hash FROM email_verifications")).rows[0].code_hash).toBe(mfa.hashCode(fresh));
      expect(code).toBeTruthy();
    });

    it("stops at 8 codes a day", async () => {
      const { b } = await unverified();

      await db.query("UPDATE email_verifications SET sent_at = NOW() - INTERVAL '2 minutes', send_count = 8, window_started_at = NOW()");

      const res = await b.post("/api/auth/resend-verification");

      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: "You've requested too many codes today. Please try again tomorrow." });
    });
  });
});

describe("setting up the authenticator", () => {
  // Logs in a verified user who has no authenticator yet
  async function atSetup() {
    const user = await createUser({ authenticator: false });

    return { user, b: await loginUntilCode(user) };
  }

  it("creates a secret and returns a QR code and the secret in groups of four", async () => {
    const { b, user } = await atSetup();
    const res = await b.post("/api/auth/mfa/setup");

    expect(res.status).toBe(200);
    expect(res.body.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(res.body.secret).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    expect(mfa.decryptSecret((await userRow(user.email)).totp_secret)).toBe(res.body.secret.replace(/ /g, ""));
  });

  it("refuses to start again once the authenticator is on", async () => {
    const { b } = await atSetup();

    await db.query("UPDATE users SET totp_enabled = TRUE");

    const res = await b.post("/api/auth/mfa/setup");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Two-factor authentication is already set up.", restart: true });
  });

  it("turns the authenticator on with a correct code, signs the user in and returns 10 recovery codes", async () => {
    const { b, user } = await atSetup();
    const { body: setup } = await b.post("/api/auth/mfa/setup");
    const res = await b.post("/api/auth/mfa/setup/confirm").send({ code: totp(setup.secret) });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: user.id, email: user.email });
    expect(res.body.recoveryCodes).toHaveLength(10);
    expect(Object.keys(b.cookies())).toEqual(["token"]);
    expect(await userRow()).toMatchObject({ totp_enabled: true, mfa_failed_attempts: 0 });
    expect((await db.query("SELECT 1 FROM sessions")).rowCount).toBe(1);

    const stored = (await db.query("SELECT code_hash FROM recovery_codes")).rows.map((row) => row.code_hash).sort();

    expect(stored).toEqual(res.body.recoveryCodes.map((code) => mfa.hashCode(mfa.normalizeRecoveryCode(code))).sort());

    await b.useSession();

    expect((await b.get("/api/auth/me")).status).toBe(200);
  });

  it("refuses a wrong code and counts the failure", async () => {
    const { b } = await atSetup();
    const { body: setup } = await b.post("/api/auth/mfa/setup");
    const wrong = totp(setup.secret) === "000000" ? "111111" : "000000";
    const res = await b.post("/api/auth/mfa/setup/confirm").send({ code: wrong });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Incorrect code. Check your authenticator app and try again." });
    expect(await userRow()).toMatchObject({ totp_enabled: false, mfa_failed_attempts: 1 });
  });

  it("asks to restart when no secret was created yet", async () => {
    const { b } = await atSetup();
    const res = await b.post("/api/auth/mfa/setup/confirm").send({ code: "123456" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Please restart two-factor setup.", restart: true });
  });

  it("refuses while the account is locked", async () => {
    const { b } = await atSetup();

    await db.query("UPDATE users SET mfa_locked_until = NOW() + INTERVAL '10 minutes'");

    const res = await b.post("/api/auth/mfa/setup/confirm").send({ code: "123456" });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain("Try again in 10 minutes");
  });
});

describe("POST /api/auth/mfa/verify", () => {
  it("signs the user in with a correct authenticator code", async () => {
    const user = await createUser();
    const b = await loginUntilCode(user);
    const res = await b.post("/api/auth/mfa/verify").send({ code: totp(user.totpSecret) });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: user.id, email: user.email });
    expect(Object.keys(b.cookies())).toEqual(["token"]);
    expect((await db.query("SELECT user_id FROM sessions")).rows).toEqual([{ user_id: String(user.id) }]);
  });

  it("refuses a wrong code and counts the failure", async () => {
    const user = await createUser();
    const b = await loginUntilCode(user);
    const wrong = totp(user.totpSecret) === "000000" ? "111111" : "000000";
    const res = await b.post("/api/auth/mfa/verify").send({ code: wrong });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Incorrect code. Check your authenticator app and try again.");
    expect((await userRow()).mfa_failed_attempts).toBe(1);
    expect((await db.query("SELECT 1 FROM sessions")).rowCount).toBe(0);
  });

  it("refuses a code that was already used", async () => {
    const user = await createUser();
    const code = totp(user.totpSecret);

    await (await loginUntilCode(user)).post("/api/auth/mfa/verify").send({ code });

    const res = await (await loginUntilCode(user)).post("/api/auth/mfa/verify").send({ code });

    expect(res.status).toBe(400);
  });

  it("accepts the next code after one was used", async () => {
    const user = await createUser();

    await (await loginUntilCode(user)).post("/api/auth/mfa/verify").send({ code: totp(user.totpSecret) });

    const res = await (await loginUntilCode(user)).post("/api/auth/mfa/verify").send({ code: totp(user.totpSecret, Date.now() + 30000) });

    expect(res.status).toBe(200);
  });

  it("locks for 15 minutes after 5 wrong codes, even for the right one", async () => {
    const user = await createUser();
    const b = await loginUntilCode(user);
    const wrong = totp(user.totpSecret) === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await b.post("/api/auth/mfa/verify").send({ code: wrong })).status).toBe(400);
    }

    const res = await b.post("/api/auth/mfa/verify").send({ code: totp(user.totpSecret) });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Too many failed attempts. Try again in 15 minutes." });
  });

  describe("with a recovery code", () => {
    it("signs the user in once, reporting how many codes are left", async () => {
      const user = await createUser();
      const [first] = await auth.replaceRecoveryCodes(db, user.id);
      const res = await (await loginUntilCode(user)).post("/api/auth/mfa/verify").send({ recoveryCode: first.toLowerCase().replace("-", "") });

      expect(res.status).toBe(200);
      expect(res.body.recoveryCodesLeft).toBe(9);

      const again = await (await loginUntilCode(user)).post("/api/auth/mfa/verify").send({ recoveryCode: first });

      expect(again.status).toBe(400);
      expect(again.body).toEqual({ error: "That recovery code is invalid or has already been used." });
    });

    it("refuses a code that was never issued, and counts the failure", async () => {
      const user = await createUser();
      const res = await (await loginUntilCode(user)).post("/api/auth/mfa/verify").send({ recoveryCode: "AAAAA-BBBBB" });

      expect(res.status).toBe(400);
      expect((await userRow()).mfa_failed_attempts).toBe(1);
    });

    it("refuses another user's recovery code", async () => {
      const user = await createUser({ email: "dana@example.com" });
      const other = await createUser({ email: "noa@example.com" });
      const [code] = await auth.replaceRecoveryCodes(db, other.id);
      const res = await (await loginUntilCode(user)).post("/api/auth/mfa/verify").send({ recoveryCode: code });

      expect(res.status).toBe(400);
    });
  });
});

describe("resetting a forgotten password", () => {
  const NEW_PASSWORD = "N3w!Passw0rd-Better";

  // Asks for a reset code and returns it
  async function requestCode(email = "dana@example.com") {
    const res = await api().post("/api/auth/password/forgot").send({ email });

    await vi.waitFor(() => expect(mail.codes("reset").length).toBeGreaterThan(0));

    return { res, code: mail.codes("reset").at(-1) };
  }

  it("emails a code to an account that exists, and says the same for one that doesn't", async () => {
    await createUser();

    const known = await requestCode();
    const unknown = await api().post("/api/auth/password/forgot").send({ email: "nobody@example.com" });

    expect(known.res.body).toEqual(unknown.body);
    expect(unknown.body.message).toContain("If an account exists");
    expect(mail.codes("reset")).toHaveLength(1);
  });

  it("refuses an invalid email", async () => {
    const res = await api().post("/api/auth/password/forgot").send({ email: "nope" });

    expect(res.status).toBe(400);
  });

  it("changes the password, ends every session and tells the user", async () => {
    const user = await createUser();
    const { client } = await signedInClient({ email: "other@example.com" });
    const session = await loginFully(user);
    const { code } = await requestCode();
    const res = await api().post("/api/auth/password/reset").send({ email: user.email, code, password: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Your password has been reset. You can now log in." });
    expect((await session.get("/api/auth/me")).status).toBe(401);
    expect((await client.get("/api/auth/me")).status).toBe(200);
    expect((await userRow()).token_version).toBe(1);
    expect((await db.query("SELECT 1 FROM sessions WHERE user_id = $1", [user.id])).rowCount).toBe(0);
    expect((await db.query("SELECT 1 FROM password_resets")).rowCount).toBe(0);
    await vi.waitFor(() => expect(mail.notices()).toEqual(["password_reset dana@example.com"]));
  });

  it("lets the user log in with the new password only", async () => {
    const user = await createUser();
    const { code } = await requestCode();

    await api().post("/api/auth/password/reset").send({ email: user.email, code, password: NEW_PASSWORD });

    expect((await browser().post("/api/auth/login").send({ email: user.email, password: NEW_PASSWORD })).status).toBe(200);
    expect((await browser().post("/api/auth/login").send({ email: user.email, password: PASSWORD })).status).toBe(401);
  });

  it("clears a lock and verifies the email", async () => {
    const user = await createUser({ verified: false });

    await db.query("UPDATE users SET failed_login_attempts = 7, login_locked_until = NOW() + INTERVAL '10 minutes'");

    const { code } = await requestCode();

    await api().post("/api/auth/password/reset").send({ email: user.email, code, password: NEW_PASSWORD });

    expect(await userRow()).toMatchObject({ email_verified: true, failed_login_attempts: 0, login_locked_until: null });
  });

  it("refuses to use the same code twice", async () => {
    const user = await createUser();
    const { code } = await requestCode();

    await api().post("/api/auth/password/reset").send({ email: user.email, code, password: NEW_PASSWORD });

    const res = await api().post("/api/auth/password/reset").send({ email: user.email, code, password: "An0ther!Passw0rd-X" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "This code has expired. Request a new one." });
  });

  it("refuses a wrong code and leaves the password alone", async () => {
    const user = await createUser();
    const { code } = await requestCode();
    const wrong = code === "000000" ? "111111" : "000000";
    const res = await api().post("/api/auth/password/reset").send({ email: user.email, code: wrong, password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Incorrect code. Please try again." });
    expect((await browser().post("/api/auth/login").send({ email: user.email, password: PASSWORD })).status).toBe(200);
  });

  it("refuses a weak new password before checking the code", async () => {
    const user = await createUser();
    const { code } = await requestCode();
    const res = await api().post("/api/auth/password/reset").send({ email: user.email, code, password: "weak" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Password must be 12–72 characters long.");
    expect((await db.query("SELECT attempts FROM password_resets")).rows[0].attempts).toBe(0);
  });

  it("refuses an email with no account, without saying why", async () => {
    const res = await api().post("/api/auth/password/reset").send({ email: "nobody@example.com", code: "123456", password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "This code has expired. Request a new one." });
  });

  it("allows 10 attempts per 15 minutes from one network", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await api().post("/api/auth/password/forgot").send({ email: "nope" })).status).toBe(400);
    }

    expect((await api().post("/api/auth/password/forgot").send({ email: "nope" })).status).toBe(429);
  });
});

describe("POST /api/auth/logout", () => {
  it("ends the session on the server and clears the cookies", async () => {
    const user = await createUser();
    const b = await loginFully(user);
    const res = await b.post("/api/auth/logout");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Logged out successfully." });
    expect((await db.query("SELECT 1 FROM sessions")).rowCount).toBe(0);
    expect(b.cookies()).toEqual({});
  });

  it("makes the old session cookie useless, even if someone kept a copy", async () => {
    const { client } = await signedInClient();

    await client.post("/api/auth/logout");

    expect((await client.get("/api/auth/me")).status).toBe(401);
  });

  it("only ends the session it was called from", async () => {
    const user = await createUser();
    const first = await loginFully(user);
    const second = await loginFully(user, Date.now() + 30000);

    await first.post("/api/auth/logout");

    expect((await second.get("/api/auth/me")).status).toBe(200);
  });

  it("needs the CSRF token", async () => {
    const { client } = await signedInClient();

    expect((await client.post("/api/auth/logout").unset("X-CSRF-Token")).status).toBe(403);
  });
});

describe("signing up and in, from start to finish", () => {
  it("registers, verifies the email, sets up the authenticator, logs out and logs back in", async () => {
    vi.stubEnv("SIGNUPS_OPEN", "true");

    const b = browser();

    expect((await b.post("/api/auth/register").send({ email: "dana@example.com", password: PASSWORD })).body.next).toBe("verify_email");
    expect((await b.post("/api/auth/verify-email").send({ code: mail.codes("verify")[0] })).body.next).toBe("mfa_setup");

    const { body: setup } = await b.post("/api/auth/mfa/setup");
    const confirmed = await b.post("/api/auth/mfa/setup/confirm").send({ code: totp(setup.secret) });

    expect(confirmed.body.recoveryCodes).toHaveLength(10);

    await b.useSession();

    expect((await b.get("/api/auth/me")).body.user.email).toBe("dana@example.com");
    expect((await b.post("/api/auth/logout")).status).toBe(200);

    const again = browser();

    expect((await again.post("/api/auth/login").send({ email: "dana@example.com", password: PASSWORD })).body.next).toBe("mfa");
    expect((await again.post("/api/auth/mfa/verify").send({ code: totp(setup.secret, Date.now() + 30000) })).status).toBe(200);
  });
});
