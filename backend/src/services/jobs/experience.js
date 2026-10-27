const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const MILITARY = /\b(idf|army|military|national service|sherut leumi|navy|air force|israel defense forces|soldier)\b/i;
const TECH_ROLE = /\b(develop|engineer|software|programm|data|devops|cyber|analyst|it|qa|research|r&d)/i;
const OPTIONAL = /\b(advantage|bonus|plus|nice[\s-]to[\s-]have|preferred|desired|ideally)\b/i;
const EXPERIENCE_AFTER = /^[\s'’]*(?:of\s+|in\s+)?(?:[\w/&-]+\s+){0,3}?(?:experience|exp\b)/i;
const EXPERIENCE_BEFORE = /(?:[\w/&-]+\s+){0,3}experience[^.;\n]{0,30}$/i;
const WORK_TERM = /\b(work|works|worked|working|workplace|professional|professionally|industry|industrial|commercial|commercially|employment|employed|corporate|full[\s-]time|production|real[\s-]world)\b/i;
const WAIVED = /\b(or equivalent|or comparable|or similar|or relevant (?:education|degree|studies|training|military)|(?:no|without|zero) (?:\w+\s+){0,2}experience|experience (?:is )?(?:not|isn't) (?:required|necessary|needed))\b/i;
const UPPER_BOUND = /\b(up to|less than|under|no more than|max(?:imum)?(?: of)?)\s*$/i;
const COMPANY_BRAG = /\b(our (?:team|company|founders?)|founded|established|we have been|for over)\b/i;
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const YEARS = /(?<![\d.])(?:at least|minimum(?: of)?|min\.?|over|more than)?\s*(\d{1,2}(?:\.\d)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b(?![\s-]*old)/gi;
const ABOUT_US = /\b(our|team|company|join|gain|you'?ll learn)\b/i;
const ENTRY_TITLE = /\b(junior|jr|entry|graduate|intern|internship|student)\b/i;
const WORK_EXPERIENCE = /\b(?:work|working|professional|professionally|industry|industrial|commercial|employment|corporate|full[\s-]time|production|real[\s-]world)\s+(?:\w+\s+)?(?:experience|track record)\b|\bexperience\s+(?:working\s+)?(?:in|as|at)\s+(?:a\s+)?(?:professional|industry|commercial|production|corporate)\b/i;

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
  let looseYears = 0;

  for (const line of String(description || "").split(/\n|(?<=[.;•])\s+/)) {
    if (OPTIONAL.test(line) || COMPANY_BRAG.test(line) || WAIVED.test(line)) continue;

    for (const match of line.matchAll(YEARS)) {
      const end = match.index + match[0].length;
      const after = line.slice(end, end + 60);
      const before = line.slice(Math.max(0, match.index - 40), match.index);
      const phrase = EXPERIENCE_AFTER.exec(after)?.[0] ?? EXPERIENCE_BEFORE.exec(before)?.[0];

      if (!phrase || UPPER_BOUND.test(before)) continue;
      if (/\b(degree|bsc|b\.sc|msc|study|studies|university)\b/i.test(after)) continue;

      const value = NUMBER_WORDS[match[1].toLowerCase()] ?? Number(match[1]);
      if (value < 1 || value > 15) continue;

      // "3 years of work experience" is a job requirement, "3 years of Python experience" can come from projects
      if (WORK_TERM.test(phrase)) years = Math.max(years, value);
      else looseYears = Math.max(looseYears, value);
    }
  }

  const lines = String(description || "").split(/\n|(?<=[.;•])\s+/)
    .filter((line) => !OPTIONAL.test(line) && !ABOUT_US.test(line) && !WAIVED.test(line));
  const hinted = years === 0 && !ENTRY_TITLE.test(title) && lines.some((line) => WORK_EXPERIENCE.test(line));

  return { years, looseYears, hinted };
}

// Lowers a match score for required work experience the candidate lacks, and barely for plain experience
function adjustForExperience(score, haveYears, required) {
  const strictGap = required.years - haveYears;
  const looseGap = required.looseYears - haveYears;
  const penalty = Math.max(
    strictGap > 0 ? Math.min(20, strictGap * 6) : 0,
    looseGap > 0 ? Math.min(6, looseGap * 2) : 0,
    required.hinted && haveYears < 0.5 ? 5 : 0
  );

  return Math.max(0, Math.round(score - penalty));
}

// Removes "N years of experience" phrases so the scorer judges skills while the code applies the experience penalty
function withoutYearRequirements(text) {
  const phrase = new RegExp(YEARS.source + String.raw`[\s'’]*(?:of\s+|in\s+)?(?:[\w/&-]+\s+){0,3}?(?:experience|exp\b)`, "gi");

  return String(text || "").replace(phrase, " experience");
}

// Describes the experience requirement for display
function requirementPhrase(required) {
  if (required.years) return `${required.years}+ years work experience`;
  if (required.looseYears) return `${required.looseYears}+ years experience`;
  if (required.hinted) return "Work experience";

  return null;
}

module.exports = { candidateYears, requiredExperience, adjustForExperience, requirementPhrase, withoutYearRequirements };
