import { describe, expect, it } from "vitest";
import { FONTS, cvDocument } from "../cvLayout";

const CV = {
  name: "Dana Levi",
  location: "Tel Aviv, Israel",
  phone: "0501234567",
  email: "dana@example.com",
  links: [{ url: "https://github.com/dana" }, { url: " " }],
  summary: "Builds backend services.\n\nLoves tests.",
  education: [{ school: "Example University", degree: "B.Sc.", major: "Computer Science", gpa: "88", start: "2019", end: "2022" }],
  experience: [{ title: "Developer", company: "Acme", location: "Haifa", start: "Jan 2020", end: "Present", bullets: ["Built APIs", { text: "Wrote tests" }, "  "] }],
  projects: [{ name: "Weather Bot | Python", start: "2022", end: "2022", link: "", bullets: ["Sent forecasts"] }],
  skills: [{ category: "Languages:", items: ["JavaScript", "SQL", ""] }],
  extras: [{ title: "Languages", items: ["Hebrew"] }]
};
const EMPTY = { name: "", location: "", phone: "", email: "", links: [], summary: "", education: [], experience: [], projects: [], skills: [], extras: [] };

// Reads the visible text of a layout node, with stacks on separate lines and columns split by tabs
function plainText(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (!node || typeof node !== "object") return "";
  if (node.stack) return node.stack.map(plainText).join("\n");
  if (node.columns) return node.columns.map(plainText).join("\t");

  return plainText(node.text);
}

// Lists the non-empty lines of text in a resume document
function visibleLines(cv) {
  return cvDocument(cv).content.flatMap((node) => plainText(node).split("\n")).map((line) => line.trim()).filter(Boolean);
}

describe("FONTS", () => {
  it("defines the four Garamond variants the document uses", () => {
    expect(Object.keys(FONTS.Garamond)).toEqual(["normal", "bold", "italics", "bolditalics"]);
  });
});

describe("cvDocument", () => {
  it("lays out a full resume in order, with headings in capitals", () => {
    expect(visibleLines(CV)).toEqual([
      "DANA LEVI",
      "Tel Aviv, Israel | P: 050 123-4567 | dana@example.com",
      "https://github.com/dana",
      "ABOUT",
      "Builds backend services.",
      "Loves tests.",
      "EDUCATION",
      "EXAMPLE UNIVERSITY",
      "B.Sc.\t2019 – 2022",
      "Computer Science\tGPA: 88",
      "EXPERIENCE",
      "DEVELOPER | Acme, Haifa\tJan 2020 – Present",
      "Built APIs",
      "Wrote tests",
      "PROJECTS",
      "WEATHER BOT | Python\t2022 – 2022",
      "Sent forecasts",
      "TECHNICAL SKILLS",
      "Languages: JavaScript, SQL",
      "LANGUAGES",
      "Hebrew"
    ]);
  });

  it("describes a letter-size page and the resume's title", () => {
    const doc = cvDocument(CV);

    expect(doc.pageSize).toBe("LETTER");
    expect(doc.info.title).toBe("Dana Levi - Resume");
    expect(doc.defaultStyle.font).toBe("Garamond");
  });

  it("uses a generic title and heading when the resume has no name", () => {
    expect(cvDocument(EMPTY).info.title).toBe("Resume");
    expect(visibleLines(EMPTY)).toEqual(["RESUME"]);
  });

  it("leaves out sections that have nothing in them", () => {
    expect(visibleLines({ ...EMPTY, name: "Dana Levi", skills: [{ category: "", items: ["Go"] }] })).toEqual(["DANA LEVI", "TECHNICAL SKILLS", "Go"]);
  });

  it("leaves out contact lines that have nothing in them", () => {
    expect(visibleLines({ ...EMPTY, name: "Dana", email: "dana@example.com" })).toEqual(["DANA", "dana@example.com"]);
  });

  it("formats an Israeli mobile number and leaves other numbers as written", () => {
    expect(visibleLines({ ...EMPTY, name: "A", phone: "050-123-4567" })[1]).toBe("P: 050 123-4567");
    expect(visibleLines({ ...EMPTY, name: "A", phone: "+1 555 0100" })[1]).toBe("P: +1 555 0100");
  });

  it("replaces non-breaking spaces and removes characters the PDF font can't show", () => {
    const project = { name: "Bot | Café – Zürich ✓ 😀", start: "", end: "", link: "", bullets: [] };
    const [header] = visibleLines({ ...EMPTY, projects: [project] }).slice(2);

    expect(header).toContain("Café – Zürich");
    expect(header).not.toMatch(/[✓😀]/u);
  });

  it("shows a project's link under its title", () => {
    const project = { name: "Bot", start: "", end: "", link: "https://example.com/bot", bullets: [] };

    expect(visibleLines({ ...EMPTY, projects: [project] }).slice(2)).toEqual(["BOT", "https://example.com/bot"]);
  });

  it("keeps hyphenated words together on a line", () => {
    const hyphenated = JSON.stringify(cvDocument({ ...EMPTY, summary: "A state-of-the-art tool" }).content);
    const plain = JSON.stringify(cvDocument({ ...EMPTY, summary: "A plain tool" }).content);

    expect(hyphenated).toContain("\"noWrap\":true");
    expect(plain).not.toContain("noWrap");
  });
});
