const fs = require("fs");
const path = require("path");
const { collectRoutes } = require("./routesTool");

const CALL_PATTERN = /\.(get|post|put|patch|delete)\(\s*([`"'])(\/api\/[^`"']*)\2/g;
const TEST_START_PATTERN = /^(?=[ \t]*it(?:\.each)?\()/m;
const HELPER_PATTERN = /^([ \t]*)(?:async )?function (\w+)[\s\S]*?^\1\}/gm;
const USER_PATTERN = /\b(?:signedInClient|createUser)\(/g;

// Turns a route or test path into a comparable form, with every parameter written as ":"
function normalizePath(value) {
  const segments = value.split("?")[0].replace(/\/+$/, "").split("/");

  return segments.map((segment) => (/^:|\$\{|^\d+$/.test(segment) ? ":" : segment)).join("/");
}

// Lists the "METHOD path" keys of the routes called in a piece of test code
function routesCalled(text) {
  return [...text.matchAll(CALL_PATTERN)].map(([, method, , callPath]) => `${method.toUpperCase()} ${normalizePath(callPath)}`);
}

// Maps each helper function in a test file to the routes it calls
function helperCalls(source) {
  const helpers = new Map();

  for (const [text, , name] of source.matchAll(HELPER_PATTERN)) {
    helpers.set(name, routesCalled(text));
  }

  return helpers;
}

// Finds the routes a database test file calls, and those called by a test that creates two users
function parseTestCalls(source) {
  const helpers = [...helperCalls(source)];
  const tested = new Set();
  const crossUser = new Set();

  for (const chunk of source.split(TEST_START_PATTERN)) {
    const twoUsers = (chunk.match(USER_PATTERN) || []).length >= 2;
    const viaHelpers = helpers.filter(([name]) => chunk.includes(`${name}(`)).flatMap(([, keys]) => keys);

    for (const key of [...routesCalled(chunk), ...viaHelpers]) {
      tested.add(key);

      if (twoUsers) {
        crossUser.add(key);
      }
    }
  }

  return { tested, crossUser };
}

// Lists the routes with no database test, and the signed-in ones with no test that involves a second user
function routeCoverage(srcDir, filter = "") {
  const needle = filter.toLowerCase();
  const noTest = [];
  const noCrossUser = [];
  let total = 0;

  for (const { file, shared, routes } of collectRoutes(srcDir)) {
    const testFile = path.join(srcDir, "routes", "__tests__", `${file}.db.test.js`);
    const { tested, crossUser } = parseTestCalls(fs.existsSync(testFile) ? fs.readFileSync(testFile, "utf8") : "");

    for (const route of routes.filter((item) => item.fullPath.toLowerCase().includes(needle))) {
      const key = `${route.method} ${normalizePath(route.fullPath)}`;
      const label = `${route.method.padEnd(6)} ${route.fullPath}`;

      total += 1;

      if (!tested.has(key)) {
        noTest.push(label);
      } else if ([...shared, ...route.middleware].includes("requireAuth") && !crossUser.has(key)) {
        noCrossUser.push(label);
      }
    }
  }

  return [
    `${total} routes: ${noTest.length} without a database test, ${noCrossUser.length} signed-in routes without a second-user test`,
    "No database test calls them:",
    ...(noTest.length ? noTest.map((line) => `  ${line}`) : ["  none"]),
    "Tested, but no single test creates a second user (signed-in routes only, so check the test by hand):",
    ...(noCrossUser.length ? noCrossUser.map((line) => `  ${line}`) : ["  none"])
  ].join("\n");
}

module.exports = { normalizePath, parseTestCalls, routeCoverage };
