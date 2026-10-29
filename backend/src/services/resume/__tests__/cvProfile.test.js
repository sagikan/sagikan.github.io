import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { PDFDocument } = require("pdf-lib");
const claude = require("../../ai/anthropic");
const profile = require("../cvProfile");

// Builds a resume in the stored shape that has nothing wrong with it
function validCv() {
  return {
    name: "Dana Levi",
    email: "dana@example.com",
    links: [],
    summary: "Builds services.",
    experience: [{ id: "x1", title: "Developer", company: "Acme", start: "Jan 2020", end: "Present", bullets: [] }],
    projects: [],
    education: [{ id: "e1", degree: "B.Sc.", school: "Example University", start: "2019", end: "2022" }],
    skills: [],
    extras: []
  };
}

// Builds job search preferences that have nothing wrong with them
function validPrefs() {
  return { roles: ["Backend Engineer"], locations: ["Tel Aviv"], workplace_models: ["Remote"] };
}

// Mocks Claude's answer for a resume PDF
function mockResume(result) {
  return vi.spyOn(claude, "send").mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(result) }] });
}

// Builds the raw resume Claude would return, with the given parts replaced
function rawResume(parts = {}) {
  return { cv: { name: "dana levi", email: "dana@example.com", experience: [], projects: [], education: [], skills: [], extras: [], links: [], ...parts }, preferences: {} };
}

describe("object", () => {
  it("builds a strict schema that requires every property", () => {
    expect(profile.object({ a: { type: "string" }, b: { type: "number" } })).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["a", "b"],
      properties: { a: { type: "string" }, b: { type: "number" } }
    });
  });
});

describe("paragraphs", () => {
  it.each([
    ["trims each line and drops blank ones", "  one  \n\n  two  ", "one\ntwo"],
    ["collapses spaces and tabs", "a \t b", "a b"],
    ["reads Windows line breaks", "one\r\ntwo", "one\ntwo"],
    ["returns an empty string for non-text", 5, ""]
  ])("%s", (_title, value, expected) => {
    expect(profile.paragraphs(value, 100)).toBe(expected);
  });

  it("cuts the result to the given length", () => {
    expect(profile.paragraphs("abcdef", 3)).toBe("abc");
  });
});

describe("normalizeCv", () => {
  it("returns an empty resume for missing or invalid input", () => {
    const empty = { name: "", headline: "", email: "", phone: "", location: "", links: [], summary: "", experience: [], projects: [], education: [], skills: [], extras: [] };

    expect(profile.normalizeCv(null)).toEqual(empty);
    expect(profile.normalizeCv("text")).toEqual(empty);
    expect(profile.normalizeCv({})).toEqual(empty);
  });

  it("cleans the contact fields", () => {
    const cv = profile.normalizeCv({ name: "  dana   LEVI-cohen ", headline: " Engineer ", email: " d@x.com ", phone: "+972 (50) 123-4567", location: "Haifa" });

    expect(cv).toMatchObject({ name: "Dana Levi-Cohen", headline: "Engineer", email: "d@x.com", phone: "972501234567", location: "Haifa" });
  });

  it("limits short fields to 200 characters and the phone to 15 digits", () => {
    const cv = profile.normalizeCv({ headline: "h".repeat(300), phone: "1".repeat(30) });

    expect(cv.headline).toHaveLength(200);
    expect(cv.phone).toHaveLength(15);
  });

  it("keeps links with safe or no schemes and drops the rest", () => {
    const links = [
      { label: "Site", url: "https://example.com" },
      { label: "Mail", url: "mailto:d@x.com" },
      { label: "Bare", url: "example.com/me" },
      { label: "Bad", url: "javascript:alert(1)" },
      { label: "Data", url: "data:text/html,hi" },
      { label: "Empty", url: "" },
      null
    ];

    expect(profile.normalizeCv({ links }).links.map((entry) => entry.url)).toEqual(["https://example.com", "mailto:d@x.com", "example.com/me"]);
  });

  it("keeps at most 8 links", () => {
    const links = Array.from({ length: 12 }, (_, index) => ({ label: "x", url: `https://example.com/${index}` }));

    expect(profile.normalizeCv({ links }).links).toHaveLength(8);
  });

  it("keeps the summary's paragraphs and cuts it to 1500 characters", () => {
    expect(profile.normalizeCv({ summary: " One \n\n Two " }).summary).toBe("One\nTwo");
    expect(profile.normalizeCv({ summary: "s".repeat(2000) }).summary).toHaveLength(1500);
  });

  it("gives experience entries and their bullets stable IDs, and skips entries with neither title nor company", () => {
    const cv = profile.normalizeCv({
      experience: [
        { title: "Developer", company: "Acme", bullets: ["Built APIs", "", { text: "Wrote tests" }, 5] },
        { title: "", company: "", bullets: ["Orphan"] },
        { title: "", company: "Globex", bullets: [] }
      ]
    });

    expect(cv.experience).toEqual([
      expect.objectContaining({ id: "x1", title: "Developer", bullets: [{ id: "x1.b1", text: "Built APIs" }, { id: "x1.b2", text: "Wrote tests" }] }),
      expect.objectContaining({ id: "x3", company: "Globex", bullets: [] })
    ]);
  });

  it("keeps at most 15 bullets of 600 characters, and 25 entries", () => {
    const experience = Array.from({ length: 30 }, () => ({ title: "Dev", company: "Acme", bullets: Array.from({ length: 20 }, () => "b".repeat(700)) }));
    const cv = profile.normalizeCv({ experience });

    expect(cv.experience).toHaveLength(25);
    expect(cv.experience[0].bullets).toHaveLength(15);
    expect(cv.experience[0].bullets[0].text).toHaveLength(600);
  });

  it("merges a project's stack into its name unless the name already has it, and skips unnamed projects", () => {
    const cv = profile.normalizeCv({
      projects: [
        { name: "Weather Bot", stack: "Python", bullets: ["Sent forecasts"] },
        { name: "Mail App | Node.js", stack: "Node.js" },
        { name: "", bullets: ["Orphan"] },
        { name: "  ", stack: "Go" }
      ]
    });

    expect(cv.projects.map((project) => [project.id, project.name])).toEqual([["p1", "Weather Bot | Python"], ["p2", "Mail App | Node.js"]]);
    expect(cv.projects[0].bullets).toEqual([{ id: "p1.b1", text: "Sent forecasts" }]);
  });

  it("cleans education entries, requiring a degree or a school", () => {
    const cv = profile.normalizeCv({
      education: [
        { degree: "B.Sc.", major: "Computer Science", school: "example UNIVERSITY", gpa: "88", start: "2019", end: "2022" },
        { degree: "", school: "", major: "Orphan" }
      ]
    });

    expect(cv.education).toEqual([{ id: "e1", degree: "B.Sc.", major: "Computer Science", school: "Example University", location: "", start: "2019", end: "2022", gpa: "88" }]);
  });

  it("keeps skill groups and other sections that have items, with at most 50 skills", () => {
    const cv = profile.normalizeCv({
      skills: [{ category: "Languages", items: ["JavaScript", "", "SQL"] }, { category: "Empty", items: [] }],
      extras: [{ title: "Languages", items: ["Hebrew"] }, { title: "Empty", items: [] }]
    });

    expect(cv.skills).toEqual([{ category: "Languages", items: ["JavaScript", "SQL"] }]);
    expect(cv.extras).toEqual([{ title: "Languages", items: ["Hebrew"] }]);
    expect(profile.normalizeCv({ skills: [{ category: "A", items: Array.from({ length: 80 }, (_, index) => `s${index}`) }] }).skills[0].items).toHaveLength(50);
  });
});

describe("normalizePreferences", () => {
  it("cleans roles and locations and keeps valid workplace types in their usual order", () => {
    const prefs = profile.normalizePreferences({
      roles: [" Backend Engineer ", "", "Data Engineer"],
      locations: ["Tel Aviv"],
      workplace_models: ["Remote", "Hybrid", "Moon base"],
      seniority: "Junior"
    });

    expect(prefs).toEqual({ roles: ["Backend Engineer", "Data Engineer"], locations: ["Tel Aviv"], workplace_models: ["Hybrid", "Remote"], seniority: "Junior" });
  });

  it("falls back to Any for an unknown seniority", () => {
    expect(profile.normalizePreferences({ seniority: "Wizard" }).seniority).toBe("Any");
  });

  it("returns empty preferences for missing input", () => {
    expect(profile.normalizePreferences(null)).toEqual({ roles: [], locations: [], workplace_models: [], seniority: "Any" });
  });

  it("keeps at most 10 roles of 100 characters", () => {
    const prefs = profile.normalizePreferences({ roles: Array.from({ length: 15 }, () => "r".repeat(150)) });

    expect(prefs.roles).toHaveLength(10);
    expect(prefs.roles[0]).toHaveLength(100);
  });
});

describe("hasContent", () => {
  it.each([
    ["experience", { experience: [{}], education: [], projects: [] }, true],
    ["education", { experience: [], education: [{}], projects: [] }, true],
    ["projects", { experience: [], education: [], projects: [{}] }, true],
    ["only skills", { experience: [], education: [], projects: [], skills: [{}] }, false],
    ["nothing", null, false]
  ])("is %s: %s", (_title, cv, expected) => {
    expect(profile.hasContent(cv)).toBe(expected);
  });
});

describe("saveProblem", () => {
  it("finds nothing wrong with a valid resume and preferences", () => {
    expect(profile.saveProblem(validCv(), validPrefs())).toBeNull();
  });

  // Applies a change to a valid resume and returns the first problem found
  function problemWith(change, prefsChange = {}) {
    const cv = validCv();

    change(cv);

    return profile.saveProblem(cv, { ...validPrefs(), ...prefsChange });
  }

  it.each([
    ["no name", (cv) => { cv.name = ""; }, {}, "Add your name and email."],
    ["no email", (cv) => { cv.email = ""; }, {}, "Add your name and email."],
    ["4 links", (cv) => { cv.links = [1, 2, 3, 4]; }, {}, "Add at most 3 links."],
    ["a long summary", (cv) => { cv.summary = "s".repeat(601); }, {}, "Keep the summary to 600 characters."],
    ["11 experience entries", (cv) => { cv.experience = Array.from({ length: 11 }, () => validCv().experience[0]); }, {}, "Add at most 10 experience entries."],
    ["6 projects", (cv) => { cv.projects = Array.from({ length: 6 }, () => ({ bullets: [] })); }, {}, "Add at most 5 projects."],
    ["4 education entries", (cv) => { cv.education = Array.from({ length: 4 }, () => validCv().education[0]); }, {}, "Add at most 3 education entries."],
    ["7 skill groups", (cv) => { cv.skills = Array.from({ length: 7 }, () => ({ items: [] })); }, {}, "Add at most 6 skill groups."],
    ["4 other sections", (cv) => { cv.extras = Array.from({ length: 4 }, () => ({ items: [] })); }, {}, "Add at most 3 other sections."],
    ["an experience entry without a company", (cv) => { cv.experience[0].company = ""; }, {}, "Every experience entry needs a title and a company."],
    ["an experience start without a month", (cv) => { cv.experience[0].start = "2020"; }, {}, "Every experience entry needs a start and end month."],
    ["an experience end that isn't a date", (cv) => { cv.experience[0].end = "later"; }, {}, "Every experience entry needs a start and end month."],
    ["4 experience bullets", (cv) => { cv.experience[0].bullets = [1, 2, 3, 4]; }, {}, "Each experience entry can have up to 3 bullets."],
    ["6 project bullets", (cv) => { cv.projects = [{ name: "P", start: "", end: "", bullets: [1, 2, 3, 4, 5, 6] }]; }, {}, "Each project can have up to 5 bullets."],
    ["an education entry without a school", (cv) => { cv.education[0].school = ""; }, {}, "Every education entry needs a degree and a school."],
    ["an education year that isn't a year", (cv) => { cv.education[0].start = "long ago"; }, {}, "Every education entry needs a start and end year."],
    ["a project end without a start", (cv) => { cv.projects = [{ name: "P", start: "", end: "2022", bullets: [] }]; }, {}, "Project dates need a month and a year, and an end date needs a start date."],
    ["an experience that ends before it starts", (cv) => { cv.experience[0].start = "Dec 2021"; cv.experience[0].end = "Jan 2021"; }, {}, "An end date can't be before its start date."],
    ["an education that ends before it starts", (cv) => { cv.education[0].start = "2022"; cv.education[0].end = "2019"; }, {}, "An education end year can't be before its start year."],
    ["16 skills in a group", (cv) => { cv.skills = [{ items: Array.from({ length: 16 }, String) }]; }, {}, "Each skill group can have up to 15 skills."],
    ["6 items in another section", (cv) => { cv.extras = [{ items: Array.from({ length: 6 }, String) }]; }, {}, "Each other section can have up to 5 items."]
  ])("reports %s", (_title, change, prefsChange, message) => {
    expect(problemWith(change, prefsChange)).toBe(message);
  });

  it.each([
    ["no roles", { roles: [] }, "Add 1 to 5 roles."],
    ["6 roles", { roles: ["a", "b", "c", "d", "e", "f"] }, "Add 1 to 5 roles."],
    ["no locations", { locations: [] }, "Add 1 to 3 locations."],
    ["4 locations", { locations: ["a", "b", "c", "d"] }, "Add 1 to 3 locations."],
    ["no workplace type", { workplace_models: [] }, "Choose at least one workplace type."]
  ])("reports %s in the preferences", (_title, prefsChange, message) => {
    expect(problemWith(() => {}, prefsChange)).toBe(message);
  });

  it("accepts an education entry that is still going and project dates with only years", () => {
    const cv = validCv();

    cv.education[0].end = "Present";
    cv.projects = [{ name: "P", start: "2022", end: "Mar 2023", bullets: [] }];

    expect(profile.saveProblem(cv, validPrefs())).toBeNull();
  });

  it("reports the first problem when there are several", () => {
    expect(problemWith((cv) => { cv.name = ""; cv.links = [1, 2, 3, 4]; })).toBe("Add your name and email.");
  });
});

describe("inspectPdf", () => {
  it.each([
    ["an empty buffer", Buffer.alloc(0)],
    ["something that isn't a buffer", "text"]
  ])("asks for a PDF when given %s", async (_title, input) => {
    expect(await profile.inspectPdf(input)).toEqual({ error: "Upload a PDF file." });
  });

  it("rejects a file without a PDF header", async () => {
    expect(await profile.inspectPdf(Buffer.from("just some text"))).toEqual({ error: "That file isn't a PDF." });
  });

  it("returns the page count of a real PDF", async () => {
    const doc = await PDFDocument.create();

    doc.addPage();
    doc.addPage();

    expect(await profile.inspectPdf(Buffer.from(await doc.save()))).toEqual({ pageCount: 2 });
  });

  it("reports a PDF that can't be read", async () => {
    expect(await profile.inspectPdf(Buffer.from("%PDF-1.4 garbage"))).toEqual({ error: "This PDF couldn't be read. Try exporting it again." });
  });

  it("reports a password-protected PDF", async () => {
    vi.spyOn(PDFDocument, "load").mockRejectedValue(new Error("Input document to `PDFDocument.load` is encrypted"));

    expect(await profile.inspectPdf(Buffer.from("%PDF-1.4"))).toEqual({ error: "This PDF is password-protected. Upload a version without a password." });
  });
});

describe("extractFromPdf", () => {
  it("sends the PDF to Claude and returns the cleaned resume and preferences", async () => {
    const send = mockResume({
      cv: { ...rawResume().cv, experience: [{ title: "Developer", company: "Acme", bullets: ["Built APIs"] }] },
      preferences: { roles: ["Backend Engineer"], locations: ["Haifa"], workplace_models: ["Remote"], seniority: "Junior" }
    });
    const result = await profile.extractFromPdf(Buffer.from("%PDF-pretend"));
    const [params] = send.mock.calls[0];

    expect(result.cv).toMatchObject({ name: "Dana Levi", experience: [{ id: "x1", title: "Developer" }] });
    expect(result.preferences).toEqual({ roles: ["Backend Engineer"], locations: ["Haifa"], workplace_models: ["Remote"], seniority: "Junior" });
    expect(params.messages[0].content[0]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-pretend").toString("base64") } });
    expect(params.output_config.format.type).toBe("json_schema");
  });

  it("uses the sample resume in development, without calling Claude", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const send = vi.spyOn(claude, "send");
    const result = await profile.extractFromPdf(Buffer.from("%PDF-pretend"));

    expect(result.cv.name).toBe("Dana Levi");
    expect(send).not.toHaveBeenCalled();
  });

  it("passes on Claude's errors", async () => {
    vi.spyOn(claude, "send").mockRejectedValue(new claude.ClaudeError("The AI declined this request."));

    await expect(profile.extractFromPdf(Buffer.from("%PDF-pretend"))).rejects.toThrow("The AI declined this request.");
  });

  describe("splitting a degree from its major", () => {
    // Reads a resume with one education entry and returns what came out
    async function educationFor(entry) {
      mockResume(rawResume({ education: [{ school: "Example University", major: "", ...entry }] }));

      return (await profile.extractFromPdf(Buffer.from("%PDF-"))).cv.education[0];
    }

    it.each([
      ["B.Sc. in Computer Science", "B.Sc.", "Computer Science"],
      ["B.Sc. Computer Science", "B.Sc.", "Computer Science"],
      ["M.A. Economics", "M.A.", "Economics"],
      ["Bachelor of Science, Computer Science and Mathematics", "Bachelor of Science", "Computer Science and Mathematics"],
      ["MBA - Finance.", "MBA", "Finance"],
      ["Ph.D. - Physics", "Ph.D.", "Physics"]
    ])("splits %j", async (degree, expectedDegree, expectedMajor) => {
      expect(await educationFor({ degree })).toMatchObject({ degree: expectedDegree, major: expectedMajor });
    });

    it("leaves a degree alone when it has no field after it", async () => {
      expect(await educationFor({ degree: "B.Sc." })).toMatchObject({ degree: "B.Sc.", major: "" });
    });

    it("leaves an entry alone when it already has a major", async () => {
      expect(await educationFor({ degree: "B.Sc. in Physics", major: "Mathematics" })).toMatchObject({ degree: "B.Sc. in Physics", major: "Mathematics" });
    });
  });

  describe("moving a date range out of a project's name", () => {
    // Reads a resume with one project and returns what came out
    async function projectFor(entry) {
      mockResume(rawResume({ projects: [{ link: "", bullets: [], start: "", end: "", ...entry }] }));

      return (await profile.extractFromPdf(Buffer.from("%PDF-"))).cv.projects[0];
    }

    it.each([
      ["Job Tracker | React, Node.js Nov 2025 - Jun 2026", "Job Tracker | React, Node.js", "Nov 2025", "Jun 2026"],
      ["Thesis Project, Jan 2024 - Present", "Thesis Project", "Jan 2024", "Present"],
      ["Chat App (2021 – 2022)", "Chat App", "2021", "2022"],
      ["Game Engine March 2020 to April 2021", "Game Engine", "Mar 2020", "Apr 2021"],
      ["Scraper 03/2022 - 05/2022", "Scraper", "Mar 2022", "May 2022"]
    ])("splits %j", async (name, expectedName, start, end) => {
      expect(await projectFor({ name })).toMatchObject({ name: expectedName, start, end });
    });

    it("leaves a project alone when it already has dates", async () => {
      expect(await projectFor({ name: "Bot 2020 - 2021", start: "2022", end: "2023" })).toMatchObject({ name: "Bot 2020 - 2021", start: "2022", end: "2023" });
    });

    it("leaves a name alone when it has no date range, or is only a date range", async () => {
      expect(await projectFor({ name: "Weather Bot (Python) 2023" })).toMatchObject({ name: "Weather Bot (Python) 2023", start: "" });
      expect(await projectFor({ name: "2020 - 2021" })).toMatchObject({ name: "2020 - 2021", start: "" });
    });
  });
});

describe("cvToText", () => {
  it("writes the resume as plain text for prompts", () => {
    const cv = profile.normalizeCv({
      name: "Dana Levi",
      headline: "Software Engineer",
      location: "Haifa",
      summary: "Builds services.",
      experience: [{ title: "Developer", company: "Acme", start: "Jan 2020", end: "Present", bullets: ["Built APIs"] }],
      projects: [{ name: "Weather Bot | Python", start: "2022", end: "2022", bullets: ["Sent forecasts"] }],
      education: [{ degree: "B.Sc.", major: "Computer Science", school: "Example University", start: "2019", end: "2022", gpa: "88" }],
      skills: [{ category: "Languages", items: ["JavaScript", "SQL"] }, { category: "", items: ["Git"] }],
      extras: [{ title: "Languages", items: ["Hebrew"] }, { title: "", items: ["Volunteering"] }]
    });

    expect(profile.cvToText(cv)).toBe([
      "Dana Levi - Software Engineer",
      "Location: Haifa",
      "Summary: Builds services.",
      "",
      "Experience:",
      "- Developer at Acme (Jan 2020 - Present)",
      "  - Built APIs",
      "",
      "Projects:",
      "- Weather Bot | Python (2022 - 2022)",
      "  - Sent forecasts",
      "",
      "Education:",
      "- B.Sc. in Computer Science, Example University (2019 - 2022)",
      "  - GPA: 88",
      "",
      "Skills:",
      "- Languages: JavaScript, SQL",
      "- Git",
      "",
      "Languages:",
      "- Hebrew",
      "",
      "Other:",
      "- Volunteering"
    ].join("\n"));
  });

  it("leaves out the sections and lines that are empty", () => {
    expect(profile.cvToText(profile.normalizeCv({ name: "Dana" }))).toBe("Dana");
  });
});
