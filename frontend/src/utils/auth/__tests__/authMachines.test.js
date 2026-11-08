import { describe, expect, it } from "vitest";
import { ACCOUNT_PANEL, API_HEALTH, AUTHENTICATOR_RESET, SESSION, SIGN_IN_STEPS } from "../authMachines";

describe("API_HEALTH", () => {
  it.each([
    ["checking", "online", "online"],
    ["checking", "offline", "offline"],
    ["offline", "online", "online"],
    ["online", "offline", "offline"],
    ["online", "online", "online"]
  ])("moves from %s on %s to %s", (state, event, expected) => {
    expect(API_HEALTH.next(state, event)).toBe(expected);
  });

  it("starts by checking and never goes back to it", () => {
    expect(API_HEALTH.initial).toBe("checking");
    expect(API_HEALTH.sources("checking")).toEqual([]);
  });
});

describe("SESSION", () => {
  it.each([
    ["restoring", "restore", "signed_in"],
    ["restoring", "signIn", "restoring"],
    ["restoring", "signOut", "signed_out"],
    ["signed_out", "signIn", "signed_in"],
    ["signed_out", "restore", "signed_out"],
    ["signed_in", "signOut", "signed_out"]
  ])("moves from %s on %s to %s", (state, event, expected) => {
    expect(SESSION.next(state, event)).toBe(expected);
  });

  it("starts by restoring the sign-in", () => {
    expect(SESSION.initial).toBe("restoring");
  });
});

describe("SIGN_IN_STEPS", () => {
  it.each([
    ["credentials", "submitted", "mfa", "mfa"],
    ["credentials", "forgotPassword", undefined, "forgot_password"],
    ["verify_email", "verified", "mfa_setup", "mfa_setup"],
    ["mfa_setup", "confirmed", undefined, "recovery_codes"],
    ["forgot_password", "codeSent", undefined, "reset_password"],
    ["reset_password", "restart", undefined, "credentials"]
  ])("moves from %s on %s (to %s) to %s", (state, event, pick, expected) => {
    expect(SIGN_IN_STEPS.next(state, event, pick)).toBe(expected);
  });

  it("only takes the steps the server can send next", () => {
    expect(SIGN_IN_STEPS.can("credentials", "submitted", "recovery_codes")).toBe(false);
    expect(SIGN_IN_STEPS.can("verify_email", "verified", "verify_email")).toBe(false);
  });

  it("can restart from every step except the recovery codes", () => {
    expect(SIGN_IN_STEPS.sources("restart")).toEqual(SIGN_IN_STEPS.states.filter((step) => step !== "recovery_codes"));
  });
});

describe("AUTHENTICATOR_RESET", () => {
  it("goes from checking it's you, to linking the new app, to the new codes", () => {
    expect(AUTHENTICATOR_RESET.initial).toBe("verify");
    expect(AUTHENTICATOR_RESET.next("verify", "verified")).toBe("setup");
    expect(AUTHENTICATOR_RESET.next("setup", "confirmed")).toBe("codes");
    expect(AUTHENTICATOR_RESET.can("verify", "confirmed")).toBe(false);
  });

  it("goes back to checking it's you when the server stopped waiting for the new app", () => {
    expect(AUTHENTICATOR_RESET.next("setup", "expired")).toBe("verify");
    expect(AUTHENTICATOR_RESET.can("codes", "expired")).toBe(false);
  });
});

describe("ACCOUNT_PANEL", () => {
  it.each(["codes", "authenticator", "delete", "email", "emailDisconnect"])("opens the %s panel from any panel", (panel) => {
    expect(ACCOUNT_PANEL.next("closed", "open", panel)).toBe(panel);
    expect(ACCOUNT_PANEL.next("delete", "open", panel)).toBe(panel);
    expect(ACCOUNT_PANEL.next(panel, "close")).toBe("closed");
  });

  it("starts closed and only opens known panels", () => {
    expect(ACCOUNT_PANEL.initial).toBe("closed");
    expect(ACCOUNT_PANEL.can("closed", "open", "billing")).toBe(false);
  });
});
