import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { summarizeResults, runTests } = require("../testsTool");

const PASSING = {
  numTotalTests: 2,
  numPassedTests: 2,
  numFailedTests: 0,
  testResults: [{ name: "/repo/backend/src/a.test.js", status: "passed", assertionResults: [{ status: "passed", fullName: "a works", failureMessages: [] }] }]
};

// Builds a report with the given number of failing tests in one file
function failingReport(count) {
  const failed = Array.from({ length: count }, (_, i) => ({ status: "failed", fullName: `case ${i}`, failureMessages: ["\u001b[31mexpected 1 to be 2\u001b[39m"] }));

  return { numTotalTests: count, numPassedTests: 0, numFailedTests: count, testResults: [{ name: "/repo/backend/src/b.test.js", status: "failed", assertionResults: failed }] };
}

describe("summarizeResults", () => {
  it("returns only the counts when everything passes", () => {
    expect(summarizeResults(PASSING)).toBe("2/2 tests passed, 0 failed, 1 files");
  });

  it("lists failures with relative file names and no color codes", () => {
    const output = summarizeResults(failingReport(1), "/repo/backend");

    expect(output).toBe("0/1 tests passed, 1 failed, 1 files\nFAIL src/b.test.js > case 0\n  expected 1 to be 2");
  });

  it("caps the number of failures shown", () => {
    const output = summarizeResults(failingReport(12));

    expect(output).toContain("case 9");
    expect(output).not.toContain("case 10");
    expect(output).toContain("... and 2 more failures");
  });

  it("reports a suite that crashed before running any test", () => {
    const report = { ...PASSING, numFailedTests: 1, testResults: [{ name: "/repo/c.test.js", status: "failed", assertionResults: [], message: "Cannot find module" }] };

    expect(summarizeResults(report)).toContain("FAIL /repo/c.test.js (suite did not run)\n  Cannot find module");
  });
});

describe("runTests", () => {
  it.each(["--watch", "a b", "-x", "x;rm"])("rejects the filter %j", async (filter) => {
    const output = await runTests("/unused", filter);

    expect(output).toMatch(/^Invalid filter/);
  });
});
