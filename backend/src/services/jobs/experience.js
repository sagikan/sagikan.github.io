const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const MILITARY = /\b(idf|army|military|national service|sherut leumi|navy|air force|israel defense forces|soldier)\b/i;
const TECH_ROLE = /\b(develop|engineer|software|programm|data|devops|cyber|analyst|it|qa|research|r&d)/i;
const OPTIONAL = /\b(advantage|bonus|plus|nice[\s-]to[\s-]have|preferred|desired|ideally)\b/i;
const EXPERIENCE_NEAR = /experience|background|track record|industry|professional|hands[\s-]on|working/i;
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const YEARS = /(?<![\d.])(?:at least|minimum(?: of)?|min\.?|over|more than)?\s*(\d{1,2}(?:\.\d)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b(?![\s-]*old)/gi;
const ABOUT_US = /\b(our|team|company|join|gain|you'?ll learn)\b/i;
const ENTRY_TITLE = /\b(junior|jr|entry|graduate|intern|internship|student)\b/i;
const QUALITATIVE = /\b(proven|extensive|significant|substantial|demonstrated|previous|prior)\s+(?:\w+\s+){0,2}(?:professional\s+|industry\s+|work\s+)?(?:experience|track record)\b/i;
const PROFESSIONAL = /\b(professional|industry|commercial|production)\s+experience\b/i;

// Turns a resume date into a month count
function monthIndex(value, fallback) {
  if (value === "Present") {
    const now = new Date();

    return now.getFullYear() * 12 + now.getMonth();
  }

  const match = /^(?:(\w{3}) )?(\d{4})$/.exec(String(value || "").trim());
  if (!match) return fallback;

  return Number(match[2]) * 12 + (match[1] in MONTHS ? MONTHS[match[1]] : 0);
}

// Counts the candidate's years of relevant work experience
function candidateYears(cv) {
  const spans = (cv?.experience || [])
    .filter((entry) => {
      const text = `${entry.title || ""} ${entry.company || ""}`;

      return !MILITARY.test(text) || TECH_ROLE.test(entry.title || "");
    })
    .map((entry) => {
      const start = monthIndex(entry.start, null);
      const end = monthIndex(entry.end, start);

      return start === null ? null : [start, Math.max(start, end ?? start) + 1];
    })
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
  let months = 0;
  let reach = -Infinity;

  for (const [start, end] of spans) {
    if (end > reach) {
      months += end - Math.max(start, reach);
      reach = end;
    }
  }

  return Math.round((months / 12) * 10) / 10;
}

// Finds the years of experience a job description asks for
function requiredExperience(description, title = "") {
  let years = 0;

  for (const line of String(description || "").split(/\n|(?<=[.;•])\s+/)) {
    if (OPTIONAL.test(line)) continue;

    for (const match of line.matchAll(YEARS)) {
      const after = line.slice(match.index, match.index + match[0].length + 70);
      const before = line.slice(Math.max(0, match.index - 40), match.index);

      if (!EXPERIENCE_NEAR.test(after) && !EXPERIENCE_NEAR.test(before)) continue;
      if (/\b(degree|bsc|b\.sc|msc|study|studies|university)\b/i.test(after)) continue;

      const value = NUMBER_WORDS[match[1].toLowerCase()] ?? Number(match[1]);
      if (value >= 1 && value <= 15) years = Math.max(years, value);
    }
  }

  const lines = String(description || "").split(/\n|(?<=[.;•])\s+/)
    .filter((line) => !OPTIONAL.test(line) && !ABOUT_US.test(line));
  const hinted = years === 0 && !ENTRY_TITLE.test(title) &&
    lines.some((line) => QUALITATIVE.test(line) || PROFESSIONAL.test(line));

  return { years, hinted };
}

// Lowers a match score when the candidate lacks the required experience
function adjustForExperience(score, haveYears, required) {
  const needYears = required.years || (required.hinted ? 1 : 0);

  if (needYears === 0 || haveYears >= needYears) {
    return score;
  }

  if (haveYears < 0.5) {
    if (required.years >= 2) return Math.min(score, 15);
    if (required.years === 1) return Math.min(score, 25);

    return Math.min(score, 30);
  }

  const gap = needYears - haveYears;

  return Math.max(0, Math.round(score - Math.min(35, gap * 10)));
}

// Describes the experience requirement for display
function requirementPhrase(required) {
  if (required.years) return `${required.years}+ years experience`;
  if (required.hinted) return "Professional experience";

  return null;
}

module.exports = { candidateYears, requiredExperience, adjustForExperience, requirementPhrase };
