import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { NOTE, savedNoteState } = require("../noteStates");

describe("NOTE", () => {
  it("starts empty, and every move can start from any state", () => {
    expect(NOTE.initial).toBe("empty");
    expect(NOTE.sources("generate")).toEqual(["empty", "automatic", "written"]);
    expect(NOTE.sources("write")).toEqual(["empty", "automatic", "written"]);
    expect(NOTE.sources("clear")).toEqual(["empty", "automatic", "written"]);
  });
});

describe("savedNoteState", () => {
  it.each([
    ["no note", null, false, "empty"],
    ["no note, though marked automatic", null, true, "empty"],
    ["a note marked automatic", "Applied on Oct 10th", true, "automatic"],
    ["a note not marked automatic", "Applied on Oct 10th", false, "written"]
  ])("returns the right state for %s", (_title, notes, auto, expected) => {
    expect(savedNoteState(notes, auto)).toBe(expected);
  });
});
