import { describe, expect, it } from "vitest";
import { GRADE_SHEET, RESUME_FILE, TAILOR } from "../resumeMachines";

describe("TAILOR", () => {
  it.each([
    ["loading", "loaded", undefined, "ready"],
    ["loading", "generate", undefined, "tailoring"],
    ["loading", "fail", undefined, "failed"],
    ["tailoring", "loaded", undefined, "ready"],
    ["tailoring", "fail", "ready", "ready"],
    ["tailoring", "fail", "failed", "failed"],
    ["ready", "generate", undefined, "tailoring"],
    ["failed", "generate", undefined, "tailoring"]
  ])("moves from %s on %s (to %s) to %s", (state, event, pick, expected) => {
    expect(TAILOR.next(state, event, pick)).toBe(expected);
  });

  it("doesn't tailor again while tailoring", () => {
    expect(TAILOR.can("tailoring", "generate")).toBe(false);
  });
});

describe("RESUME_FILE", () => {
  it("never reads and saves at the same time", () => {
    expect(RESUME_FILE.next("idle", "read")).toBe("reading");
    expect(RESUME_FILE.next("idle", "save")).toBe("saving");
    expect(RESUME_FILE.can("reading", "save")).toBe(false);
    expect(RESUME_FILE.can("saving", "read")).toBe(false);
    expect(RESUME_FILE.next("saving", "done")).toBe("idle");
  });
});

describe("GRADE_SHEET", () => {
  it("is busy from start to done", () => {
    expect(GRADE_SHEET.next("idle", "start")).toBe("busy");
    expect(GRADE_SHEET.can("busy", "start")).toBe(false);
    expect(GRADE_SHEET.next("busy", "done")).toBe("idle");
  });
});
