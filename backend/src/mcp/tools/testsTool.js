const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const MAX_FAILURES = 10;
const MAX_MESSAGE_LENGTH = 600;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 120000;
const FILTER_PATTERN = /^[\w./-]+$/;

// Removes terminal color codes from text
function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

// Cuts a failure message down to its first useful lines
function shorten(message) {
  const text = stripAnsi(message || "").trim();

  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}...` : text;
}

// Builds a short pass/fail summary from a Vitest JSON report
function summarizeResults(report, rootDir = "") {
  const failures = [];

  for (const file of report.testResults) {
    const name = rootDir ? path.relative(rootDir, file.name) : file.name;

    for (const test of file.assertionResults.filter((result) => result.status === "failed")) {
      failures.push(`FAIL ${name} > ${test.fullName}\n  ${shorten(test.failureMessages.join("\n")).replace(/\n/g, "\n  ")}`);
    }

    if (file.status === "failed" && file.assertionResults.length === 0) {
      failures.push(`FAIL ${name} (suite did not run)\n  ${shorten(file.message).replace(/\n/g, "\n  ")}`);
    }
  }

  const header = `${report.numPassedTests}/${report.numTotalTests} tests passed, ${report.numFailedTests} failed, ${report.testResults.length} files`;
  const shown = failures.slice(0, MAX_FAILURES);
  const hidden = failures.length - shown.length;

  return [header, ...shown, ...(hidden > 0 ? [`... and ${hidden} more failures`] : [])].join("\n");
}

// Runs a project's unit tests (optionally only files matching a filter) and resolves with a short summary
function runTests(projectDir, filter = "") {
  if (filter && (!FILTER_PATTERN.test(filter) || filter.startsWith("-"))) {
    return Promise.resolve("Invalid filter: use a file name or path fragment such as applicationFields.");
  }

  const vitest = path.join(projectDir, "node_modules", ".bin", "vitest");
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "vitest-report-"));
  const reportFile = path.join(reportDir, "report.json");
  const args = ["run", "--reporter=json", `--outputFile=${reportFile}`, ...(filter ? [filter] : [])];

  return new Promise((resolve) => {
    execFile(vitest, args, { cwd: projectDir, maxBuffer: MAX_OUTPUT_BYTES, timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      try {
        resolve(summarizeResults(JSON.parse(fs.readFileSync(reportFile, "utf8")), projectDir));
      } catch {
        resolve(`Could not read the Vitest report.\n${shorten(stderr || stdout || (error && error.message))}`);
      } finally {
        fs.rmSync(reportDir, { recursive: true, force: true });
      }
    });
  });
}

module.exports = { summarizeResults, runTests };
