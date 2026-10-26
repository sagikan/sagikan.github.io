export const PIN_ICON = (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <path d="M10 17.5s5.5-4.9 5.5-9.25a5.5 5.5 0 0 0-11 0C4.5 12.6 10 17.5 10 17.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <circle cx="10" cy="8.25" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);
export const CALENDAR_ICON = (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <rect x="3.5" y="4.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M3.5 8.5h13M7 2.75v3.5M13 2.75v3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);
export const EXTERNAL_ICON = (
  <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
    <path d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Turns a match score into a level
export function scoreLevel(score) {
  if (score >= 70) return "high";
  if (score >= 45) return "mid";

  return "low";
}

// Describes how long ago a job was posted
export function postingAge(postedAt) {
  const posted = new Date(`${String(postedAt).slice(0, 10)}T00:00:00`);
  const days = Math.max(0, Math.floor((Date.now() - posted.getTime()) / 86_400_000));
  const level = days <= 7 ? "fresh" : days <= 30 ? "aging" : "stale";
  const ago = days === 0 ? "today"
    : days === 1 ? "yesterday"
      : days < 14 ? `${days} days ago`
        : days < 60 ? `${Math.round(days / 7)} weeks ago`
          : `${Math.round(days / 30)} months ago`;

  return { level, label: `Posted ${ago}` };
}

