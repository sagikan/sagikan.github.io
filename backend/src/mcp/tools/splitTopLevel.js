// Splits text on commas that are outside brackets and quotes
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = "";

  for (const char of text) {
    if (quote) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if ("([{".includes(char)) {
      depth += 1;
    } else if (")]}".includes(char)) {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current.trim());

  return parts.filter(Boolean);
}

module.exports = { splitTopLevel };
