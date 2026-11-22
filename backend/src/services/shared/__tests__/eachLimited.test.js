import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { eachLimited } = require("../eachLimited");

describe("eachLimited", () => {
  it("runs the task on every item", async () => {
    const seen = [];

    await eachLimited([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });

    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("runs at most the limit at a time", async () => {
    let running = 0;
    let most = 0;

    await eachLimited(Array.from({ length: 10 }, (_, index) => index), 3, async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
    });

    expect(most).toBe(3);
  });

  it("does nothing for no items", async () => {
    let calls = 0;

    await eachLimited([], 4, async () => {
      calls++;
    });

    expect(calls).toBe(0);
  });

  it("rejects when a task fails", async () => {
    const run = eachLimited([1, 2], 2, async (item) => {
      if (item === 2) throw new Error("boom");
    });

    await expect(run).rejects.toThrow("boom");
  });
});
