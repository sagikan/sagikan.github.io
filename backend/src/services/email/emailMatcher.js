const COMPANY_NOISE = new Set([
  "inc", "incorporated", "ltd", "limited", "llc", "corp", "corporation", "co", "company",
  "gmbh", "plc", "the", "israel", "il", "technologies", "technology", "systems", "group"
]);
const POSITION_NOISE = new Set(["a", "an", "and", "the", "of", "in", "for", "at", "to"]);
const COMPANY_MATCH_MIN = 0.8;
const POSITION_MATCH_MIN = 0.5;
const POSITION_GAP_MIN = 0.15;
const MAX_CANDIDATES = 8;
/* The status moves an email update can make: "auto" is applied when the match is confident, "review" always waits
   for the user, and a move that isn't listed is ignored. Hand edits aren't limited by this: the user can set any status */
const EMAIL_MOVES = {
  Applied: { Interview: "auto", Offer: "auto", Rejected: "auto" },
  Interview: { Offer: "auto", Rejected: "auto" },
  Offer: { Rejected: "review" },
  Rejected: {},
  Withdrawn: {}
};

// Splits text into lowercase words, without the given noise words
function tokens(text, noise) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .split(" ")
    .filter((token) => token && !noise.has(token));
}

// Checks whether one word list contains another in order
function containsSequence(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) {
    return false;
  }

  for (let start = 0; start <= haystack.length - needle.length; start++) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) {
      return true;
    }
  }

  return false;
}

// Measures how much two word lists overlap
function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [...setA].filter((token) => setB.has(token)).length;
  const total = new Set([...setA, ...setB]).size;

  return total ? shared / total : 0;
}

// Scores how likely two company names are the same
function companyScore(a, b) {
  const tokensA = tokens(a, COMPANY_NOISE);
  const tokensB = tokens(b, COMPANY_NOISE);

  if (!tokensA.length || !tokensB.length) {
    return 0;
  }

  if (tokensA.join(" ") === tokensB.join(" ")) {
    return 1;
  }

  if (containsSequence(tokensA, tokensB) || containsSequence(tokensB, tokensA)) {
    return 0.9;
  }

  return jaccard(tokensA, tokensB);
}

// Scores how similar two job titles are
function positionScore(a, b) {
  return jaccard(tokens(a, POSITION_NOISE), tokens(b, POSITION_NOISE));
}

// Checks whether an application was made by the day the email arrived
function appliedBy(application, receivedDay) {
  return !application.applied_at || !receivedDay || application.applied_at <= receivedDay;
}

/* Offers the one application with the exact same title when no company matches, since some emails don't
   name the company. It goes to review as a choice, never as a match */
function matchByPosition(event, applications, receivedDay) {
  const fits = applications.filter(
    (application) =>
      event.position && appliedBy(application, receivedDay) && positionScore(event.position, application.position) === 1
  );

  return fits.length === 1 ? { kind: "ambiguous", candidates: fits } : { kind: "none" };
}

// Finds the application an email is about
function matchApplication(event, applications, receivedDay) {
  const candidates = applications
    .map((application) => ({
      application,
      company: companyScore(event.company, application.company),
      position: event.position ? positionScore(event.position, application.position) : null
    }))
    .filter((candidate) => candidate.company >= COMPANY_MATCH_MIN);

  if (candidates.length === 0) {
    return matchByPosition(event, applications, receivedDay);
  }

  const existing = candidates.filter(({ application }) => appliedBy(application, receivedDay));

  if (existing.length === 0) {
    return { kind: "predates" };
  }

  const ranked = existing.sort(
    (a, b) => (b.position ?? 0) - (a.position ?? 0) || b.company - a.company
  );

  if (ranked.length === 1) {
    const [only] = ranked;

    return {
      kind: "match",
      application: only.application,
      company: only.company,
      position: only.position,
      sure: only.position === null || only.position >= POSITION_MATCH_MIN / 2
    };
  }

  const [best, second] = ranked;

  if (best.position !== null && best.position >= POSITION_MATCH_MIN && best.position - second.position >= POSITION_GAP_MIN) {
    return { kind: "match", application: best.application, company: best.company, position: best.position, sure: true };
  }

  return {
    kind: "ambiguous",
    candidates: ranked.slice(0, MAX_CANDIDATES).map(({ application }) => application)
  };
}

// Decides whether a status change is applied, reviewed or ignored
function transition(current, target) {
  return Object.hasOwn(EMAIL_MOVES, current) && Object.hasOwn(EMAIL_MOVES[current], target) ? EMAIL_MOVES[current][target] : "ignore";
}

// Builds an SQL condition that's true when an email update may move the current status to the target (see EMAIL_MOVES)
function movesStatusSql(current, target) {
  const pairs = Object.entries(EMAIL_MOVES).flatMap(([from, moves]) => Object.keys(moves).map((to) => `('${from}', '${to}')`));

  return `(${current}, ${target}) IN (${pairs.join(", ")})`;
}

module.exports = { EMAIL_MOVES, matchApplication, transition, movesStatusSql, companyScore, positionScore };
