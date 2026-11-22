const { PROVIDERS } = require("./boardProviders");

// A board's token, unless its system says otherwise (tokenFormat)
const TOKEN = /^[A-Za-z0-9._-]{1,80}$/;
// Each system's link patterns, from its entry in PROVIDERS
const BOARD_PATTERNS = Object.entries(PROVIDERS).flatMap(([provider, entry]) => (entry.links || []).map((pattern) => [provider, pattern]));
// A Comeet widget's company code, as its WordPress plugin and script settings write it
const COMEET_CODE = /(?:comeet_uid|company[-_]uid|companyUid)["'\s:=]+([0-9A-F]{2}\.[0-9A-F]{3})\b/gi;
const NOT_TOKENS = new Set([
  "embed", "v1", "api", "jobs", "boards", "job_board", "j", "www", "app", "apply", "careers", "help", "support", "blog",
  "oneclick-ui", "static", "cdn", "resources"
]);

// Decodes a URL-encoded value, keeping it as-is if invalid
function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Finds job board links in text
function boardsIn(text) {
  const found = new Map();

  for (const [provider, pattern] of BOARD_PATTERNS) {
    const { linkToken, tokenFormat } = PROVIDERS[provider];

    for (const match of String(text || "").matchAll(pattern)) {
      const token = decoded(linkToken ? linkToken(match) : match[1]);
      const name = token.split("/")[0].toLowerCase();

      if ((tokenFormat || TOKEN).test(token) && !NOT_TOKENS.has(name)) {
        found.set(`${provider}:${token.toLowerCase()}`, { provider, token });
      }
    }
  }

  return [...found.values()];
}

// Finds the company codes of Comeet widgets in a page
function comeetCodes(text) {
  return [...new Set([...String(text || "").matchAll(COMEET_CODE)].map((match) => match[1].toUpperCase()))];
}

// Turns a board token into a company name, leaving out a Workday host's server number
function prettyName(token) {
  return token
    .split("/")[0]
    .replace(/\.wd\d+$/i, "")
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => (word === word.toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

module.exports = { boardsIn, comeetCodes, prettyName };
