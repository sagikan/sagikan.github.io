import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { checkApplicationField, isCalendarDate, isWebUrl } = require("../applicationFields");

describe("isWebUrl", () => {
  it.each([
    ["https://example.com/job/1", true],
    ["http://example.com", true],
    ["ftp://example.com", false],
    ["javascript:alert(1)", false],
    ["example.com", false],
    ["", false]
  ])("treats %s as a web URL: %s", (value, expected) => {
    expect(isWebUrl(value)).toBe(expected);
  });
});

describe("isCalendarDate", () => {
  it.each([
    ["2026-02-28", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["2026-04-31", false],
    ["1969-12-31", false],
    ["2101-01-01", false],
    ["2026-1-1", false],
    ["not a date", false],
    [20260101, false],
    [null, false]
  ])("treats %s as a calendar date: %s", (value, expected) => {
    expect(isCalendarDate(value)).toBe(expected);
  });
});

describe("checkApplicationField", () => {
  it.each(["company", "position", "location"])("accepts a normal %s", (field) => {
    expect(checkApplicationField(field, "Acme")).toBeNull();
  });

  it.each(["company", "position", "location"])("rejects a blank or non-string %s", (field) => {
    expect(checkApplicationField(field, "   ")).toBe(`${field} must be a non-empty string.`);
    expect(checkApplicationField(field, 5)).toBe(`${field} must be a non-empty string.`);
  });

  it("limits company, position and location to 200 characters", () => {
    expect(checkApplicationField("company", "a".repeat(200))).toBeNull();
    expect(checkApplicationField("company", "a".repeat(201))).toBe("company can be at most 200 characters.");
  });

  it("accepts only known statuses", () => {
    expect(checkApplicationField("status", "Interview")).toBeNull();
    expect(checkApplicationField("status", "Ghosted")).toBe("Invalid status.");
  });

  it("accepts a known workplace model or null", () => {
    expect(checkApplicationField("workplace_model", "Remote")).toBeNull();
    expect(checkApplicationField("workplace_model", null)).toBeNull();
    expect(checkApplicationField("workplace_model", "Office")).toBe("Invalid workplace model.");
  });

  it("accepts a web link or null, up to 500 characters", () => {
    expect(checkApplicationField("job_url", null)).toBeNull();
    expect(checkApplicationField("job_url", "https://example.com/job")).toBeNull();
    expect(checkApplicationField("job_url", "example.com/job")).toBe("The link must start with http:// or https://.");
    expect(checkApplicationField("job_url", `https://example.com/${"a".repeat(500)}`)).toBe("The link can be at most 500 characters.");
  });

  it("accepts notes as a string or null, up to 5000 characters", () => {
    expect(checkApplicationField("notes", null)).toBeNull();
    expect(checkApplicationField("notes", "a".repeat(5000))).toBeNull();
    expect(checkApplicationField("notes", "a".repeat(5001))).toBe("Notes can be at most 5000 characters.");
    expect(checkApplicationField("notes", 5)).toBe("notes must be a string or null.");
  });

  it("accepts a real date or null for applied_at", () => {
    expect(checkApplicationField("applied_at", "2026-05-01")).toBeNull();
    expect(checkApplicationField("applied_at", null)).toBeNull();
    expect(checkApplicationField("applied_at", "2026-02-30")).toBe("applied_at must be a real date in YYYY-MM-DD format or null.");
  });

  it("rejects fields that can't be updated", () => {
    expect(checkApplicationField("id", 1)).toBe("id cannot be updated.");
  });
});
