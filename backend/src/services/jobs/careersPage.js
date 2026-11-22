const { BROWSER_USER_AGENT, safeFetch } = require("../shared/safeFetch");
const { boardsIn, comeetCodes } = require("./boardLinks");
const { PROVIDERS } = require("./boardProviders");

// Pages and scripts read besides the careers page itself, per company
const MAX_EXTRA = 3;
const HEADERS = {
  "User-Agent": BROWSER_USER_AGENT,
  Accept: "text/html,application/javascript;q=0.9,*/*;q=0.8",
  "Accept-Language": "en"
};
const SCRIPT_SRC = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
const LINK_HREF = /<a\b[^>]*?\bhref\s*=\s*["']([^"'#]+)["']/gi;
// A script named after a job system: the name in one of its sites (greenhouse, myworkdayjobs)
const SYSTEM_SCRIPT = new RegExp([...new Set(Object.values(PROVIDERS).flatMap((entry) => entry.hosts || []).map((site) => site.split(".")[0]))].join("|"), "i");
const JOBS_WORDS = /career|jobs?\b|positions?|openings?|open-roles|vacanc|join-us|hiring/i;

// Fetches a page or script, returning its address and text, or null
async function fetchPage(url) {
  try {
    const response = await safeFetch(url, { headers: HEADERS });

    return response.ok ? { url: response.url, text: await response.text() } : null;
  } catch {
    return null;
  }
}

// Finds the boards and Comeet codes in a page
function scan(page) {
  const text = `${page.url}\n${page.text}`;

  return { boards: boardsIn(text), comeetCodes: comeetCodes(text) };
}

// Resolves the links that match a pattern in a page against the page's address
function linksIn(page, pattern) {
  return [...page.text.matchAll(pattern)].flatMap((match) => {
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), page.url);

      return ["http:", "https:"].includes(url.protocol) ? [url] : [];
    } catch {
      return [];
    }
  });
}

/* Lists what else to read when a careers page names no board: scripts named after a job system (anywhere), career or
   jobs scripts on the same site, then links to a jobs page on the same site. Many sites load their board from a script,
   or keep it a click away from the careers page */
function followUps(page) {
  const site = new URL(page.url).hostname.replace(/^www\./, "");
  // Checks that a link is on the careers page's site or one of its subdomains
  const sameSite = (url) => {
    const host = url.hostname.replace(/^www\./, "");

    return host === site || host.endsWith(`.${site}`);
  };
  const scripts = linksIn(page, SCRIPT_SRC).filter((url) => SYSTEM_SCRIPT.test(url.href) || (sameSite(url) && JOBS_WORDS.test(url.pathname)));
  const pages = linksIn(page, LINK_HREF).filter((url) => sameSite(url) && JOBS_WORDS.test(url.pathname) && url.href !== page.url);

  return [...new Set([...scripts, ...pages].map((url) => url.href))].slice(0, MAX_EXTRA);
}

// Reads a company's careers page for the boards and Comeet codes it holds, looking a step further when it holds none
async function readCareersPage(url) {
  const page = await fetchPage(url);

  if (!page) {
    return { boards: [], comeetCodes: [] };
  }

  const found = scan(page);

  for (const next of found.boards.length || found.comeetCodes.length ? [] : followUps(page)) {
    const extra = await fetchPage(next);

    if (extra) {
      const more = scan(extra);
      found.boards.push(...more.boards);
      found.comeetCodes.push(...more.comeetCodes);
    }

    if (found.boards.length || found.comeetCodes.length) break;
  }

  return found;
}

module.exports = { readCareersPage };
