/* The fixed sections every description is sorted into, in the order they show. A heading is matched against the
   patterns in MATCH_ORDER, which checks the narrow sections first ("preferred qualifications" is a nice to have, not a
   requirement; "what you'll get" is a benefit, not a duty) */
const SECTIONS = [
  { key: "role", title: "About the role", tab: "Role" },
  { key: "duties", title: "What you'll do", tab: "Duties" },
  { key: "requirements", title: "What you'll need", tab: "Requirements" },
  { key: "bonus", title: "Nice to have", tab: "Bonus" },
  { key: "benefits", title: "What they offer", tab: "Perks" },
  { key: "company", title: "About the company", tab: "Company" },
  { key: "more", title: "More details", tab: "More" }
];
// Hebrew words have no \b boundaries in JavaScript, so each pattern lists them after its English part
const PATTERNS = {
  bonus: /\b(nice[ -]to[ -](haves?|know)|^bonus|bonus points|preferred|optional|advantages?|advantageous|a plus|(big )?pluses|plus points?|extra points|(good|great) to have|would (also )?be (great|nice)|desired|not required|will also have|stand out|excel if)\b|יתרון|יתרונות|מועדפ|מועדף/,
  benefits: /\b(benefits?|perks|extras|what we offer|we offer|our offer|why (join|us|work)|should join|what'?s in it for you|what you('ll| will) (get|gain)|compensation|salary|pay( range)?|you('ll| will) love|^joining)\b|^why [\w.&'-]+( [\w.&'-]+)?\??$|הטבות|מה אנחנו מציעים|מה מחכה לך|שתקבל/,
  more: /\b(equal (employment )?opportunit\w*|eeo|diversity|inclusion|our commitment|how to apply|next steps?|additional information|good to know|privacy|accommodations?|disclaimer|fraud\w*|background checks?|recruiting outreach|hiring process|interview process|location|where you('ll| will) be|work model|hybrid policy|follow us|job posting end date|employee status|employment type|position (type|email|details)|job (category|type)|relocation|referral|visa sponsorship|travel requirements|export control|hazardous material\w*|^shift|work arrangements?)\b/,
  requirements: /\b(requirements?|qualifications?|who you are|who are you|about you|you have|(will )?you bring|you('ll| will) (need|bring|have)|what (you|we) need|all you need|(what )?we('re| are) looking for|looking for|must[ -]haves?|^must$|^required$|skills|experience|education|what it takes|is this you|you are|your (profile|background)|ideal (candidate|applicant)s?|perfect (job|fit) for|right fit|cultural fit|be a fit|fit if|expectations|we expect|expect from you|you need|you should (have|know|bring)|you('ve| have) done|you('ll| will) thrive|thrive (at|in)|(love|like) to see|(to be |be )?successful|to (succeed|thrive)|someone who|qualities|characteristics|attributes|competenc\w*|knowledge|for you if|do it using)\b|דרישות|כישורים|נדרש|מה אנחנו מחפשים|אנחנו מחפשים|שאנחנו מבקשים|למי זה מתאים|תצטרך|תצטרכ/,
  // "About" names the company only with a name or "us" ("About Acme"); "About the …" is about the role
  company: /\b(about (us|the (company|team)|(?!(the|this|a|an|our|your)\b)[\p{L}\p{N}][\w.&' -]*)|who we are|who are we|this is us|who [\p{L}\p{N}][\w.&'-]* (is|are)$|our (story|mission|company|team|culture|values|vision)|company (overview|description)|^company$|^(meet |join )?the (company|team)$|life (at|as)|why we exist)\b|על החברה|אודות|מי אנחנו/u,
  duties: /\b(responsibilit\w*|responsible for|duties|essential functions|will involve|day[ -]to[ -]day|typical day|success looks like|what you('ll| will)( be)? (do|doing|work on)|what will you( be)? (do|doing)|what will your job look like|you('ll| will)|your (role|mission|impact|day|tasks)|in this role|(role|position|job) includes|excel by|key accountabilities|what the job involves)\b|במסגרת התפקיד|תחומי אחריות|התפקיד כולל|כולל התפקיד|יום בחיי|משימות|שתעשה|תעשה/,
  role: /\b(about (the|this) (role|position|job|opportunity)|^about (the|this) |the (role|position|job|opportunity)|(role|job|position) (overview|description|summary|intro)|job definition|overview|summary|description|introduction|the challenge)\b|תיאור (ה)?(תפקיד|משרה)|על התפקיד/
};
const MATCH_ORDER = ["bonus", "benefits", "more", "requirements", "company", "duties", "role"];
// Headings common enough to trust even when written in lowercase with no colon
const COMMON_HEADING = /^((the )?(role|position|job) includes|((key|main|your|basic|minimum|preferred|required|primary) )?((job|role) )?(responsibilities|requirements|qualifications|duties|skills( and experience)?|benefits|perks)|about (us|you|the (role|position|job|team|company))|the (role|position|job|team|company|opportunity)|what (you('ll| will) (do|need|bring|get)|we offer|we('re| are) looking for)|who (you are|we are)|you (have|are|bring|will)|nice to haves?|must haves?|key responsibilities|pay range|why join us|bonus points|equal opportunity|במסגרת התפקיד|תחומי אחריות|דרישות( התפקיד)?|תיאור (ה)?(תפקיד|משרה)|על החברה|מי אנחנו|הטבות)$/;
// A heading put as a question without its mark ("What you will be responsible for"), which list items rarely are
const QUESTION_HEADING = /^(what|who|why|where|how) /;
/* How headings open ("The ideal candidate will have", "Required experience", "Key skills"), unlike list items, which
   open with a verb or an adjective ("Build great developer experience", "Strong skills"). A line trusted for where it
   stands rather than how it's written must open like this */
const HEADING_OPENER = /^(the|a|an|what|who|why|how|where|our|your|key|main|core|required|preferred|minimum|basic|ideal|additional|you|we|to|in|as|nice|bonus|about|job|role|position|technical|personal|professional)\b/;
// A negated heading ("What you will not do", "This role is not for you if") names the opposite of its section
const NEGATED = /\b(will not|won't|not for you|isn't for you|don't|do not|never)\b/;
const GENERIC_LABEL = /^((key |main )?(responsibilities|requirements|qualifications|duties)|advantages?|nice to haves?|bonus|benefits|perks|overview|summary|(job |role )?description|about (us|the role))$/;
const LIST_SECTIONS = new Set(["duties", "requirements", "bonus", "benefits"]);
/* A bullet glyph (Word's "o" among them) or number before a space, or a hyphen, asterisk or dot set right against a word
   ("*Excel", "-Python") */
const BULLET = /^(?:(?:[-*•●▪◦·–—►▶✓✔➢➤→o]|\d{1,2}[.)])\s+|[-*•●▪◦](?=\p{L}))/u;
const BOILERPLATE = /equal (employment )?opportunit|without regard to|regardless of (race|gender|age|religion)|reasonable accommodation|if you have a disability|privacy (policy|notice)|diverse backgrounds|requisition number/i;
// A requirement marked as optional, as in "Kafka - advantage", "Go is a plus" or "תואר מתקדם – יתרון"
const ADVANTAGE = /(\s*[-–—(,:]\s*|\s)((is|are|will be|would be) )?(an? )?((big|huge|great|strong) )?(advantage|plus)\)?[.!]?$|יתרון\)?\.?$/i;
// A requirement marked as a must, as in "C++ - Must", "Python (mandatory)" or "ניסיון בפיתוח – חובה"
const MANDATORY = /(\s*[-–—(,:]\s*)(a )?(must|mandatory|required)\)?[.!]?$|\s(is )?a must[.!]?$|חובה\)?\.?$/i;
const RECRUITING = /\b(looking for|seeking|hiring|join)\b/i;
// Buttons, empty values, social links and lines of hashtags (#LI-Hybrid, #NI-LI1) that job boards leave in a description
const SKIPPED = /^((hit )?apply( now| here| for this (job|position|role))?!?|share( this job)?|back to (all )?jobs|save job|null|none|learn more|facebook|instagram|linkedin( life page)?|twitter|youtube|(#[\w-]+\s*)+)$/i;
const HEADING_CHARS = 70;
const HEADING_WORDS = 9;
// A line ending as headings do: a colon, a question mark ("What will you bring to the table?") or an ellipsis
const HEADING_END = /(:|\?|…|\.\.\.)$/;
// Such a line may run longer and still be a heading ("To be a Developer Support Engineer at JFrog you need…")
const MARKED_HEADING_WORDS = 12;
const LONE_HEADING_WORDS = 5;
// A line ending in one of these breaks off mid-sentence, so the next line continues it
const UNFINISHED = /([,(/&-]|\b(and|or|of|the|a|an|to|for|with|in|on|by|as|at|from|into|like|such as|e\.g\.|i\.e\.|including|via|across|our|your|their|its|is|are|be))$/i;
const SUBHEADING_CHARS = 50;
const LABEL_WORDS = 6;
const LABEL_PROSE_CHARS = 80;

// Lowercases a heading and strips its decoration, so patterns can match it
function headingKey(line) {
  return line
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})?!]+$/gu, "")
    .replace(/\s+/g, " ");
}

// Finds which section a heading names, or null when none fits
export function sectionFor(heading) {
  const key = headingKey(heading);

  if (!key || NEGATED.test(key)) {
    return null;
  }

  return MATCH_ORDER.find((section) => PATTERNS[section].test(key)) ?? null;
}

// Tells whether a line is short enough, and shaped like, a heading rather than a sentence
function headingShaped(line) {
  const words = line.split(/\s+/).length;
  const marked = HEADING_END.test(line);

  return line.length <= HEADING_CHARS && words <= (marked ? MARKED_HEADING_WORDS : HEADING_WORDS) && !BULLET.test(line) &&
    (marked || !/[.,;]$/.test(line));
}

// Tells whether a line is written in capitals, as headings often are
function shouting(line) {
  return /[A-Z]/.test(line) && line === line.toUpperCase();
}

/* Tells whether every longer word of a line starts with a capital, as in "What You'll Bring". A line in a script
   without capitals, such as Hebrew, fails, so its headings need a colon */
function titleCase(line) {
  // A note in parentheses, as in "Qualifications (must)", doesn't count
  const words = line.replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\s'-]/gu, " ").split(/\s+/).filter(Boolean);

  return words.length > 0 && /^\p{Lu}/u.test(words[0]) && words.every((word) => word.length < 4 || /^\p{Lu}/u.test(word));
}

/* Finds the section a line opens, if it reads as that section's heading. A line that only mentions a section's words
   ("Experience with AWS", "Competitive salary") is content, so a heading must end in a colon, be in capitals or title
   case, be one word, be a common heading, or stand where only a heading would (placed: a bullet alone between plain
   lines, as some postings bullet their headings, or a plain line right before a list, as in "The ideal candidate will
   have"); and it may not hold numbers. A heading for the section already open without a colon or capitals is a list
   item that happens to use its words */
function knownSection(line, current, placed = false) {
  const section = sectionFor(line);

  if (!section || /\d/.test(line)) {
    return null;
  }

  const colon = HEADING_END.test(line);
  const key = headingKey(line);

  if (section === current && !colon && !shouting(line)) {
    return null;
  }

  const trusted = (placed && HEADING_OPENER.test(key)) || colon || shouting(line) || titleCase(line) || !key.includes(" ");

  return trusted || COMMON_HEADING.test(key) || QUESTION_HEADING.test(key) ? section : null;
}

/* Reads a line as a heading: a known section, an unknown subheading, or not a heading at all. A lone bullet is only an
   unknown subheading with a colon, and a line that leads a list counts as placed where a heading would be */
function readHeading(line, current, { lone = false, leadsList = false } = {}) {
  if (!headingShaped(line)) {
    return null;
  }

  const section = knownSection(line, current, lone || leadsList);
  const label = line.replace(/\s*([:\-–—…]|\.\.\.)+$/, "").trim();

  if (section) {
    return { section, label };
  }

  // A single word in capitals is more often an item ("SQL", "AWS") than a heading
  const capsHeading = !lone && shouting(line) && /\s/.test(label);

  if (line.length <= SUBHEADING_CHARS && (line.endsWith(":") || capsHeading)) {
    return { section: null, label };
  }

  return null;
}

/* Reads a line that opens a section with a label, as in "Requirements: 3+ years of Go". The text after the label stays
   as content, with the label too unless it only repeats the section's title ("Location: Tel Aviv" keeps it) */
function inlineHeading(line, current) {
  const match = line.match(/^([^:]{3,40}):\s+(\S.*)$/);

  if (!match || BULLET.test(line) || !headingShaped(match[1].trim())) {
    return null;
  }

  const section = knownSection(`${match[1].trim()}:`, current);

  if (!section || section === current) {
    return null;
  }

  return { section, text: GENERIC_LABEL.test(headingKey(match[1])) ? match[2] : line };
}

// Puts each bullet and each heading of a run-on description on its own line
function breakLines(text) {
  // Numeric entities that a feed left undecoded ("&#xa;") become their characters
  const decoded = text.replace(/&#(x[0-9a-f]+|\d+);?/gi, (match, code) => {
    const number = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);

    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
  });
  const plain = decoded.replace(/\r\n?/g, "\n").replace(/\ufeff/g, "").replace(/[\u00a0\u2007\u202f\t]/g, " ");
  const runOn = plain.split("\n").length <= 3;
  const split = runOn ? plain.replace(/([.!?])\s+(?=[A-Z][^.!?:\n]{2,38}:\s)/g, "$1\n") : plain;
  // A heading glued to the sentence before it ("…the hiring process.Minimum qualifications:") gets its own line
  const unglued = split.replace(/([a-z][.!?])(?=[A-Z][^.!?:\n]{2,38}:[ \t]*$)/gm, "$1\n");

  return unglued.replace(/\s*[•●▪◦]\s*/g, "\n- ");
}

// Cleans a list item or paragraph: no bullet glyph, single spaces and no trailing separator
function tidy(text) {
  return text.replace(BULLET, "").replace(/\s+/g, " ").replace(/\s*[;,]$/, "").trim();
}

// Adds a line to a section's blocks, joining lines that a hard wrap cut in the middle of a sentence
function addLine(blocks, line) {
  const last = blocks[blocks.length - 1];
  const bullet = BULLET.test(line);
  const before = last?.type === "list" ? last.items[last.items.length - 1] : last?.text ?? "";
  const continues = !bullet && last && last.type !== "subheading" && (/^[a-z(]/.test(line) || UNFINISHED.test(before));

  if (continues && last.type === "list") {
    last.items[last.items.length - 1] += ` ${line}`;

    return;
  }

  if (continues && last.type === "paragraph" && !/[.!?:]$/.test(last.text)) {
    last.text += ` ${line}`;

    return;
  }

  if (bullet && last?.type === "list") {
    last.items.push(line);

    return;
  }

  blocks.push(bullet ? { type: "list", items: [line] } : { type: "paragraph", text: line });
}

// Gives a paragraph's or subheading's text as written, a subheading getting back the colon trimmed off its label
function headingText(block) {
  return `${tidy(block.text)}${block.type === "subheading" ? ":" : ""}`;
}

/* Tells whether a line only restates its section's heading, as "What we're looking for" does under requirements. A
   title case line ("Technical Skills") counts only when a list follows it, since items such as "Competitive Salary"
   are title case too */
function restates(text, key, beforeList) {
  if (!headingShaped(text) || /\d/.test(text) || sectionFor(text) !== key) {
    return false;
  }

  const heading = headingKey(text);
  const marked = HEADING_END.test(text) || shouting(text) || !heading.includes(" ");

  return marked || COMMON_HEADING.test(heading) || QUESTION_HEADING.test(heading) || (beforeList && titleCase(text));
}

/* Shapes a list section as bullets: every plain line becomes one, since many postings drop the bullets, and lines that
   only restate the section's heading go. A lead-in ending in a colon stays as text */
function listify(blocks, key) {
  const result = [];

  for (const [index, block] of blocks.entries()) {
    const text = block.type === "list" ? "" : headingText(block);

    if (block.type !== "list" && restates(text, key, blocks[index + 1]?.type === "list")) {
      continue;
    }

    if (block.type === "paragraph" && !text.endsWith(":")) {
      result.push({ type: "list", items: [block.text] });
    } else {
      result.push(block);
    }
  }

  return result;
}

/* Tells whether a plain line is a label over what follows ("Why This Role Matters" before a paragraph, "Team Building"
   before a list): short, in title case or capitals, unpunctuated, and followed by a list or by prose, not by another
   short line as items such as "Competitive Salary" are */
function isLabel(text, next) {
  const words = text.split(/\s+/).length;
  /* One word is more often an item ("Go", "Kafka"), as one-word labels such as "Benefits" are read as headings already;
     punctuation marks a sentence or a labelled fact ("Seniority: Junior") */
  const short = text.length <= SUBHEADING_CHARS && words >= 2 && words <= LABEL_WORDS && !/[.,;:!?]/.test(text);
  const leads = next?.type === "list" || (next?.type === "paragraph" && next.text.length > LABEL_PROSE_CHARS);

  return short && leads && !/\d/.test(text) && (titleCase(text) || shouting(text));
}

/* Tidies every block, turns labels into subheadings, merges lists that sit next to each other and drops what ends up
   empty, along with lines that only restate the section's heading */
function finish(raw, key) {
  const blocks = raw.map((block, index) => (block.type === "paragraph" && isLabel(tidy(block.text), raw[index + 1])
    ? { type: "subheading", text: block.text }
    : block));
  const original = (block, index) => block.type === "list" || !restates(headingText(block), key, blocks[index + 1]?.type === "list");
  const shaped = LIST_SECTIONS.has(key) ? listify(blocks, key) : blocks.filter(original);
  const result = [];

  for (const block of shaped) {
    const last = result[result.length - 1];

    if (block.type === "list") {
      const items = block.items.map(tidy).filter(Boolean);

      if (items.length && last?.type === "list") {
        last.items.push(...items);
      } else if (items.length) {
        result.push({ type: "list", items });
      }
    } else {
      const text = tidy(block.text);

      if (text) {
        result.push({ ...block, text });
      }
    }
  }

  while (result.length && result[result.length - 1].type === "subheading") {
    result.pop();
  }

  return result;
}

// Moves the lines of one section that carry a mark ("Kafka - advantage", "C++ - Must") to another section
function moveMarked(groups, from, mark, to) {
  const moved = [];
  const kept = [];

  for (const block of groups.get(from) || []) {
    if (block.type === "list") {
      moved.push(...block.items.filter((item) => mark.test(item)));
      kept.push({ ...block, items: block.items.filter((item) => !mark.test(item)) });
    } else if (block.type === "paragraph" && mark.test(block.text)) {
      moved.push(block.text);
    } else {
      kept.push(block);
    }
  }

  if (moved.length) {
    groups.set(from, kept);
    groups.set(to, [...(groups.get(to) || []), { type: "list", items: moved }]);
  }
}

// Tells whether a line describes the company by name ("Mobileye changes the way we drive"), rather than the opening
function aboutCompany(line, company) {
  const name = String(company ?? "").trim().toLowerCase();
  const text = line.toLowerCase().replace(/’/g, "'");
  const openings = [`${name} `, `${name}'s `, `at ${name}, `];

  return name.length > 1 && openings.some((opening) => text.startsWith(opening)) && !RECRUITING.test(line);
}

// Finds which way a description reads: right to left when most of its letters are Hebrew or Arabic
export function textDirection(text) {
  const plain = String(text ?? "");
  const rtl = (plain.match(/[\u0590-\u05ff\u0600-\u06ff]/g) || []).length;
  const ltr = (plain.match(/[A-Za-z]/g) || []).length;

  return rtl > ltr ? "rtl" : "ltr";
}

/* Sorts a job description into the fixed SECTIONS, each a list of blocks: { type: "paragraph", text },
   { type: "list", items } or { type: "subheading", text } for a heading that names no known section. Text before the
   first heading belongs to the role, unless a role heading comes later and no company one does: then it's the company's
   introduction. A plain line after the first heading that starts with the company's name belongs to the company */
export function parseDescription(description, position = "", company = "") {
  const lines = breakLines(String(description ?? "")).split("\n").map((line) => line.trim()).filter((line) => /[\p{L}\p{N}]/u.test(line));
  const title = headingKey(position);
  const groups = new Map();
  const intro = [];
  let current = null;

  for (const [index, line] of lines.entries()) {
    if ((index === 0 && title && headingKey(line) === title) || SKIPPED.test(line)) {
      continue;
    }

    const next = lines[index + 1] ?? "";
    const bare = line.replace(BULLET, "");
    const lone = BULLET.test(line) && !BULLET.test(lines[index - 1] ?? "") && !BULLET.test(next) && bare.split(/\s+/).length <= LONE_HEADING_WORDS;
    // A line whose sentence goes on in the next line, as in hard-wrapped text, is never a heading
    const wrapped = /^[a-z]/.test(next) && !BULLET.test(next) && !HEADING_END.test(line);
    const leadsList = !BULLET.test(line) && BULLET.test(next);
    const inline = inlineHeading(line, current);
    const heading = wrapped ? null : inline || readHeading(lone ? bare : line, current, { lone, leadsList });

    /* Legal text closing a posting has no heading of its own, so it would otherwise end up in the last section. It's
       prose, so a bullet that mentions its words ("Experience with privacy policy frameworks") stays where it is. It's
       checked before the company's lines, since it often starts with the name ("Acme is an equal opportunity employer") */
    if (!heading && !BULLET.test(line) && BOILERPLATE.test(line)) {
      groups.set("more", [...(groups.get("more") || []), { type: "paragraph", text: line }]);

      continue;
    }

    if (current && !heading && !BULLET.test(line) && aboutCompany(line, company)) {
      groups.set("company", [...(groups.get("company") || []), { type: "paragraph", text: line }]);

      continue;
    }

    // A labelled fact such as "Location: Tel Aviv" is one line, so the section around it stays open
    if (inline?.section === "more") {
      groups.set("more", [...(groups.get("more") || []), { type: "paragraph", text: inline.text }]);

      continue;
    }

    /* A nice to have heading right under a requirements heading names what the requirements are ("Qualifications" then
       "Preferred Qualifications", "Requirements" then "What Will Make You Stand Out?"), so the requirements stay open */
    if (heading?.section === "bonus" && !inline && current === "requirements" && groups.get(current).length === 0) {
      continue;
    }

    if (heading?.section) {
      current = heading.section;

      if (!groups.has(current)) {
        groups.set(current, []);
      }

      if (inline) {
        addLine(groups.get(current), inline.text);
      }

      continue;
    }

    const blocks = current ? groups.get(current) : intro;

    if (heading) {
      blocks.push({ type: "subheading", text: heading.label });
    } else {
      addLine(blocks, line);
    }
  }

  if (intro.length) {
    const introKey = groups.has("role") && !groups.has("company") ? "company" : "role";

    groups.set(introKey, [...intro, ...(groups.get(introKey) || [])]);
  }

  /* Some postings list their requirements with no heading, marking each line as a must or an advantage; those lines
     leave the role's text. Then a must listed as nice to have goes to the requirements, and an optional requirement to
     the nice to have section */
  moveMarked(groups, "role", MANDATORY, "requirements");
  moveMarked(groups, "role", ADVANTAGE, "bonus");
  moveMarked(groups, "bonus", MANDATORY, "requirements");
  moveMarked(groups, "requirements", ADVANTAGE, "bonus");

  return SECTIONS
    .map((section) => ({ ...section, blocks: finish(groups.get(section.key) || [], section.key) }))
    .filter((section) => section.blocks.length > 0);
}
