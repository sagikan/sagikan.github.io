const fs = require("fs");
const path = require("path");

const MAP_PATTERN = /(?:export )?const ([A-Z][A-Z_]*) = \{([^{}]*)\}/g;
const NAME_PATTERN = /LIMIT|MAX|LENGTH/;
const ENTRY_PATTERN = /^(\w+):\s*(\d+)$/;
const LITERAL_PATTERN = /maxLength=\{(\d+)\}/g;
const INLINE_CALL_PATTERN = /\b(?:text|plain|paragraphs)\(\s*([\w$.?[\]]+)\s*,\s*(\d+)\s*\)/g;
const INLINE_SLICE_PATTERN = /\.slice\(\s*0\s*,\s*(\d+)\s*\)/g;
const LINE_KEY_PATTERN = /^\s*(?:const |let |var )?(\w+)\s*[:=](?!=)/;
const FUNCTION_PATTERN = /^(?:async )?function (\w+)/gm;
const SOURCE_FILE_PATTERN = /\.jsx?$/;
const SKIPPED_DIRS = ["node_modules", "__tests__", "dist"];

// Finds objects of named numeric limits (such as MAX_LENGTH or LIMITS) in a source file
function parseLimitMaps(source) {
  const maps = [];

  for (const [, name, body] of source.matchAll(MAP_PATTERN)) {
    const entries = body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.match(ENTRY_PATTERN));

    if (NAME_PATTERN.test(name) && entries.length > 0 && entries.every(Boolean)) {
      maps.push({ name, limits: Object.fromEntries(entries.map(([, key, value]) => [key, Number(value)])) });
    }
  }

  return maps;
}

// Finds maxLength props written as a plain number, with their line numbers
function findLiteralMaxLengths(source) {
  const found = [];

  for (const match of source.matchAll(LITERAL_PATTERN)) {
    found.push({ line: source.slice(0, match.index).split("\n").length, value: Number(match[1]) });
  }

  return found;
}

// Returns the name of the top-level function that contains a position, or null
function enclosingFunction(source, index) {
  const before = source.slice(0, index);
  const last = [...before.matchAll(FUNCTION_PATTERN)].pop();

  return last && !/^\}/m.test(before.slice(last.index)) ? last[1] : null;
}

// Finds limits written inline (text(x, 500), .slice(0, 15)) with the names they might go by
function parseInlineLimits(source) {
  const matches = [
    ...[...source.matchAll(INLINE_CALL_PATTERN)].map((match) => ({ index: match.index, arg: match[1], value: Number(match[2]) })),
    ...[...source.matchAll(INLINE_SLICE_PATTERN)].map((match) => ({ index: match.index, arg: null, value: Number(match[1]) }))
  ];
  const found = [];

  for (const { index, arg, value } of matches) {
    const lineStart = source.lastIndexOf("\n", index) + 1;
    const lineEnd = source.indexOf("\n", index);
    const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
    const argKey = arg ? arg.split(/[.?[\]]+/).filter(Boolean).pop() : null;
    const keys = [...new Set([argKey, line.match(LINE_KEY_PATTERN)?.[1], enclosingFunction(source, index)].filter(Boolean))];

    found.push({ line: source.slice(0, index).split("\n").length, keys, value });
  }

  return found;
}

// Compares frontend limits with the server's: flags forms that accept more than the server allows
function compareLimits(frontend, backend, inline = []) {
  const exceeds = [];
  const inlineMatched = [];
  const unmatched = [];

  for (const front of frontend) {
    const missing = [];

    for (const [key, value] of Object.entries(front.limits)) {
      const mapped = backend.filter((back) => key in back.limits).map((back) => ({ where: `${back.file} ${back.name}.${key}`, value: back.limits[key], inline: false }));
      const written = inline.filter((item) => item.keys.includes(key)).map((item) => ({ where: `${item.file}:${item.line}`, value: item.value, inline: true }));
      const candidates = mapped.length > 0 ? mapped : written;
      const strictest = candidates.reduce((lowest, item) => (item.value < lowest.value ? item : lowest), candidates[0]);

      if (!strictest) {
        missing.push(key);
      } else if (value > strictest.value) {
        exceeds.push(`${front.file} ${front.name}.${key} = ${value} is above ${strictest.where} = ${strictest.value}`);
      } else if (strictest.inline) {
        inlineMatched.push(`${front.file} ${front.name}.${key} = ${value}, server ${strictest.where} = ${strictest.value}`);
      }
    }

    if (missing.length > 0) {
      unmatched.push(`${front.file} ${front.name}: ${missing.join(", ")}`);
    }
  }

  return { exceeds, inlineMatched, unmatched };
}

// Lists the source files under a folder, skipping dependencies and tests
function collectFiles(dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.includes(entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(dir, entry.name)));
    } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

// Reads every limit map, literal maxLength and inline limit under one side of the project
function scanSide(rootDir, folder) {
  const maps = [];
  const literals = [];
  const inline = [];

  for (const filePath of collectFiles(path.join(rootDir, folder, "src"))) {
    const source = fs.readFileSync(filePath, "utf8");
    const file = path.relative(path.join(rootDir, folder, "src"), filePath).split(path.sep).join("/");

    maps.push(...parseLimitMaps(source).map((map) => ({ ...map, file })));
    literals.push(...findLiteralMaxLengths(source).map((literal) => ({ ...literal, file })));
    inline.push(...parseInlineLimits(source).map((item) => ({ ...item, file })));
  }

  return { maps, literals, inline };
}

// Formats a limit map on one line
function formatMap(map) {
  return `  ${map.file} ${map.name}: ${Object.entries(map.limits).map(([key, value]) => `${key} ${value}`).join(", ")}`;
}

// Lists every limit in the project and flags forms that accept more than the server allows
function checkLimits(rootDir) {
  const backend = scanSide(rootDir, "backend");
  const frontend = scanSide(rootDir, "frontend");
  const { exceeds, inlineMatched, unmatched } = compareLimits(frontend.maps, backend.maps, backend.inline);

  return [
    "Server limits:",
    ...backend.maps.map(formatMap),
    "Form limits:",
    ...frontend.maps.map(formatMap),
    ...(frontend.literals.length ? ["Form maxLength written as a number:", ...frontend.literals.map((literal) => `  ${literal.file}:${literal.line} ${literal.value}`)] : []),
    "Form limits above the matching server limit (the server would reject what the form accepts):",
    ...(exceeds.length ? exceeds.map((line) => `  ${line}`) : ["  none"]),
    "Form limits matched to limits written inline on the server (by field name, so check the line):",
    ...(inlineMatched.length ? inlineMatched.map((line) => `  ${line}`) : ["  none"]),
    "Form limits with no server limit found (check by hand):",
    ...(unmatched.length ? unmatched.map((line) => `  ${line}`) : ["  none"])
  ].join("\n");
}

module.exports = { parseLimitMaps, findLiteralMaxLengths, parseInlineLimits, compareLimits, checkLimits };
