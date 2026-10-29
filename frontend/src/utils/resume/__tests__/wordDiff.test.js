import { describe, expect, it } from "vitest";
import { wordDiff } from "../wordDiff";

describe("wordDiff", () => {
  it("returns a single unchanged run for identical text", () => {
    expect(wordDiff("the quick fox", "the quick fox")).toEqual([{ type: "same", text: "the quick fox" }]);
  });

  it("marks a replaced word as removed then added", () => {
    expect(wordDiff("the quick fox", "the slow fox")).toEqual([
      { type: "same", text: "the " },
      { type: "del", text: "quick" },
      { type: "same", text: " " },
      { type: "add", text: "slow" },
      { type: "same", text: " fox" }
    ]);
  });

  it("marks inserted words as added", () => {
    expect(wordDiff("the fox", "the quick fox")).toEqual([
      { type: "same", text: "the " },
      { type: "add", text: "quick" },
      { type: "same", text: " fox" }
    ]);
  });

  it("marks dropped words as removed", () => {
    expect(wordDiff("the quick fox", "the fox")).toEqual([
      { type: "same", text: "the " },
      { type: "del", text: "quick" },
      { type: "same", text: " fox" }
    ]);
  });

  it("treats empty and missing text as having no words", () => {
    expect(wordDiff("", "")).toEqual([]);
    expect(wordDiff(null, "new text")).toEqual([{ type: "add", text: "new text" }]);
    expect(wordDiff("old text", undefined)).toEqual([{ type: "del", text: "old text" }]);
  });

  it("keeps line breaks that are in the new text", () => {
    const runs = wordDiff("one\ntwo", "one\ntwo three");

    expect(runs.map((run) => run.text).join("")).toBe("one\ntwo three");
  });
});
