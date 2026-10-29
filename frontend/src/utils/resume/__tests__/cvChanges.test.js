import { describe, expect, it } from "vitest";
import { basePositions } from "../cvChanges";

describe("basePositions", () => {
  it("numbers the items that exist in the base order, in base order", () => {
    const items = [{ id: "c" }, { id: "a" }, { id: "b" }];

    expect([...basePositions(items, ["a", "b", "c"])]).toEqual([["a", 0], ["b", 1], ["c", 2]]);
  });

  it("leaves out items that aren't in the base order", () => {
    const items = [{ id: "new" }, { id: "b" }, { id: "a" }];

    expect([...basePositions(items, ["a", "b", "c"])]).toEqual([["a", 0], ["b", 1]]);
  });

  it("returns an empty map for no items", () => {
    expect(basePositions([], ["a"]).size).toBe(0);
  });
});
