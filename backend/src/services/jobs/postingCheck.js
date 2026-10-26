const dev = require("../shared/devMode");
const { safeFetch } = require("../shared/safeFetch");

const TIMEOUT_MS = 12_000;
const CONCURRENCY = 4;
const BOARD_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com)$/i;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const CLOSED_MARKERS = [
  [/linkedin\.com$/i, /class="[^"]*\bclosed-job\b/i],
  [/indeed\.com$/i, /this job has expired|job has been removed|no longer available on indeed/i],
  [/glassdoor\./i, /this job (?:listing )?(?:is )?no longer available|job has expired/i],
  [/./, /no longer accepting applications|this (?:job|position) (?:has been filled|is no longer available|has expired)|job (?:posting )?(?:is )?closed for applications/i]
];

// Returns a URL's host name, or an empty string
function host(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// Checks whether a posting URL needs a check
function needsCheck(url) {
  const name = host(url);

  return Boolean(name) && !BOARD_HOSTS.test(name);
}

// Checks whether a posting is open, closed or unknown
async function status(url) {
  if (dev.offline) {
    return "unknown";
  }

  try {
    const response = await safeFetch(url, {
      timeoutMs: TIMEOUT_MS,
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en", Accept: "text/html" }
    });

    if (response.status === 404 || response.status === 410) {
      return "closed";
    }

    if (!response.ok) {
      return "unknown";
    }

    const page = await response.text();
    const name = host(response.url);
    const closed = CLOSED_MARKERS.some(([site, marker]) => site.test(name) && marker.test(page));

    return closed ? "closed" : "open";
  } catch {
    return "unknown";
  }
}

// Checks several postings at once
async function statuses(urls) {
  const unique = [...new Set(urls)];
  const result = new Map();
  let next = 0;

  // Checks URLs until none are left
  const worker = async () => {
    while (next < unique.length) {
      const url = unique[next++];
      result.set(url, await status(url));
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));

  return result;
}

module.exports = { needsCheck, status, statuses };
