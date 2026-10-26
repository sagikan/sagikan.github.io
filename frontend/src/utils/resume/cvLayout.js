export const FONTS = {
  // EB Garamond: a free Garamond close to the one in the Word resume, which can't be shipped
  Garamond: {
    normal: "EBGaramond-Regular.ttf",
    bold: "EBGaramond-Bold.ttf",
    italics: "EBGaramond-Italic.ttf",
    bolditalics: "EBGaramond-BoldItalic.ttf"
  }
};
const INK = "#000000";
const DARK = "#262626";
const GREY = "#404040";
const PAGE_MARGIN = 48.2;
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2;
const BODY = 10.5;
const BULLET_INDENT = 14.2;
const BULLET_LEAD = 2.1;
const HEADING_AFTER = 0.2;
const PARAGRAPH_GAP = 3.5;
const BULLET_X = 2.1;
const BULLET_Y = 7.2;
const BULLET_R = 1.75;
const LINE = lines(1.05);
const BULLET_LINE = 0.859;
const LETTER_SPACING = 0;
const WIN_ANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const SEPARATOR = { text: " | ", bold: false, color: DARK };

// Converts a line count to pdfmake line height
function lines(multiple) {
  return multiple * 0.865;
}

// Turns a value into trimmed text with normal spaces
function text(value) {
  return String(value ?? "").replace(/[\u00a0\u2007\u202f]/g, " ").trim();
}

// Splits text so hyphenated words don't break
function justified(value) {
  return text(value)
    .split(/(\S+[-/]\S+\s*)/)
    .filter(Boolean)
    .map((part) => (/\S[-/]\S/.test(part) ? { text: part, noWrap: true } : part));
}

// Removes characters the PDF font can't show
function winAnsi(value) {
  return text(value)
    .replace(/[\u2010-\u2012]/g, "-")
    .split("")
    .filter((char) => char.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRAS.has(char))
    .join("");
}

// Formats an Israeli mobile number
function phone(value) {
  const digits = text(value).replace(/\D/g, "");

  return /^05\d{8}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6)}` : text(value);
}

// Formats an entry's date range
function dates(entry) {
  return [entry.start, entry.end].map(text).filter(Boolean).join(" – ");
}

// Adds vertical space
function gap(size) {
  return { text: " ", fontSize: size, lineHeight: lines(1) };
}

// Builds a section heading in small caps
function heading(title) {
  const runs = [];
  text(title).toUpperCase().split(" ").forEach((word, index) => {
    runs.push({ text: `${index ? " " : ""}${word[0] ?? ""}`, fontSize: 14 });
    runs.push({ text: word.slice(1), fontSize: 11 });
  });

  return {
    stack: [
      { text: runs, bold: true, color: DARK, lineHeight: lines(1) },
      {
        canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.5, lineColor: DARK }],
        margin: [0, 1.5, 0, 0]
      },
      { ...gap(6), margin: [0, 0, 0, HEADING_AFTER] }
    ],
    unbreakable: true
  };
}

// Builds a row with text on the left and right
function row(left, right, rightStyle = { color: GREY }) {
  return {
    columns: [
      { text: left, width: "*" },
      right ? { text: right, width: "auto", alignment: "right", ...rightStyle } : { text: "", width: 0 }
    ],
    columnGap: 12,
    lineHeight: LINE
  };
}

// Builds an entry title with its detail
function titleRuns(title, detail) {
  const runs = [{ text: text(title).toUpperCase(), bold: true, color: DARK }];

  if (text(detail)) {
    runs.push(SEPARATOR, { text: winAnsi(detail), font: "Times", italics: true, fontSize: 10, color: GREY });
  }

  return runs;
}

// Builds the bullet list
function bullets(items) {
  return items
    .map((item) => text(typeof item === "string" ? item : item.text))
    .filter(Boolean)
    .map((line) => ({
      columns: [
        {
          width: BULLET_INDENT,
          canvas: [{ type: "ellipse", x: BULLET_X, y: BULLET_Y, r1: BULLET_R, r2: BULLET_R, color: DARK }]
        },
        { text: justified(line), width: "*", alignment: "justify", color: INK, lineHeight: BULLET_LINE }
      ],
      columnGap: 0,
      lineHeight: LINE,
      margin: [0, BULLET_LEAD, 0, 0]
    }));
}

// Builds an entry that doesn't break across pages when short
function entry(header, items, last) {
  return {
    stack: [...header, ...bullets(items), ...(last ? [] : [gap(6)])],
    unbreakable: items.length <= 6
  };
}

// Builds the pdfmake document for a resume
export function cvDocument(cv) {
  const content = [];
  const contact = [text(cv.location), text(cv.phone) && `P: ${phone(cv.phone)}`, text(cv.email)].filter(Boolean);
  const links = cv.links.map((link) => text(link.url)).filter(Boolean);

  // Joins parts with separators
  const joined = (parts) => parts.flatMap((part, index) => (index ? [SEPARATOR, part] : [part]));

  content.push({ text: text(cv.name).toUpperCase() || "RESUME", fontSize: 18, bold: true, alignment: "center", lineHeight: lines(1.15), margin: [0, 0, 0, 1.3] });
  if (contact.length) content.push({ text: joined(contact), alignment: "center", lineHeight: lines(1) });
  if (links.length) content.push({ text: joined(links), alignment: "center", lineHeight: lines(1.15) });
  content.push(gap(BODY));

  let first = true;

  // Adds a section with its heading kept on the same page
  const section = (title, body) => {
    if (!first) content.push(gap(BODY));
    first = false;
    content.push({ stack: [heading(title), body[0]].filter(Boolean), unbreakable: true }, ...body.slice(1));
  };

  if (text(cv.summary)) {
    section("About", text(cv.summary).split(/\n+/).filter((line) => line.trim()).map((line, index) => ({
      text: justified(line),
      alignment: "justify",
      color: INK,
      lineHeight: LINE,
      margin: [0, index ? PARAGRAPH_GAP : 0, 0, 0]
    })));
  }

  if (cv.education.length) {
    section("Education", cv.education.map((school) => ({
      stack: [
        { text: text(school.school).toUpperCase(), bold: true, color: DARK, lineHeight: LINE },
        row({ text: text(school.degree), color: GREY }, dates(school)),
        (text(school.major) || text(school.gpa)) && row(
          { text: text(school.major), color: DARK },
          text(school.gpa) && `GPA: ${text(school.gpa)}`,
          { bold: true, color: DARK }
        )
      ].filter(Boolean),
      unbreakable: true
    })));
  }

  if (cv.experience.length) {
    section("Experience", cv.experience.map((job, index) => entry(
      [row(titleRuns(job.title, [job.company, job.location].map(text).filter(Boolean).join(", ")), dates(job))],
      job.bullets,
      index === cv.experience.length - 1
    )));
  }

  if (cv.projects.length) {
    section("Projects", cv.projects.map((project, index) => {
      const [name, ...stack] = text(project.name).split("|");
      const header = [row(titleRuns(name, stack.join("|")), dates(project))];

      if (text(project.link)) {
        header.push({ text: text(project.link), color: GREY, lineHeight: LINE });
      }

      return entry(header, project.bullets, index === cv.projects.length - 1);
    }));
  }

  if (cv.skills.length) {
    section("Technical Skills", cv.skills.map((group) => ({
      text: [
        text(group.category) ? { text: `${text(group.category).replace(/:$/, "")}: `, bold: true, color: DARK } : "",
        group.items.map(text).filter(Boolean).join(", ")
      ],
      lineHeight: LINE
    })));
  }

  for (const group of cv.extras) {
    section(group.title || "Other", bullets(group.items));
  }

  return {
    info: { title: text(cv.name) ? `${text(cv.name)} - Resume` : "Resume" },
    pageSize: "LETTER",
    pageMargins: [PAGE_MARGIN, PAGE_MARGIN - 2.5, PAGE_MARGIN, PAGE_MARGIN],
    content,
    defaultStyle: { font: "Garamond", fontSize: BODY, lineHeight: LINE, characterSpacing: LETTER_SPACING, color: INK }
  };
}
