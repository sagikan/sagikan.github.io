// Returns a privacy policy version if it is a real date written as YYYY-MM-DD, or null
function readPolicyVersion(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : null;
}

module.exports = { readPolicyVersion };
