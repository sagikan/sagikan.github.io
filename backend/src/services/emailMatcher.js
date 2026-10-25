const COMPANY_NOISE = new Set([
  "inc", "incorporated", "ltd", "limited", "llc", "corp", "corporation", "co", "company",
  "gmbh", "plc", "the", "israel", "il", "technologies", "technology", "systems", "group"
]);
const POSITION_NOISE = new Set(["a", "an", "and", "the", "of", "in", "for", "at", "to"]);
const COMPANY_MATCH_MIN = 0.8;
const POSITION_MATCH_MIN = 0.5;
const POSITION_GAP_MIN = 0.15;
const MAX_CANDIDATES = 8;
const RANK = { Applied: 0, Interview: 1, Offer: 2 };

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

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [...setA].filter((token) => setB.has(token)).length;
  const total = new Set([...setA, ...setB]).size;

  return total ? shared / total : 0;
}

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

function positionScore(a, b) {
  return jaccard(tokens(a, POSITION_NOISE), tokens(b, POSITION_NOISE));
}

function matchApplication(event, applications, receivedDay) {
  const candidates = applications
    .map((application) => ({
      application,
      company: companyScore(event.company, application.company),
      position: event.position ? positionScore(event.position, application.position) : null
    }))
    .filter((candidate) => candidate.company >= COMPANY_MATCH_MIN);

  if (candidates.length === 0) {
    return { kind: "none" };
  }

  const existing = candidates.filter(
    ({ application }) => !application.applied_at || !receivedDay || application.applied_at <= receivedDay
  );

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

function transition(current, target) {
  if (current === target || current === "Rejected" || current === "Withdrawn") {
    return "ignore";
  }

  if (target === "Rejected") {
    return current === "Offer" ? "review" : "auto";
  }

  return RANK[target] > RANK[current] ? "auto" : "ignore";
}

module.exports = { matchApplication, transition, companyScore, positionScore };
