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

