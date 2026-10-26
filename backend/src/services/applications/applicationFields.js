const APPLICATION_FIELDS = `
  id, company, position, location, workplace_model, status, job_url, notes,
  TO_CHAR(applied_at, 'YYYY-MM-DD') AS applied_at, created_at,
  (
    SELECT jobs.id FROM jobs
    JOIN cv_tailorings ON cv_tailorings.job_id = jobs.id
    WHERE jobs.application_id = applications.id
    LIMIT 1
  ) AS cv_job_id
`;
const STATUSES = ["Applied", "Interview", "Offer", "Rejected", "Withdrawn"];
const WORKPLACE_MODELS = ["On-site", "Hybrid", "Remote"];
const MAX_APPLICATIONS = 5000;
const MAX_LENGTH = { company: 200, position: 200, location: 200, job_url: 500, notes: 5000 };

// Checks whether a value is an http(s) URL
function isWebUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// Checks whether a value is a real YYYY-MM-DD date between 1970 and 2100
function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) && value >= "1970-01-01" && value <= "2100-12-31";
}

// Returns an error message if a field's value is invalid
function checkApplicationField(field, value) {
  switch (field) {
    case "company":
    case "position":
    case "location":
      if (typeof value !== "string" || !value.trim()) return `${field} must be a non-empty string.`;
      if (value.length > MAX_LENGTH[field]) return `${field} can be at most ${MAX_LENGTH[field]} characters.`;

      return null;
    case "status":
      return STATUSES.includes(value) ? null : "Invalid status.";
    case "workplace_model":
      return value === null || WORKPLACE_MODELS.includes(value) ? null : "Invalid workplace model.";
    case "job_url":
      if (value === null) return null;
      if (typeof value !== "string" || value.length > MAX_LENGTH.job_url) return `The link can be at most ${MAX_LENGTH.job_url} characters.`;

      return isWebUrl(value) ? null : "The link must start with http:// or https://.";
    case "notes":
      if (value === null) return null;
      if (typeof value !== "string") return "notes must be a string or null.";

      return value.length > MAX_LENGTH.notes ? `Notes can be at most ${MAX_LENGTH.notes} characters.` : null;
    case "applied_at":
      return value === null || isCalendarDate(value) ? null : "applied_at must be a real date in YYYY-MM-DD format or null.";
    default:
      return `${field} cannot be updated.`;
  }
}

module.exports = { APPLICATION_FIELDS, STATUSES, WORKPLACE_MODELS, MAX_APPLICATIONS, checkApplicationField, isWebUrl, isCalendarDate };
