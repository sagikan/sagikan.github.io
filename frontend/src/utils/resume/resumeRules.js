// Limits and formatting for the resume form. The server checks the same limits.
export const LIMITS = {
  links: 3,
  experience: 8,
  experienceBullets: 3,
  projects: 4,
  projectBullets: 5,
  education: 3,
  skillGroups: 6,
  skillsPerGroup: 15,
  extras: 3,
  extraItems: 5,
  headline: 100,
  summary: 600,
  bullet: 250,
  roles: 5,
  locations: 3
};
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function titleCase(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (match, separator, letter) => separator + letter.toUpperCase());
}

export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 15);
}

export function parseMonth(value) {
  const text = String(value ?? "").trim();

  if (/^(present|current|now|today)$/i.test(text)) {
    return { present: true, month: -1, year: "" };
  }

  const year = text.match(/\b(19|20)\d{2}\b/)?.[0] || "";
  let month = MONTHS.findIndex((name) => new RegExp(`\\b${name}`, "i").test(text));

  if (month === -1) {
    const numeric = text.match(/^(\d{1,2})[/.-](\d{4})$/) || text.match(/^\d{4}[/.-](\d{1,2})$/);
    const number = numeric ? Number(numeric[1]) : NaN;
    month = number >= 1 && number <= 12 ? number - 1 : -1;
  }

  return { present: false, month, year };
}

export function formatMonth({ present, month, year }) {
  if (present) {
    return "Present";
  }

  return [month >= 0 ? MONTHS[month] : "", year].filter(Boolean).join(" ");
}

function isFullMonth(value, allowPresent, monthOptional = false) {
  const parsed = parseMonth(value);
  return (allowPresent && parsed.present) || ((monthOptional || parsed.month >= 0) && Boolean(parsed.year));
}

function monthNumber(value) {
  const parsed = parseMonth(value);
  return parsed.present ? Infinity : Number(parsed.year) * 12 + parsed.month;
}

const filled = (value) => String(value ?? "").trim() !== "";

const bulletText = (item) => (typeof item === "string" ? item : item.text);

export function resumeProblems(cv) {
  const problems = [];
  const over = (count, max, what) => count > max && problems.push(`${what}: ${count} of ${max} allowed. Remove ${count - max}.`);

  if (!filled(cv.name)) problems.push("Add your name.");
  if (!filled(cv.email)) problems.push("Add your email.");

  over(cv.links.filter((link) => filled(link.url)).length, LIMITS.links, "Links");
  over(cv.experience.length, LIMITS.experience, "Experience entries");
  over(cv.projects.length, LIMITS.projects, "Projects");
  over(cv.education.length, LIMITS.education, "Education entries");
  over(cv.skills.length, LIMITS.skillGroups, "Skill groups");
  over(cv.extras.length, LIMITS.extras, "Other sections");

  if (cv.summary.length > LIMITS.summary) {
    problems.push(`The summary is ${cv.summary.length} characters long. Keep it to ${LIMITS.summary}.`);
  }

  cv.experience.forEach((entry, index) => {
    const name = entry.title || entry.company || `Experience ${index + 1}`;

    if (!filled(entry.title) || !filled(entry.company)) problems.push(`${name}: add a title and a company.`);
    if (!isFullMonth(entry.start, false)) problems.push(`${name}: choose a start month and year.`);
    if (!isFullMonth(entry.end, true)) problems.push(`${name}: choose an end month and year, or Present.`);
    if (isFullMonth(entry.start, false) && isFullMonth(entry.end, true) && monthNumber(entry.end) < monthNumber(entry.start)) {
      problems.push(`${name}: the end date is before the start date.`);
    }

    over(entry.bullets.filter((item) => filled(bulletText(item))).length, LIMITS.experienceBullets, `${name} bullets`);
  });

  cv.projects.forEach((entry, index) => {
    const name = entry.name || `Project ${index + 1}`;
    const hasStart = filled(entry.start);
    const hasEnd = filled(entry.end);

    if (!filled(entry.name)) problems.push(`Project ${index + 1}: add a name.`);
    if ((hasStart && !isFullMonth(entry.start, false)) || (hasEnd && !isFullMonth(entry.end, true))) {
      problems.push(`${name}: choose both a month and a year for its dates.`);
    } else if (hasEnd && !hasStart) {
      problems.push(`${name}: add a start date too, or clear the end date.`);
    } else if (hasStart && hasEnd && monthNumber(entry.end) < monthNumber(entry.start)) {
      problems.push(`${name}: the end date is before the start date.`);
    }

    over(entry.bullets.filter((item) => filled(bulletText(item))).length, LIMITS.projectBullets, `${entry.name || `Project ${index + 1}`} bullets`);
  });

  cv.education.forEach((entry, index) => {
    const name = entry.degree || entry.school || `Education ${index + 1}`;
    if (!filled(entry.degree) || !filled(entry.school)) problems.push(`${name}: add a degree and a school.`);
    if (!isFullMonth(entry.start, false, true)) problems.push(`${name}: choose a start year.`);
    if (!isFullMonth(entry.end, true, true)) problems.push(`${name}: choose an end year, or Present.`);
  });

  cv.skills.forEach((group, index) => {
    over(group.items.filter(filled).length, LIMITS.skillsPerGroup, `Skill group ${group.category || index + 1}`);
  });

  cv.extras.forEach((group, index) => {
    over(group.items.filter(filled).length, LIMITS.extraItems, `${group.title || `Section ${index + 1}`} items`);
  });

  return problems;
}

export function isEntryComplete(section, entry) {
  const hasStart = filled(entry.start);
  const hasEnd = filled(entry.end);
  const bulletCount = (entry.bullets || []).filter((item) => filled(bulletText(item))).length;

  if (section === "experience") {
    return filled(entry.title) && filled(entry.company) &&
      isFullMonth(entry.start, false) && isFullMonth(entry.end, true) &&
      monthNumber(entry.end) >= monthNumber(entry.start) &&
      bulletCount <= LIMITS.experienceBullets;
  }

  if (section === "projects") {
    return filled(entry.name) &&
      (!hasStart || isFullMonth(entry.start, false)) &&
      (!hasEnd || (hasStart && isFullMonth(entry.end, true) && monthNumber(entry.end) >= monthNumber(entry.start))) &&
      bulletCount <= LIMITS.projectBullets;
  }

  if (section === "education") {
    return filled(entry.degree) && filled(entry.school) &&
      isFullMonth(entry.start, false, true) && isFullMonth(entry.end, true, true);
  }

  return true;
}

export function formatResume(cv) {
  return {
    ...cv,
    name: titleCase(cv.name).trim(),
    phone: digitsOnly(cv.phone),
    links: cv.links.filter((link) => filled(link.url)),
    projects: cv.projects.map(({ stack, ...entry }) => ({
      ...entry,
      name: filled(stack) && !entry.name.includes(stack) ? `${entry.name} | ${stack}` : entry.name
    })),
    education: cv.education.map((entry) => ({ ...entry, school: titleCase(entry.school).trim() }))
  };
}
