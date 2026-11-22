const { PROVIDERS, fetchPostings } = require("./boardProviders");
const { inFeedRegions, tidyLocation } = require("./locations");

// The systems whose public feeds can be asked for a board by its name, in the order they're tried
const PROBE_PROVIDERS = Object.keys(PROVIDERS).filter((provider) => PROVIDERS[provider].probe);
const NAME = /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/;
// Parts of a host name that aren't the company's name
const NOT_NAMES = new Set(["www", "careers", "career", "jobs", "job", "en", "il", "co", "com", "app", "web", "corp", "hr"]);

// Lists the board names a company likely uses: its website's domain name, then its name joined and dashed
function nameGuesses(name, website) {
  let host = "";

  try {
    host = new URL(String(website || "")).hostname.toLowerCase();
  } catch {
    // No website, so no domain to guess from
  }

  const domain = host.split(".").find((label) => !NOT_NAMES.has(label)) || "";
  const words = String(name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
  const guesses = [domain, words.replace(/ /g, ""), words.replace(/ /g, "-")];

  return [...new Set(guesses.filter((guess) => NAME.test(guess)))];
}

/* Checks that a guessed board is the company's: it must exist and list a job in a place in the feed regions (a remote
   job doesn't count). A guess can name another company's board (a short name such as "air"), and the companies guessed
   for come from a list for those regions */
async function hasFeedJob(provider, token) {
  try {
    const { gone, jobs } = await fetchPostings(PROVIDERS[provider], { token, company: "" }, null, { light: true });

    return !gone && jobs.some((job) => inFeedRegions(tidyLocation(job.location).location));
  } catch {
    return false;
  }
}

/* Finds a company's board on Comeet from a widget's company code, trying the name guesses in turn. A wrong name sends
   Comeet's page to its home page, which the reader reports as gone */
async function comeetBoard(code, guesses) {
  for (const guess of guesses) {
    const token = `${guess}/${code}`;

    if (await hasFeedJob("comeet", token)) {
      return { provider: "comeet", token };
    }
  }

  return null;
}

// Asks each system's public feed for a board under the company's likely names, and returns the first that checks out
async function probeBoard(guesses) {
  for (const provider of PROBE_PROVIDERS) {
    for (const token of guesses) {
      if (await hasFeedJob(provider, token)) {
        return { provider, token };
      }
    }
  }

  return null;
}

module.exports = { nameGuesses, comeetBoard, probeBoard };
