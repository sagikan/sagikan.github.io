import { describe, expect, it } from "vitest";
import { POLICY_VERSION, needsPolicyNotice, policyDate } from "../policy";

describe("POLICY_VERSION", () => {
  it("is a real date written as YYYY-MM-DD", () => {
    expect(POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${POLICY_VERSION}T00:00:00Z`).toISOString().startsWith(POLICY_VERSION)).toBe(true);
  });
});

describe("policyDate", () => {
  it("writes the version out as a day, month name and year", () => {
    expect(policyDate()).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
  });
});

describe("needsPolicyNotice", () => {
  const SIGNED_IN = { authenticated: true, route: "/applications" };

  it.each([
    ["never saw a version", null],
    ["saw an older version", "2020-01-01"]
  ])("is true for a signed-in user who %s", (_title, seenVersion) => {
    expect(needsPolicyNotice({ ...SIGNED_IN, seenVersion })).toBe(true);
  });

  it("is false for a user who saw the current version", () => {
    expect(needsPolicyNotice({ ...SIGNED_IN, seenVersion: POLICY_VERSION })).toBe(false);
  });

  it("is false until the version the user saw has loaded", () => {
    expect(needsPolicyNotice({ ...SIGNED_IN, seenVersion: undefined })).toBe(false);
  });

  it("is false for someone who is not signed in", () => {
    expect(needsPolicyNotice({ authenticated: false, seenVersion: null, route: "/login" })).toBe(false);
  });

  it("is false while the user is already reading the policy", () => {
    expect(needsPolicyNotice({ ...SIGNED_IN, seenVersion: null, route: "/privacy" })).toBe(false);
  });

  it.each(["/applications", "/jobs", "/account", "/"])("is true on %s", (route) => {
    expect(needsPolicyNotice({ authenticated: true, seenVersion: null, route })).toBe(true);
  });
});
