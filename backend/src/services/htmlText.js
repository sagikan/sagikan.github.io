const ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•"
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const number = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
    }

    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function htmlToText(html) {
  let text = String(html ?? "");

  // Greenhouse sends its HTML escaped ("&lt;p&gt;"), so unescape it once before reading the tags.
  if (/&lt;\/?[a-z]/i.test(text)) {
    text = decodeEntities(text);
  }

  return decodeEntities(
    text
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|ul|ol|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { htmlToText };
