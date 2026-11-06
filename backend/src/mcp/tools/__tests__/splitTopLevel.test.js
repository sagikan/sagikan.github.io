import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { splitTopLevel } = require("../splitTopLevel");

describe("splitTopLevel", () => {
  it.each([
    ["a, b, c", ["a", "b", "c"]],
    ["", []],
    ["requireAuth, userLimiter(300, 60, \"Too many.\")", ["requireAuth", "userLimiter(300, 60, \"Too many.\")"]],
    ["name TEXT CHECK (name IN ('a', 'b')), id INT", ["name TEXT CHECK (name IN ('a', 'b'))", "id INT"]],
    ["x DEFAULT 'a,b', y", ["x DEFAULT 'a,b'", "y"]],
    ["a,, b,", ["a", "b"]]
  ])("splits %j into %j", (text, expected) => {
    expect(splitTopLevel(text)).toEqual(expected);
  });
});
