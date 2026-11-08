import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { AUTHENTICATOR, EMAIL_CODE, LOCKOUT, REPLACE_AUTHENTICATOR_MINUTES, SIGN_IN, authenticatorState, codeState, lockState, nextStage, unlockSql } = require("../authStates");

const NOW = new Date("2026-10-29T12:00:00Z");

describe("SIGN_IN", () => {
  it.each([
    ["credentials", "register", undefined, "verify_email"],
    ["credentials", "logIn", "mfa", "mfa"],
    ["verify_email", "verifyEmail", "mfa_setup", "mfa_setup"],
    ["verify_email", "resendCode", undefined, "verify_email"],
    ["mfa_setup", "confirmAuthenticator", undefined, "signed_in"],
    ["mfa", "verifySecondFactor", undefined, "signed_in"]
  ])("moves from %s on %s (to %s) to %s", (state, event, pick, expected) => {
    expect(SIGN_IN.move(state, event, pick)).toBe(expected);
  });

  it.each([
    ["verify_email", "verifySecondFactor"],
    ["mfa", "confirmAuthenticator"],
    ["credentials", "verifyEmail"]
  ])("doesn't let a sign-in at %s skip ahead with %s", (state, event) => {
    expect(SIGN_IN.can(state, event)).toBe(false);
  });

  it("only goes from verifying the email to a 2FA step", () => {
    expect(SIGN_IN.can("verify_email", "verifyEmail", "verify_email")).toBe(false);
  });
});

describe("nextStage", () => {
  it.each([
    ["an unverified email", { email_verified: false, totp_enabled: false }, "verify_email"],
    ["no authenticator yet", { email_verified: true, totp_enabled: false }, "mfa_setup"],
    ["everything set up", { email_verified: true, totp_enabled: true }, "mfa"]
  ])("asks for the next step for %s", (_title, user, expected) => {
    expect(nextStage(user)).toBe(expected);
  });

  it("always returns a step the login move allows", () => {
    expect(SIGN_IN.targets("logIn")).toEqual(expect.arrayContaining(["verify_email", "mfa_setup", "mfa"]));
  });
});

describe("LOCKOUT", () => {
  it.each([
    ["open", "fail", "locked", "locked"],
    ["open", "fail", "open", "open"],
    ["locked", "expire", undefined, "open"],
    ["locked", "resetPassword", undefined, "open"]
  ])("moves from %s on %s (to %s) to %s", (state, event, pick, expected) => {
    expect(LOCKOUT.move(state, event, pick)).toBe(expected);
  });

  it("doesn't count failures or successes while locked", () => {
    expect(LOCKOUT.can("locked", "fail", "locked")).toBe(false);
    expect(LOCKOUT.can("locked", "succeed")).toBe(false);
  });
});

describe("lockState", () => {
  it.each([
    [null, "open"],
    ["2026-10-29T11:59:00Z", "open"],
    ["2026-10-29T12:10:00Z", "locked"]
  ])("reads a lock ending at %s as %s", (until, expected) => {
    expect(lockState(until, NOW)).toBe(expected);
  });
});

describe("unlockSql", () => {
  it.each([
    ["login", "failed_login_attempts = 0, login_locked_until = NULL"],
    ["mfa", "mfa_failed_attempts = 0, mfa_locked_until = NULL"]
  ])("clears the %s lock", (kind, expected) => {
    expect(unlockSql(kind)).toBe(expected);
  });
});

describe("EMAIL_CODE", () => {
  it.each([
    ["missing", "send", undefined, "active"],
    ["active", "wrongCode", "used_up", "used_up"],
    ["active", "use", undefined, "missing"],
    ["used_up", "send", undefined, "active"],
    ["expired", "send", undefined, "active"]
  ])("moves a %s code on %s (to %s) to %s", (state, event, pick, expected) => {
    expect(EMAIL_CODE.move(state, event, pick)).toBe(expected);
  });

  it("can't use a code that's used up or expired", () => {
    expect(EMAIL_CODE.can("used_up", "use")).toBe(false);
    expect(EMAIL_CODE.can("expired", "use")).toBe(false);
  });
});

describe("codeState", () => {
  it.each([
    ["no row", undefined, "missing"],
    ["an expired code", { valid: false, attempts: 0 }, "expired"],
    ["an expired code with no tries left", { valid: false, attempts: 5 }, "expired"],
    ["a code with no tries left", { valid: true, attempts: 5 }, "used_up"],
    ["a code with tries left", { valid: true, attempts: 4 }, "active"]
  ])("reads %s", (_title, row, expected) => {
    expect(codeState(row)).toBe(expected);
  });
});

describe("AUTHENTICATOR", () => {
  it.each([
    ["none", "start", "setting_up"],
    ["setting_up", "start", "setting_up"],
    ["setting_up", "confirm", "enabled"],
    ["enabled", "startReplacing", "replacing"],
    ["replacing", "confirmReplacing", "enabled"],
    ["replacing", "expire", "enabled"]
  ])("moves from %s on %s to %s", (state, event, expected) => {
    expect(AUTHENTICATOR.move(state, event)).toBe(expected);
  });

  it.each([
    ["enabled", "start"],
    ["none", "confirm"],
    ["enabled", "confirmReplacing"],
    ["setting_up", "startReplacing"]
  ])("doesn't allow %s to %s", (state, event) => {
    expect(AUTHENTICATOR.can(state, event)).toBe(false);
  });
});

describe("authenticatorState", () => {
  it.each([
    [{ totp_enabled: false, totp_secret: null, totp_pending_secret: null }, "none"],
    [{ totp_enabled: false, totp_secret: "secret", totp_pending_secret: null }, "setting_up"],
    [{ totp_enabled: true, totp_secret: "secret", totp_pending_secret: null }, "enabled"],
    [{ totp_enabled: true, totp_secret: "secret", totp_pending_secret: "new", totp_pending_at: "2026-10-29T11:50:00Z" }, "replacing"]
  ])("reads %o as %s", (user, expected) => {
    expect(authenticatorState(user, NOW)).toBe(expected);
  });

  it.each([
    ["started 14 minutes ago", "2026-10-29T11:46:00Z", "replacing"],
    ["started 15 minutes ago", "2026-10-29T11:45:00Z", "enabled"],
    ["started an hour ago", "2026-10-29T11:00:00Z", "enabled"],
    ["with no start time", null, "enabled"]
  ])("reads a replacement %s as %s", (_title, startedAt, expected) => {
    const user = { totp_enabled: true, totp_secret: "secret", totp_pending_secret: "new", totp_pending_at: startedAt };

    expect(authenticatorState(user, NOW)).toBe(expected);
    expect(REPLACE_AUTHENTICATOR_MINUTES).toBe(15);
  });
});
