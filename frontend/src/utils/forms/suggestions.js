const MAX_SUGGESTIONS = 100;

// Trims and lowercases text for comparison
function keyOf(value) {
  return String(value ?? "").trim().toLowerCase();
}

// Sorts items so the most recently added come first
function newestFirst(items) {
  return [...items].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

// Lists the distinct values of a field, most used first, in their latest spelling
export function suggestionsFor(items, field) {
  const byKey = new Map();

  for (const item of newestFirst(items)) {
    const value = String(item[field] ?? "").trim();
    const key = keyOf(value);
    if (!key) continue;
    const entry = byKey.get(key);

    if (entry) entry.count++;
    else byKey.set(key, { value, count: 1 });
  }

  return [...byKey.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.value);
}

// Returns the location last used with a company, or an empty string
export function lastLocationFor(items, company) {
  const key = keyOf(company);
  if (!key) return "";
  const match = newestFirst(items).find((item) => keyOf(item.company) === key && keyOf(item.location));

  return match ? match.location.trim() : "";
}
