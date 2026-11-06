import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { parseLimitMaps, findLiteralMaxLengths, parseInlineLimits, compareLimits, checkLimits } = require("../limitsTool");

const ROOT_DIR = path.join(import.meta.dirname, "..", "..", "..", "..", "..");
const SOURCE = `
// What a saved resume may contain
export const LIMITS = {
  links: 3, // per resume
  /* text */ summary: 600,
  name: 50
};
const MAX_LENGTH = { company: 200, url: 500 };
const ENTRY_LABELS = { experience: "Experience" };
const CV_SCHEMA = { type: 1 };
const SOMETHING_MAX = { fn: () => 1 };
`;
const BACKEND_LIMITS = [
  { file: "b/one.js", name: "MAX_LENGTH", limits: { company: 200, notes: 2000 } },
  { file: "b/two.js", name: "LIMITS", limits: { company: 100 } }
];
const INLINE_SOURCE = `
const LOCAL = 1;

// Keeps a link only if it uses a safe scheme
function link(value) {
  const url = text(value, 500);

  return url;
}

function normalize(cv) {
  return {
    phone: text(cv.phone).replace(/\\D/g, "").slice(0, 15),
    gpa: text(entry?.gpa, 10)
  };
}

router.post("/", async (req, res) => {
  const description = text(req.body?.description, 20000);
  const other = text(value, max);
});
`;

describe("parseLimitMaps", () => {
  it("reads maps of numeric limits and strips comments", () => {
    const maps = parseLimitMaps(SOURCE);

    expect(maps).toEqual([
      { name: "LIMITS", limits: { links: 3, summary: 600, name: 50 } },
      { name: "MAX_LENGTH", limits: { company: 200, url: 500 } }
    ]);
  });

  it("ignores objects whose name is not a limit or that hold other values", () => {
    expect(parseLimitMaps("const ENTRY_LABELS = { a: 1 };\nconst MAX_X = { a: \"b\" };")).toEqual([]);
  });
});

describe("findLiteralMaxLengths", () => {
  it("returns numeric maxLength props with their line numbers and skips expressions", () => {
    const source = "<input maxLength={6} />\n\n<input maxLength={LIMITS.name} />\n<input maxLength={20} />";

    expect(findLiteralMaxLengths(source)).toEqual([{ line: 1, value: 6 }, { line: 4, value: 20 }]);
  });
});

describe("parseInlineLimits", () => {
  it("reads limits written inline with the names they might go by", () => {
    expect(parseInlineLimits(INLINE_SOURCE)).toEqual([
      { line: 6, keys: ["value", "url", "link"], value: 500 },
      { line: 14, keys: ["gpa", "normalize"], value: 10 },
      { line: 19, keys: ["description"], value: 20000 },
      { line: 13, keys: ["phone", "normalize"], value: 15 }
    ]);
  });

  it("skips limits that are not plain numbers", () => {
    expect(parseInlineLimits("const a = text(value, max);\nconst b = list.slice(0, count);")).toEqual([]);
  });
});

describe("compareLimits", () => {
  it("flags a form limit above the strictest server limit for that key", () => {
    const frontend = [{ file: "f/Form.jsx", name: "MAX_LENGTH", limits: { company: 150, notes: 2000 } }];

    expect(compareLimits(frontend, BACKEND_LIMITS).exceeds).toEqual(["f/Form.jsx MAX_LENGTH.company = 150 is above b/two.js LIMITS.company = 100"]);
  });

  it("accepts form limits equal to or below the server's", () => {
    const frontend = [{ file: "f/Form.jsx", name: "MAX_LENGTH", limits: { company: 100, notes: 500 } }];

    expect(compareLimits(frontend, BACKEND_LIMITS).exceeds).toEqual([]);
  });

  it("matches form keys without a server map to limits written inline, and flags the ones above", () => {
    const inline = [
      { file: "b/route.js", line: 5, keys: ["url"], value: 500 },
      { file: "b/route.js", line: 9, keys: ["description"], value: 100 }
    ];
    const frontend = [{ file: "f/Form.jsx", name: "MAX_LENGTH", limits: { url: 500, description: 20000 } }];
    const result = compareLimits(frontend, BACKEND_LIMITS, inline);

    expect(result.inlineMatched).toEqual(["f/Form.jsx MAX_LENGTH.url = 500, server b/route.js:5 = 500"]);
    expect(result.exceeds).toEqual(["f/Form.jsx MAX_LENGTH.description = 20000 is above b/route.js:9 = 100"]);
  });

  it("prefers a server map over inline limits for the same key", () => {
    const inline = [{ file: "b/route.js", line: 5, keys: ["company"], value: 10 }];
    const frontend = [{ file: "f/Form.jsx", name: "MAX_LENGTH", limits: { company: 100 } }];

    expect(compareLimits(frontend, BACKEND_LIMITS, inline)).toEqual({ exceeds: [], inlineMatched: [], unmatched: [] });
  });

  it("lists form keys that have no server counterpart", () => {
    const frontend = [{ file: "f/Form.jsx", name: "MAX_LENGTH", limits: { company: 100, url: 500, gpa: 10 } }];

    expect(compareLimits(frontend, BACKEND_LIMITS).unmatched).toEqual(["f/Form.jsx MAX_LENGTH: url, gpa"]);
  });
});

describe("checkLimits", () => {
  it("lists the real server and form limits", () => {
    const output = checkLimits(ROOT_DIR);

    expect(output).toContain("services/applications/applicationFields.js MAX_LENGTH: company 200, position 200, location 200, job_url 500, notes 2000");
    expect(output).toContain("components/applications/ApplicationForm.jsx MAX_LENGTH: position 200, company 200, location 200, job_url 500, notes 2000");
    expect(output).toContain("components/auth/CodeInput.jsx:13 6");
  });
});
