/* Limits and formatting for the resume form. The server checks the same counts, but its text limits
   are looser so a resume read from a PDF isn't cut: the form asks to shorten anything longer */
export const LIMITS = {
  links: 3,
  experience: 10,
  experienceBullets: 3,
  projects: 5,
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
  locations: 3,
  name: 50,
  text: 100,
  groupName: 50,
  link: 500,
  phone: 15,
  projectName: 150,
  gpa: 10,
  skill: 50,
  preference: 60
};
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ENTRY_LABELS = { experience: "Experience", projects: "Project", education: "Education" };
const ENTRY_NAMES = {
  experience: (entry) => entry.title || entry.company,
  projects: (entry) => entry.name,
  education: (entry) => entry.degree || entry.school
};

// Capitalizes the first letter of each word
export function titleCase(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (match, separator, letter) => separator + letter.toUpperCase());
}

// Keeps only digits, up to 15
export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, LIMITS.phone);
}

// Splits a resume date into month and year
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

// Turns a month and year into a resume date
export function formatMonth({ present, month, year }) {
  if (present) {
    return "Present";
  }

  return [month >= 0 ? MONTHS[month] : "", year].filter(Boolean).join(" ");
}

// Checks whether a date is complete
function isFullMonth(value, allowPresent, monthOptional = false) {
  const parsed = parseMonth(value);

  return (allowPresent && parsed.present) || ((monthOptional || parsed.month >= 0) && Boolean(parsed.year));
}

// Turns a date into a sortable month number
function monthNumber(value) {
  const parsed = parseMonth(value);

  return parsed.present ? Infinity : Number(parsed.year) * 12 + parsed.month;
}

// Turns a date into its year, with Present as the latest
function yearNumber(value) {
  const parsed = parseMonth(value);

  return parsed.present ? Infinity : Number(parsed.year);
}

// Checks whether a value isn't empty
const filled = (value) => String(value ?? "").trim() !== "";

// Returns a bullet's text
const bulletText = (item) => (typeof item === "string" ? item : item.text);

// Lists the problems that stop a resume from being saved
export function resumeProblems(cv) {
  const problems = [];

  // Adds a problem when a count is over its limit
  const over = (count, max, what) => count > max && problems.push(`${what}: ${count} of ${max} allowed. Remove ${count - max}.`);

  if (!filled(cv.name)) problems.push("Add your name.");
  if (!filled(cv.email)) problems.push("Add your email.");

  over(cv.links.filter((link) => filled(link.url)).length, LIMITS.links, "Links");
  over(cv.experience.length, LIMITS.experience, "Experience entries");
  over(cv.projects.length, LIMITS.projects, "Projects");
  over(cv.education.length, LIMITS.education, "Education entries");
  over(cv.skills.length, LIMITS.skillGroups, "Skill groups");
  over(cv.extras.length, LIMITS.extras, "Other sections");

  // Adds a problem when a text is longer than its limit
  const tooLong = (value, max, what) => {
    const length = String(value ?? "").length;
    if (length > max) problems.push(`${what} is ${length} characters long. Keep it to ${max}.`);
  };

  tooLong(cv.name, LIMITS.name, "Your name");
  tooLong(cv.email, LIMITS.text, "Your email");
  tooLong(cv.location, LIMITS.text, "Your location");
  tooLong(cv.headline, LIMITS.headline, "The headline");
  cv.links.forEach((link, index) => tooLong(link.url, LIMITS.link, `Link ${index + 1}`));

  if (cv.summary.length > LIMITS.summary) {
    problems.push(`The summary is ${cv.summary.length} characters long. Keep it to ${LIMITS.summary}.`);
  }

  for (const section of ["experience", "projects", "education"]) {
    cv[section].forEach((entry, index) => {
      const name = ENTRY_NAMES[section](entry) || `${ENTRY_LABELS[section]} ${index + 1}`;

      entryIssues(section, entry).forEach((issue) => problems.push(`${name}: ${issue.text}.`));
    });
  }

  cv.skills.forEach((group, index) => {
    const name = `Skill group ${group.category || index + 1}`;

    over(group.items.filter(filled).length, LIMITS.skillsPerGroup, name);
    tooLong(group.category, LIMITS.groupName, `${name}'s name`);
    group.items.forEach((skill) => tooLong(skill, LIMITS.skill, `The skill "${skill.slice(0, 30)}…"`));
  });

  cv.extras.forEach((group, index) => {
    const name = group.title || `Section ${index + 1}`;

    over(group.items.filter(filled).length, LIMITS.extraItems, `${name} items`);
    tooLong(group.title, LIMITS.groupName, `${name}'s title`);
    group.items.forEach((item, itemIndex) => tooLong(item, LIMITS.bullet, `${name} item ${itemIndex + 1}`));
  });

  return problems;
}

// Lists what's wrong with an entry: the parts it affects and a short lowercase phrase
export function entryIssues(section, entry) {
  const issues = [];
  const hasStart = filled(entry.start);
  const hasEnd = filled(entry.end);
  const bulletCount = (entry.bullets || []).filter((item) => filled(bulletText(item))).length;

  // Asks for whichever of the two required fields are empty
  const requireFields = (first, second) => {
    const missing = [first, second].filter(([field]) => !filled(entry[field]));
    if (missing.length) issues.push({ parts: missing.map(([field]) => field), text: `add ${missing.map(([, label]) => label).join(" and ")}` });
  };

  // Asks to remove the bullets over the limit and to shorten long ones
  const limitBullets = (max) => {
    const extra = bulletCount - max;
    if (extra > 0) issues.push({ parts: ["bullets"], text: `remove ${extra} bullet${extra === 1 ? "" : "s"} (${max} max)` });

    (entry.bullets || []).forEach((item, index) => {
      if (bulletText(item).length > LIMITS.bullet) issues.push({ parts: ["bullets"], text: `shorten bullet ${index + 1} to ${LIMITS.bullet} characters` });
    });
  };

  // Asks to shorten each field that's longer than its limit
  const limitText = (fields) => {
    for (const [field, part, max = LIMITS.text] of fields) {
      if (String(entry[field] ?? "").length > max) issues.push({ parts: [part], text: `shorten the ${part} to ${max} characters` });
    }
  };

  if (section === "experience") {
    requireFields(["title", "a title"], ["company", "a company"]);
    limitText([["title", "title"], ["company", "company"], ["location", "location"]]);

    if (!isFullMonth(entry.start, false)) issues.push({ parts: ["dates"], text: "choose a start month and year" });

    if (!isFullMonth(entry.end, true)) {
      issues.push({ parts: ["dates"], text: "choose an end month and year, or Present" });
    } else if (isFullMonth(entry.start, false) && monthNumber(entry.end) < monthNumber(entry.start)) {
      issues.push({ parts: ["dates"], text: "the end date is before the start date" });
    }

    limitBullets(LIMITS.experienceBullets);
  } else if (section === "projects") {
    if (!filled(entry.name)) issues.push({ parts: ["name"], text: "add a name" });
    limitText([["name", "name", LIMITS.projectName], ["link", "link", LIMITS.link]]);

    if ((hasStart && !isFullMonth(entry.start, false)) || (hasEnd && !isFullMonth(entry.end, true))) {
      issues.push({ parts: ["dates"], text: "choose both a month and a year for its dates" });
    } else if (hasEnd && !hasStart) {
      issues.push({ parts: ["dates"], text: "add a start date too, or clear the end date" });
    } else if (hasStart && hasEnd && monthNumber(entry.end) < monthNumber(entry.start)) {
      issues.push({ parts: ["dates"], text: "the end date is before the start date" });
    }

    limitBullets(LIMITS.projectBullets);
  } else if (section === "education") {
    requireFields(["degree", "a degree"], ["school", "a school"]);
    limitText([["degree", "degree"], ["major", "major"], ["school", "school"], ["location", "location"], ["gpa", "GPA", LIMITS.gpa]]);

    if (!isFullMonth(entry.start, false, true)) issues.push({ parts: ["dates"], text: "choose a start year" });

    if (!isFullMonth(entry.end, true, true)) {
      issues.push({ parts: ["dates"], text: "choose an end year, or Present" });
    } else if (isFullMonth(entry.start, false, true) && yearNumber(entry.end) < yearNumber(entry.start)) {
      issues.push({ parts: ["dates"], text: "the end year is before the start year" });
    }
  } else if (section === "extras") {
    const items = entry.items || [];
    const extra = items.filter(filled).length - LIMITS.extraItems;

    limitText([["title", "title", LIMITS.groupName]]);
    if (extra > 0) issues.push({ parts: ["items"], text: `remove ${extra} item${extra === 1 ? "" : "s"} (${LIMITS.extraItems} max)` });

    items.forEach((item, index) => {
      if (item.length > LIMITS.bullet) issues.push({ parts: ["items"], text: `shorten item ${index + 1} to ${LIMITS.bullet} characters` });
    });
  }

  return issues;
}

// Cleans a resume's fields for the editor
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
    education: cv.education.map((entry) => ({ ...entry, school: titleCase(entry.school).trim() })),
    extras: cv.extras.map((group, index) => ({ ...group, id: group.id || `s${index + 1}` }))
  };
}
