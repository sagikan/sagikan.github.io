import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const db = require("../db");

describe("logIdleError", () => {
  it("logs the error message instead of throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    db.logIdleError(new Error("terminating connection"));

    expect(spy).toHaveBeenCalledWith("[db] Idle database connection error:", "terminating connection");
    spy.mockRestore();
  });

  it("is registered as the pool's error listener", () => {
    expect(db.listeners("error")).toContain(db.logIdleError);
  });
});

describe("isLocalDatabase", () => {
  it.each([
    ["postgres://user:pass@localhost:5432/app", true],
    ["postgres://user:pass@127.0.0.1:5432/app", true],
    ["postgres://user:pass@[::1]:5432/app", true],
    ["postgres://user:pass@db.example.com:5432/app", false],
    ["not a url", false],
  ])("returns the right answer for %s", (url, expected) => {
    expect(db.isLocalDatabase(url)).toBe(expected);
  });
});
