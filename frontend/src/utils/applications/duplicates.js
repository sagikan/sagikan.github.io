import { jobDay, localISO } from "../../lib/api";

const SUGGESTING_FIELDS = ["position", "company", "applied_at"];

// Trims and lowercases text for comparison
const normalize = (text) => text.trim().toLowerCase();

// Finds the most recent application for the same position and company, only on or before a day when one is given
export function findLatestDuplicate(applications, { position, company, day, excludeId }) {
  const wantedPosition = normalize(position);
  const wantedCompany = normalize(company);

  if (!wantedPosition || !wantedCompany) {
    return null;
  }

  return applications
    .filter((other) =>
      other.id !== excludeId &&
      normalize(other.position) === wantedPosition &&
      normalize(other.company) === wantedCompany &&
      (!day || jobDay(other) <= day)
    )
    .sort((a, b) => jobDay(b).localeCompare(jobDay(a)))[0] || null;
}

// Writes a day (YYYY-MM-DD) like "Oct 10th", adding the year when it isn't this year
export function ordinalDate(day, now = new Date()) {
  const date = new Date(`${day}T00:00:00`);
  const number = date.getDate();
  const suffix = number % 100 >= 11 && number % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th";
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const year = date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`;

  return `${month} ${number}${suffix}${year}`;
}

// Writes the note for a new application from the latest application for the same position and company
export function duplicateNote(duplicate) {
  const line = `${duplicate.status === "Rejected" ? "Rejected" : "Applied"} on ${ordinalDate(jobDay(duplicate))}`;

  return duplicate.job_url ? `${line}: ${duplicate.job_url}` : line;
}

/* Returns the form values with the note filled from the latest duplicate, unless the user wrote their own note
   or the changed field is not one that decides the duplicate */
export function withSuggestedNote(previous, next, field, applications, excludeId) {
  if (field && !SUGGESTING_FIELDS.includes(field)) {
    return next;
  }

  if (previous.notes !== previous.autoNote) {
    return next;
  }

  const duplicate = findLatestDuplicate(applications, {
    position: next.position,
    company: next.company,
    day: next.applied_at || localISO(new Date()),
    excludeId
  });
  const suggestion = duplicate ? duplicateNote(duplicate) : "";

  return { ...next, notes: suggestion, autoNote: suggestion };
}
