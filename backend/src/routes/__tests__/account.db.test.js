import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD, api, browser, captureMail, createApplication, createUser, signedInClient, totp } from "../../../tests/db/helpers";

const require = createRequire(import.meta.url);
const db = require("../../config/db");
const auth = require("../../services/auth/authService");
const mfa = require("../../services/auth/mfa");

let mail;

// Reads one row of a user by email
async function userRow(email = "dana@example.com") {
  return (await db.query("SELECT * FROM users WHERE email = $1", [email])).rows[0];
}

// Returns a code that is certainly not the current one
function wrongCode(secret) {
  return totp(secret) === "000000" ? "111111" : "000000";
}

// Signs a user in through the login steps in a browser, so its cookies can be tracked
async function loginFully(user, at = Date.now()) {
  const b = browser();

  await b.post("/api/auth/login").send({ email: user.email, password: user.password });
  await b.post("/api/auth/mfa/verify").send({ code: totp(user.totpSecret, at) });
  await b.useSession();

  return b;
}

beforeEach(() => {
  mail = captureMail();
});

describe("authentication", () => {
  it.each([
    ["get", "/api/account/security"],
    ["post", "/api/account/recovery-codes"],
    ["post", "/api/account/mfa/reset/start"],
    ["post", "/api/account/mfa/reset/confirm"],
    ["post", "/api/account/delete"]
  ])("refuses %s %s without a session", async (method, path) => {
    expect((await api()[method](path)).status).toBe(401);
  });

  it.each([
    "/api/account/recovery-codes",
    "/api/account/mfa/reset/start",
    "/api/account/mfa/reset/confirm",
    "/api/account/delete"
  ])("refuses POST %s without the CSRF token", async (path) => {
    const { client } = await signedInClient();

    expect((await client.post(path).unset("X-CSRF-Token")).status).toBe(403);
  });
});

describe("GET /api/account/security", () => {
  it("returns how many recovery codes are left", async () => {
    const { client, user } = await signedInClient();

    await auth.replaceRecoveryCodes(db, user.id);
    await db.query("UPDATE recovery_codes SET used_at = NOW() WHERE id IN (SELECT id FROM recovery_codes LIMIT 3)");

    const res = await client.get("/api/account/security");

    expect(res.body).toEqual({ recoveryCodesLeft: 7 });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("counts only the user's own codes", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });

    await auth.replaceRecoveryCodes(db, other.id);

    expect((await client.get("/api/account/security")).body).toEqual({ recoveryCodesLeft: 0 });
  });
});

describe("POST /api/account/recovery-codes", () => {
  it("replaces the recovery codes after a correct authenticator code, and tells the user", async () => {
    const { client, user } = await signedInClient();
    const [old] = await auth.replaceRecoveryCodes(db, user.id);
    const res = await client.post("/api/account/recovery-codes").send({ code: totp(user.totpSecret) });

    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);
    expect(res.body.recoveryCodes).not.toContain(old);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((await db.query("SELECT 1 FROM recovery_codes")).rowCount).toBe(10);
    expect((await db.query("SELECT 1 FROM recovery_codes WHERE code_hash = $1", [mfa.hashCode(mfa.normalizeRecoveryCode(old))])).rowCount).toBe(0);
    await vi.waitFor(() => expect(mail.notices()).toEqual(["recovery_codes dana@example.com"]));
  });

  it("accepts a recovery code in place of the authenticator, using it up", async () => {
    const { client, user } = await signedInClient();
    const [first] = await auth.replaceRecoveryCodes(db, user.id);
    const res = await client.post("/api/account/recovery-codes").send({ recoveryCode: first });

    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).not.toContain(first);
  });

  it("keeps the old codes when the authenticator code is wrong", async () => {
    const { client, user } = await signedInClient();

    await auth.replaceRecoveryCodes(db, user.id);

    const before = (await db.query("SELECT code_hash FROM recovery_codes ORDER BY id")).rows;
    const res = await client.post("/api/account/recovery-codes").send({ code: wrongCode(user.totpSecret) });

    expect(res.status).toBe(400);
    expect((await db.query("SELECT code_hash FROM recovery_codes ORDER BY id")).rows).toEqual(before);
    expect(mail.notices()).toEqual([]);
  });

  it("refuses while the account is locked", async () => {
    const { client, user } = await signedInClient();

    await db.query("UPDATE users SET mfa_locked_until = NOW() + INTERVAL '10 minutes'");

    const res = await client.post("/api/account/recovery-codes").send({ code: totp(user.totpSecret) });

    expect(res.status).toBe(429);
  });
});

describe("changing the authenticator", () => {
  describe("POST /api/account/mfa/reset/start", () => {
    it("starts with the right password and authenticator code, keeping the current secret until confirmed", async () => {
      const { client, user } = await signedInClient();
      const res = await client.post("/api/account/mfa/reset/start").send({ password: PASSWORD, code: totp(user.totpSecret) });
      const row = await userRow();

      expect(res.status).toBe(200);
      expect(res.body.qrCode).toMatch(/^data:image\/png;base64,/);
      expect(mfa.decryptSecret(row.totp_pending_secret)).toBe(res.body.secret.replace(/ /g, ""));
      expect(mfa.decryptSecret(row.totp_secret)).toBe(user.totpSecret);
    });

    it.each([
      ["a wrong password", { password: "Wrong!Passw0rd1" }, "Incorrect password."],
      ["no password", {}, "Incorrect password."],
      ["a password that isn't text", { password: { $ne: "" } }, "Incorrect password."]
    ])("refuses %s and counts the failure", async (_title, body, message) => {
      const { client, user } = await signedInClient();
      const res = await client.post("/api/account/mfa/reset/start").send({ ...body, code: totp(user.totpSecret) });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: message });
      expect((await userRow()).mfa_failed_attempts).toBe(1);
      expect((await userRow()).totp_pending_secret).toBeNull();
    });

    it("refuses a wrong authenticator code even with the right password", async () => {
      const { client, user } = await signedInClient();
      const res = await client.post("/api/account/mfa/reset/start").send({ password: PASSWORD, code: wrongCode(user.totpSecret) });

      expect(res.status).toBe(400);
      expect((await userRow()).totp_pending_secret).toBeNull();
    });

    it("refuses while the account is locked", async () => {
      const { client, user } = await signedInClient();

      await db.query("UPDATE users SET mfa_locked_until = NOW() + INTERVAL '10 minutes'");

      const res = await client.post("/api/account/mfa/reset/start").send({ password: PASSWORD, code: totp(user.totpSecret) });

      expect(res.status).toBe(429);
    });
  });

  describe("POST /api/account/mfa/reset/confirm", () => {
    // Starts a reset, checking with a recovery code, and returns the new authenticator's secret
    async function startReset(client, user) {
      const [recoveryCode] = await auth.replaceRecoveryCodes(db, user.id);
      const { body } = await client.post("/api/account/mfa/reset/start").send({ password: PASSWORD, recoveryCode });

      return body.secret.replace(/ /g, "");
    }

    it("switches to the new authenticator and returns 10 new recovery codes, replacing the old ones", async () => {
      const { client, user } = await signedInClient();
      const newSecret = await startReset(client, user);
      const res = await client.post("/api/account/mfa/reset/confirm").send({ code: totp(newSecret) });
      const row = await userRow();

      expect(res.status).toBe(200);
      expect(res.body.recoveryCodes).toHaveLength(10);
      expect(mfa.decryptSecret(row.totp_secret)).toBe(newSecret);
      expect(row).toMatchObject({ totp_pending_secret: null, token_version: 1, mfa_failed_attempts: 0 });
      expect((await db.query("SELECT code_hash FROM recovery_codes")).rows.map((r) => r.code_hash).sort()).toEqual(
        res.body.recoveryCodes.map((code) => mfa.hashCode(mfa.normalizeRecoveryCode(code))).sort()
      );
      await vi.waitFor(() => expect(mail.notices()).toEqual(["mfa_reset dana@example.com"]));
    });

    it("signs out every other session, and keeps the one that made the change signed in", async () => {
      const user = await createUser();
      const b = await loginFully(user);
      const elsewhere = await loginFully(user, Date.now() + 30000);
      const newSecret = await startReset(b, user);

      await b.post("/api/account/mfa/reset/confirm").send({ code: totp(newSecret) });
      await b.useSession();

      expect((await elsewhere.get("/api/auth/me")).status).toBe(401);
      expect((await b.get("/api/auth/me")).status).toBe(200);
      expect((await db.query("SELECT 1 FROM sessions")).rowCount).toBe(1);
    });

    it("makes the old authenticator stop working and the new one start", async () => {
      const { client, user } = await signedInClient();
      const newSecret = await startReset(client, user);

      await client.post("/api/account/mfa/reset/confirm").send({ code: totp(newSecret) });

      const withOld = browser();
      const withNew = browser();

      await withOld.post("/api/auth/login").send({ email: user.email, password: PASSWORD });
      await withNew.post("/api/auth/login").send({ email: user.email, password: PASSWORD });

      expect((await withOld.post("/api/auth/mfa/verify").send({ code: totp(user.totpSecret, Date.now() + 30000) })).status).toBe(400);
      expect((await withNew.post("/api/auth/mfa/verify").send({ code: totp(newSecret, Date.now() + 30000) })).status).toBe(200);
    });

    it("refuses a wrong code and keeps waiting for the right one", async () => {
      const { client, user } = await signedInClient();
      const newSecret = await startReset(client, user);
      const res = await client.post("/api/account/mfa/reset/confirm").send({ code: totp(newSecret) === "000000" ? "111111" : "000000" });

      expect(res.status).toBe(400);
      expect((await userRow()).mfa_failed_attempts).toBe(1);
      expect((await userRow()).totp_pending_secret).toBeTruthy();
    });

    it("asks to start again when no reset was started", async () => {
      const { client } = await signedInClient();
      const res = await client.post("/api/account/mfa/reset/confirm").send({ code: "123456" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Please start the authenticator reset again." });
    });

    it("refuses while the account is locked", async () => {
      const { client } = await signedInClient();

      await db.query("UPDATE users SET mfa_locked_until = NOW() + INTERVAL '10 minutes'");

      expect((await client.post("/api/account/mfa/reset/confirm").send({ code: "123456" })).status).toBe(429);
    });
  });
});

describe("POST /api/account/delete", () => {
  // The body that confirms a deletion
  const confirm = (user, extra = {}) => ({ confirm: "DELETE", password: PASSWORD, code: totp(user.totpSecret), ...extra });

  it("deletes the account and everything in it, ends the session and tells the user", async () => {
    const { client, user } = await signedInClient();

    await createApplication(user.id);
    await auth.replaceRecoveryCodes(db, user.id);

    const res = await client.post("/api/account/delete").send(confirm(user));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Your account has been deleted." });
    expect(res.headers["set-cookie"].join(";")).toContain("token=;");

    for (const table of ["users", "applications", "sessions", "recovery_codes"]) {
      expect((await db.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
    }

    expect((await client.get("/api/auth/me")).status).toBe(401);
    await vi.waitFor(() => expect(mail.notices()).toEqual(["account_deleted dana@example.com"]));
  });

  it("deletes only that user's data", async () => {
    const { client, user } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });

    await createApplication(other.id);
    await client.post("/api/account/delete").send(confirm(user));

    expect((await db.query("SELECT email FROM users")).rows).toEqual([{ email: "noa@example.com" }]);
    expect((await db.query("SELECT 1 FROM applications")).rowCount).toBe(1);
  });

  it.each([
    ["no confirmation word", { confirm: undefined }, "Type DELETE to confirm."],
    ["the wrong confirmation word", { confirm: "delete" }, "Type DELETE to confirm."],
    ["a wrong password", { password: "Wrong!Passw0rd1" }, "Incorrect password."],
    ["no password", { password: undefined }, "Incorrect password."]
  ])("refuses with %s", async (_title, change, message) => {
    const { client, user } = await signedInClient();
    const res = await client.post("/api/account/delete").send(confirm(user, change));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
    expect((await db.query("SELECT 1 FROM users")).rowCount).toBe(1);
  });

  it("refuses a wrong authenticator code", async () => {
    const { client, user } = await signedInClient();
    const res = await client.post("/api/account/delete").send(confirm(user, { code: wrongCode(user.totpSecret) }));

    expect(res.status).toBe(400);
    expect((await db.query("SELECT 1 FROM users")).rowCount).toBe(1);
  });

  it("accepts a recovery code in place of the authenticator", async () => {
    const { client, user } = await signedInClient();
    const [first] = await auth.replaceRecoveryCodes(db, user.id);
    const res = await client.post("/api/account/delete").send({ confirm: "DELETE", password: PASSWORD, recoveryCode: first });

    expect(res.status).toBe(200);
  });

  it("refuses while the account is locked", async () => {
    const { client, user } = await signedInClient();

    await db.query("UPDATE users SET mfa_locked_until = NOW() + INTERVAL '10 minutes'");

    expect((await client.post("/api/account/delete").send(confirm(user))).status).toBe(429);
    expect((await db.query("SELECT 1 FROM users")).rowCount).toBe(1);
  });

  it("locks the account after repeated wrong passwords, so the password can't be guessed here", async () => {
    const { client, user } = await signedInClient();

    for (let attempt = 0; attempt < 5; attempt++) {
      await client.post("/api/account/delete").send(confirm(user, { password: "Wrong!Passw0rd1" }));
    }

    const res = await client.post("/api/account/delete").send(confirm(user));

    expect(res.status).toBe(429);
  });
});
