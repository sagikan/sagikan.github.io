import { describe, expect, it } from "vitest";
import { LIMITS, digitsOnly, entryIssues, formatMonth, formatResume, parseMonth, resumeProblems, titleCase } from "../resumeRules";

const JOB = { title: "Developer", company: "Acme", location: "Haifa", start: "Jan 2020", end: "Present", bullets: ["Built things"] };
const PROJECT = { name: "Weather Bot", start: "Jan 2022", end: "Mar 2022", link: "", bullets: ["Sent forecasts"] };
const DEGREE = { degree: "B.Sc.", major: "Computer Science", school: "Example University", location: "Israel", start: "2019", end: "2022", gpa: "88" };

// Builds a resume that has no problems
function validCv() {
  return {
    name: "Dana Levi",
    email: "dana@example.com",
    phone: "",
    location: "Haifa",
    headline: "Software Engineer",
    summary: "Builds backend services.",
    links: [],
    experience: [{ ...JOB }],
    projects: [{ ...PROJECT }],
    education: [{ ...DEGREE }],
    skills: [{ category: "Languages", items: ["JavaScript"] }],
    extras: [{ title: "Languages", items: ["Hebrew"] }]
  };
}

// Lists the text of each issue of an entry
function issueTexts(section, entry) {
  return entryIssues(section, entry).map((issue) => issue.text);
}

describe("titleCase", () => {
  it.each([
    ["a lowercase name", "dana levi", "Dana Levi"],
    ["shouting", "DANA LEVI", "Dana Levi"],
    ["a hyphenated name", "dana levi-cohen", "Dana Levi-Cohen"],
    ["an accented letter", "élodie", "Élodie"],
    ["null", null, ""]
  ])("capitalizes %s", (_title, value, expected) => {
    expect(titleCase(value)).toBe(expected);
  });
});

describe("digitsOnly", () => {
  it("keeps only digits", () => {
    expect(digitsOnly("+972 50-000-0000")).toBe("972500000000");
  });

  it("cuts the number at the phone limit", () => {
    expect(digitsOnly("1".repeat(30))).toHaveLength(LIMITS.phone);
  });

  it("returns an empty string for no value", () => {
    expect(digitsOnly(undefined)).toBe("");
  });
});

describe("parseMonth", () => {
  it.each([
    ["Present", { present: true, month: -1, year: "" }],
    ["current", { present: true, month: -1, year: "" }],
    ["Jan 2024", { present: false, month: 0, year: "2024" }],
    ["March 2020", { present: false, month: 2, year: "2020" }],
    ["03/2021", { present: false, month: 2, year: "2021" }],
    ["2021-07", { present: false, month: 6, year: "2021" }],
    ["2022", { present: false, month: -1, year: "2022" }],
    ["13/2020", { present: false, month: -1, year: "2020" }],
    ["", { present: false, month: -1, year: "" }],
    [null, { present: false, month: -1, year: "" }]
  ])("reads %j", (value, expected) => {
    expect(parseMonth(value)).toEqual(expected);
  });
});

describe("formatMonth", () => {
  it.each([
    [{ present: true, month: -1, year: "" }, "Present"],
    [{ present: false, month: 0, year: "2024" }, "Jan 2024"],
    [{ present: false, month: -1, year: "2022" }, "2022"],
    [{ present: false, month: 3, year: "" }, "Apr"],
    [{ present: false, month: -1, year: "" }, ""]
  ])("writes %j as %j", (value, expected) => {
    expect(formatMonth(value)).toBe(expected);
  });

  it("writes back what parseMonth read", () => {
    expect(formatMonth(parseMonth("March 2020"))).toBe("Mar 2020");
  });
});

describe("entryIssues", () => {
  describe("for experience", () => {
    it("finds nothing wrong with a complete entry", () => {
      expect(issueTexts("experience", JOB)).toEqual([]);
    });

    it("asks for a missing title and company together", () => {
      expect(entryIssues("experience", { ...JOB, title: "", company: "" })[0]).toEqual({
        parts: ["title", "company"],
        text: "add a title and a company"
      });
    });

    it("asks for a start and end date", () => {
      expect(issueTexts("experience", { ...JOB, start: "2020", end: "" })).toEqual([
        "choose a start month and year",
        "choose an end month and year, or Present"
      ]);
    });

    it("flags an end date before the start date", () => {
      expect(issueTexts("experience", { ...JOB, start: "Jan 2021", end: "Dec 2020" })).toEqual(["the end date is before the start date"]);
    });

    it("asks to shorten a long title", () => {
      expect(issueTexts("experience", { ...JOB, title: "t".repeat(101) })).toEqual(["shorten the title to 100 characters"]);
    });

    it("asks to remove bullets over the limit and to shorten long ones, for text or object bullets", () => {
      const bullets = ["one", { text: "two" }, "three", "x".repeat(251)];

      expect(issueTexts("experience", { ...JOB, bullets })).toEqual(["remove 1 bullet (3 max)", "shorten bullet 4 to 250 characters"]);
    });

    it("ignores empty bullets when counting", () => {
      expect(issueTexts("experience", { ...JOB, bullets: ["one", "two", "three", "  "] })).toEqual([]);
    });
  });

  describe("for projects", () => {
    it("finds nothing wrong with a complete project, or one without dates", () => {
      expect(issueTexts("projects", PROJECT)).toEqual([]);
      expect(issueTexts("projects", { ...PROJECT, start: "", end: "" })).toEqual([]);
    });

    it("asks for a name", () => {
      expect(issueTexts("projects", { ...PROJECT, name: "" })).toEqual(["add a name"]);
    });

    it("asks for a start date when only an end date is given", () => {
      expect(issueTexts("projects", { ...PROJECT, start: "", end: "Mar 2022" })).toEqual(["add a start date too, or clear the end date"]);
    });

    it("asks for both month and year", () => {
      expect(issueTexts("projects", { ...PROJECT, start: "2022" })).toEqual(["choose both a month and a year for its dates"]);
    });

    it("flags an end date before the start date", () => {
      expect(issueTexts("projects", { ...PROJECT, start: "Mar 2022", end: "Jan 2022" })).toEqual(["the end date is before the start date"]);
    });

    it("allows 5 bullets and asks to remove the sixth", () => {
      const bullets = ["1", "2", "3", "4", "5"];

      expect(issueTexts("projects", { ...PROJECT, bullets })).toEqual([]);
      expect(issueTexts("projects", { ...PROJECT, bullets: [...bullets, "6"] })).toEqual(["remove 1 bullet (5 max)"]);
    });
  });

  describe("for education", () => {
    it("finds nothing wrong with a complete entry, with years only", () => {
      expect(issueTexts("education", DEGREE)).toEqual([]);
    });

    it("asks for a missing degree and school", () => {
      expect(issueTexts("education", { ...DEGREE, degree: "", school: "" })).toEqual(["add a degree and a school"]);
    });

    it("asks for years", () => {
      expect(issueTexts("education", { ...DEGREE, start: "", end: "" })).toEqual(["choose a start year", "choose an end year, or Present"]);
    });

    it("flags an end year before the start year", () => {
      expect(issueTexts("education", { ...DEGREE, start: "2022", end: "2019" })).toEqual(["the end year is before the start year"]);
    });

    it("asks to shorten a long GPA", () => {
      expect(issueTexts("education", { ...DEGREE, gpa: "12345678901" })).toEqual(["shorten the GPA to 10 characters"]);
    });
  });

  describe("for other sections", () => {
    it("asks to remove items over the limit and to shorten long ones", () => {
      const items = ["1", "2", "3", "4", "5", "x".repeat(251)];

      expect(issueTexts("extras", { title: "Languages", items })).toEqual(["remove 1 item (5 max)", "shorten item 6 to 250 characters"]);
    });
  });

  it("finds nothing for an unknown section", () => {
    expect(entryIssues("unknown", {})).toEqual([]);
  });
});

describe("resumeProblems", () => {
  it("finds nothing wrong with a valid resume", () => {
    expect(resumeProblems(validCv())).toEqual([]);
  });

  it("asks for a name and an email", () => {
    expect(resumeProblems({ ...validCv(), name: " ", email: "" })).toEqual(["Add your name.", "Add your email."]);
  });

  it("counts only the links that have an address", () => {
    const links = [{ url: "a" }, { url: "b" }, { url: "c" }, { url: "d" }, { url: "" }];

    expect(resumeProblems({ ...validCv(), links })).toEqual(["Links: 4 of 3 allowed. Remove 1."]);
  });

  it("flags too many entries", () => {
    const cv = { ...validCv(), experience: Array.from({ length: 11 }, () => ({ ...JOB })) };

    expect(resumeProblems(cv)).toEqual(["Experience entries: 11 of 10 allowed. Remove 1."]);
  });

  it("flags text over its limit", () => {
    const cv = { ...validCv(), name: "n".repeat(51), headline: "h".repeat(101), summary: "s".repeat(601) };

    expect(resumeProblems(cv)).toEqual([
      "Your name is 51 characters long. Keep it to 50.",
      "The headline is 101 characters long. Keep it to 100.",
      "The summary is 601 characters long. Keep it to 600."
    ]);
  });

  it("names the entry an issue belongs to", () => {
    const cv = { ...validCv(), experience: [{ ...JOB, company: "" }, { ...JOB, title: "", company: "" }] };

    expect(resumeProblems(cv)).toEqual(["Developer: add a company.", "Experience 2: add a title and a company."]);
  });

  it("flags skill groups with too many or too long skills", () => {
    const cv = { ...validCv(), skills: [{ category: "Tools", items: [...Array.from({ length: 16 }, (_, i) => `s${i}`), "k".repeat(51)] }] };

    expect(resumeProblems(cv)).toEqual([
      "Skill group Tools: 17 of 15 allowed. Remove 2.",
      `The skill "${"k".repeat(30)}…" is 51 characters long. Keep it to 50.`
    ]);
  });
});

describe("formatResume", () => {
  it("cleans the name, phone and school", () => {
    const cv = { ...validCv(), name: "dana LEVI ", phone: "+972 50-000", education: [{ ...DEGREE, school: "example university" }] };
    const result = formatResume(cv);

    expect(result.name).toBe("Dana Levi");
    expect(result.phone).toBe("97250000");
    expect(result.education[0].school).toBe("Example University");
  });

  it("drops links without an address", () => {
    const cv = { ...validCv(), links: [{ label: "GitHub", url: "https://github.com/x" }, { label: "Empty", url: " " }] };

    expect(formatResume(cv).links).toEqual([{ label: "GitHub", url: "https://github.com/x" }]);
  });

  it("moves a project's stack into its name, unless it's already there", () => {
    const cv = {
      ...validCv(),
      projects: [
        { ...PROJECT, name: "Weather Bot", stack: "Python" },
        { ...PROJECT, name: "Mail App | Node.js", stack: "Node.js" },
        { ...PROJECT, name: "Plain" }
      ]
    };

    expect(formatResume(cv).projects.map((project) => project.name)).toEqual(["Weather Bot | Python", "Mail App | Node.js", "Plain"]);
    expect(formatResume(cv).projects[0]).not.toHaveProperty("stack");
  });

  it("gives sections without an id one by position", () => {
    const cv = { ...validCv(), extras: [{ title: "A", items: [] }, { id: "keep", title: "B", items: [] }, { title: "C", items: [] }] };

    expect(formatResume(cv).extras.map((group) => group.id)).toEqual(["s1", "keep", "s3"]);
  });
});
