import { describe, expect, it } from "vitest";
import { parseDescription, sectionFor, textDirection } from "../jobDescription";

const POSTING = [
  "Senior Backend Engineer",
  "Acme builds payment rails for small shops.",
  "About the Role",
  "You'll own our ledger services.",
  "What You'll Do",
  "- Design APIs",
  "- Own services",
  "end to end in production",
  "Requirements:",
  "5+ years of experience with Python",
  "Experience with AWS",
  "Nice to have",
  "• Kafka;",
  "• Go",
  "Benefits",
  "Competitive Salary",
  "Health insurance",
  "Acme is an equal opportunity employer."
].join("\n");

// Gives each section's key and blocks, which is what the tests compare
function shape(sections) {
  return sections.map(({ key, blocks }) => [key, blocks]);
}

describe("sectionFor", () => {
  it.each([
    ["Responsibilities", "duties"],
    ["What you'll do:", "duties"],
    ["Who You Are", "requirements"],
    ["Preferred Qualifications", "bonus"],
    ["Bonus points", "bonus"],
    ["What you'll get", "benefits"],
    ["Perks & Benefits", "benefits"],
    ["About Acme", "company"],
    ["About the position", "role"],
    ["Equal Opportunity", "more"],
    ["What will your job look like:", "duties"],
    ["All you need is:", "requirements"],
    ["The role includes:", "duties"],
    ["Big pluses", "bonus"],
    ["Why PI", "benefits"],
    ["Note on Fraudulent Recruiting", "more"],
    ["דרישות:", "requirements"],
    ["במסגרת התפקיד:", "duties"],
    ["About the Senior Backend Engineer", "role"],
    ["About the team", "company"]
  ])("reads %s as the %s section", (heading, section) => {
    expect(sectionFor(heading)).toBe(section);
  });

  it.each([["Tech stack"], ["Level up the team"], ["What you will not do"]])("returns null for %s, which names no section", (heading) => {
    expect(sectionFor(heading)).toBeNull();
  });
});

describe("parseDescription", () => {
  it("sorts a posting into the fixed sections, in their order", () => {
    const sections = parseDescription(POSTING, "Senior Backend Engineer");

    expect(sections.map((section) => section.key)).toEqual(["role", "duties", "requirements", "bonus", "benefits", "company", "more"]);
    expect(shape(sections)).toEqual([
      ["role", [{ type: "paragraph", text: "You'll own our ledger services." }]],
      ["duties", [{ type: "list", items: ["Design APIs", "Own services end to end in production"] }]],
      ["requirements", [{ type: "list", items: ["5+ years of experience with Python", "Experience with AWS"] }]],
      ["bonus", [{ type: "list", items: ["Kafka", "Go"] }]],
      ["benefits", [{ type: "list", items: ["Competitive Salary", "Health insurance"] }]],
      ["company", [{ type: "paragraph", text: "Acme builds payment rails for small shops." }]],
      ["more", [{ type: "paragraph", text: "Acme is an equal opportunity employer." }]]
    ]);
  });

  it("keeps text without headings in the role section", () => {
    const sections = parseDescription("We build robots.\nYou will build them.");

    expect(shape(sections)).toEqual([
      ["role", [{ type: "paragraph", text: "We build robots." }, { type: "paragraph", text: "You will build them." }]]
    ]);
  });

  it("splits a run-on description at its inline headings and bullets", () => {
    const text = "We are looking for a data engineer to build our pipelines and own the warehouse. " +
      "Responsibilities: Build ETL jobs. Maintain the warehouse. Requirements: 3+ years with SQL • Spark • dbt";

    const sections = parseDescription(text);

    expect(shape(sections)).toEqual([
      ["role", [{ type: "paragraph", text: "We are looking for a data engineer to build our pipelines and own the warehouse." }]],
      ["duties", [{ type: "list", items: ["Build ETL jobs. Maintain the warehouse."] }]],
      ["requirements", [{ type: "list", items: ["3+ years with SQL", "Spark", "dbt"] }]]
    ]);
  });

  it("keeps an inline label that says more than the section's title", () => {
    const sections = parseDescription("Build robots.\nLocation: Tel Aviv");

    expect(sections[1]).toEqual({ key: "more", title: "More details", tab: "More", blocks: [{ type: "paragraph", text: "Location: Tel Aviv" }] });
  });

  it("keeps a heading it doesn't know as a subheading inside the open section", () => {
    const sections = parseDescription("Responsibilities\nTECH STACK\n- Node.js\n- Postgres");

    expect(shape(sections)).toEqual([
      ["duties", [{ type: "subheading", text: "TECH STACK" }, { type: "list", items: ["Node.js", "Postgres"] }]]
    ]);
  });

  it("turns every plain line in a list section into a bullet, keeping a lead-in that ends in a colon", () => {
    const long = `${"Work closely with product, design and data to shape the roadmap ".repeat(4)}end`;
    const leadIn = "No two days look exactly alike, but a typical one might include:";

    const sections = parseDescription(`Responsibilities\n${leadIn}\n${long}\nShip features`);

    expect(sections[0].blocks).toEqual([
      { type: "paragraph", text: leadIn },
      { type: "list", items: [long, "Ship features"] }
    ]);
  });

  it.each([
    ["What we're looking for", "- Go"],
    ["Key Qualifications", "- Go"],
    ["Technical Skills", "- Go"],
    ["Must-haves", "Go"]
  ])("drops %s, which only restates the requirements heading", (restated, item) => {
    const sections = parseDescription(`Requirements\n${restated}\n${item}\n- SQL`);

    expect(shape(sections)).toEqual([["requirements", [{ type: "list", items: ["Go", "SQL"] }]]]);
  });

  it("drops a lead-in that only restates its section's heading", () => {
    const sections = parseDescription("Responsibilities\nYour daily responsibilities may include:\n- Ship");

    expect(shape(sections)).toEqual([["duties", [{ type: "list", items: ["Ship"] }]]]);
  });

  it("turns a short title case label over prose or a list into a subheading", () => {
    const prose = "Our website is often where people first get to know us, so every page has to earn its place.";

    const sections = parseDescription(`Responsibilities\n- Own the website\nWhy This Role Matters\n${prose}\nTeam Building\n- Hire`);

    expect(shape(sections)).toEqual([
      ["duties", [
        { type: "list", items: ["Own the website"] },
        { type: "subheading", text: "Why This Role Matters" },
        { type: "list", items: [prose] },
        { type: "subheading", text: "Team Building" },
        { type: "list", items: ["Hire"] }
      ]]
    ]);
  });

  it("moves a must listed as nice to have to the requirements", () => {
    const sections = parseDescription("Nice to have:\n- Kafka\n- Fluent English (mandatory)");

    expect(shape(sections)).toEqual([
      ["requirements", [{ type: "list", items: ["Fluent English (mandatory)"] }]],
      ["bonus", [{ type: "list", items: ["Kafka"] }]]
    ]);
  });

  it("drops a heading repeated inside a section that isn't a list", () => {
    const prose = "We are seeking a Windows internals engineer for our Tel Aviv research and development center.";

    const sections = parseDescription(`Job Summary\n\nJob Summary\n${prose}`);

    expect(shape(sections)).toEqual([["role", [{ type: "paragraph", text: prose }]]]);
  });

  it("keeps a labelled fact as text rather than a subheading", () => {
    const prose = "We are hiring engineers who enjoy building infrastructure that thousands of teams rely on.";

    const sections = parseDescription(`Seniority: Junior\n${prose}`);

    expect(shape(sections)).toEqual([["role", [{ type: "paragraph", text: "Seniority: Junior" }, { type: "paragraph", text: prose }]]]);
  });

  it("keeps a title case item that uses its section's words", () => {
    const sections = parseDescription("Benefits\nCompetitive Salary\nGym");

    expect(shape(sections)).toEqual([["benefits", [{ type: "list", items: ["Competitive Salary", "Gym"] }]]]);
  });

  it("drops the repeated job title and apply buttons", () => {
    const sections = parseDescription("Data Engineer\nBuild pipelines.\nApply now", "Data Engineer");

    expect(shape(sections)).toEqual([["role", [{ type: "paragraph", text: "Build pipelines." }]]]);
  });

  it("merges a section's content when its heading appears twice", () => {
    const sections = parseDescription("Requirements\n- Go\nResponsibilities\n- Ship\nQualifications:\n- SQL");

    expect(shape(sections)).toEqual([
      ["duties", [{ type: "list", items: ["Ship"] }]],
      ["requirements", [{ type: "list", items: ["Go", "SQL"] }]]
    ]);
  });

  it("reads bullets standing alone between plain lines as headings", () => {
    const sections = parseDescription("- Key Responsibilities\nBuild products\nKeep them running\n- Education\nB.Sc in computer science");

    expect(shape(sections)).toEqual([
      ["duties", [{ type: "list", items: ["Build products", "Keep them running"] }]],
      ["requirements", [{ type: "list", items: ["B.Sc in computer science"] }]]
    ]);
  });

  it("moves requirements marked as optional to nice to have", () => {
    const sections = parseDescription("Requirements:\nC++ - Must\nElectronics - advantage\nGo is a plus\nתואר מתקדם – יתרון");

    expect(shape(sections)).toEqual([
      ["requirements", [{ type: "list", items: ["C++ - Must"] }]],
      ["bonus", [{ type: "list", items: ["Electronics - advantage", "Go is a plus", "תואר מתקדם – יתרון"] }]]
    ]);
  });

  it("moves a line after the first heading that opens with the company's name to the company section", () => {
    const sections = parseDescription("Nice to have:\n- Python\nMobileye changes the way we drive.\nAt Mobileye, we ship.", "", "Mobileye");

    expect(shape(sections)).toEqual([
      ["bonus", [{ type: "list", items: ["Python"] }]],
      ["company", [{ type: "paragraph", text: "Mobileye changes the way we drive." }, { type: "paragraph", text: "At Mobileye, we ship." }]]
    ]);
  });

  it("keeps legal text that starts with the company's name in more details", () => {
    const sections = parseDescription("Benefits\n- Gym\nAcme is an equal opportunity employer.", "", "Acme");

    expect(shape(sections)).toEqual([
      ["benefits", [{ type: "list", items: ["Gym"] }]],
      ["more", [{ type: "paragraph", text: "Acme is an equal opportunity employer." }]]
    ]);
  });

  it("joins hard-wrapped lines without reading their words as headings", () => {
    const text = "What You'll Do\n- Design suites for Web and\nMobile platforms.\n- Translate product requirements into comprehensive\ntest plans.";

    const sections = parseDescription(text);

    expect(shape(sections)).toEqual([
      ["duties", [{ type: "list", items: ["Design suites for Web and Mobile platforms.", "Translate product requirements into comprehensive test plans."] }]]
    ]);
  });

  it.each([
    ["Requirements\nYou'll Do It Using:\n- Python\n- SQL"],
    ["Qualifications\nPreferred Qualifications\n- Python\n- SQL"],
    ["Requirements\nWhat Will Make You Stand Out?\n- Python\n- SQL"]
  ])("keeps the requirements open under a heading that only qualifies them: %j", (text) => {
    const sections = parseDescription(text);

    expect(shape(sections)).toEqual([["requirements", [{ type: "list", items: ["Python", "SQL"] }]]]);
  });

  it("opens a new section for a heading right under an empty one", () => {
    const sections = parseDescription("Responsibilities\nRequirements\n- Python");

    expect(shape(sections)).toEqual([["requirements", [{ type: "list", items: ["Python"] }]]]);
  });

  it.each([
    ["key job responsibilities", "duties"],
    ["What you will be responsible for", "duties"],
    ["What will you bring to the table?", "requirements"],
    ["To be a Support Engineer at JFrog you need…", "requirements"],
    ["To be successful in this role you will:", "requirements"],
    ["What you will gain", "benefits"],
    ["Qualifications (must)", "requirements"],
    ["הנה חלק ממה שתצטרך/י:", "requirements"],
    ["הנה כמה מהניסיון המועדף עלינו:", "bonus"],
    ["במסגרת התפקיד", "duties"]
  ])("reads %s as a %s heading", (heading, section) => {
    const sections = parseDescription(`Intro.\n${heading}\nShip code.`);

    expect(sections.map((found) => found.key)).toEqual(["role", section]);
  });

  it("moves lines marked as a must, with no heading of their own, to the requirements", () => {
    const sections = parseDescription("We build systems.\n- C++ - חובה\n- Linux - Must\n- Python - יתרון");

    expect(shape(sections)).toEqual([
      ["role", [{ type: "paragraph", text: "We build systems." }]],
      ["requirements", [{ type: "list", items: ["C++ - חובה", "Linux - Must"] }]],
      ["bonus", [{ type: "list", items: ["Python - יתרון"] }]]
    ]);
  });

  it("splits off a heading glued to the sentence before it", () => {
    const sections = parseDescription("Interviews are in person.Minimum qualifications:\nBachelor's degree");

    expect(shape(sections)).toEqual([
      ["role", [{ type: "paragraph", text: "Interviews are in person." }]],
      ["requirements", [{ type: "list", items: ["Bachelor's degree"] }]]
    ]);
  });

  it("reads bullets set right against their words and decodes entities a feed left", () => {
    const sections = parseDescription("Responsibilities&#xa;*Close the books&#xa;-Pay vendors");

    expect(shape(sections)).toEqual([["duties", [{ type: "list", items: ["Close the books", "Pay vendors"] }]]]);
  });

  it.each([
    ["Markdown headings and bold", "## Responsibilities\n- Ship\n- Review\n**Requirements**\n* Go\n* SQL"],
    ["bold headings with colons", "**What you'll do:**\nShip\nReview\n**What you bring:**\nGo\nSQL"],
    ["Word's o bullets", "Responsibilities\no Ship\no Review\nRequirements\no Go\no SQL"],
    ["emoji headings", "🛠 What you'll do\n- Ship\n- Review\n✅ Requirements\n- Go\n- SQL"],
    ["Windows line ends and tabs", "Responsibilities\r\n\t• Ship\r\n\t• Review\r\nRequirements\r\n\t• Go\r\n\t• SQL"],
    ["numbered items", "Responsibilities:\n1. Ship\n2. Review\nRequirements:\n1) Go\n2) SQL"],
    ["headings in capitals", "WHAT YOU WILL DO\n- Ship\n- Review\nWHAT WE'RE LOOKING FOR\n- Go\n- SQL"]
  ])("sorts %s into duties and requirements without losing an item", (format, text) => {
    const sections = parseDescription(text);

    expect(shape(sections)).toEqual([
      ["duties", [{ type: "list", items: ["Ship", "Review"] }]],
      ["requirements", [{ type: "list", items: ["Go", "SQL"] }]]
    ]);
  });

  it("keeps items that only use a section's words, however the list is laid out", () => {
    const sections = parseDescription("Requirements\nExperience with AWS\nStrong communication skills\nBuild great developer experience\n- Go");

    expect(sections[0].blocks).toEqual([
      { type: "list", items: ["Experience with AWS", "Strong communication skills", "Build great developer experience", "Go"] }
    ]);
  });

  it("keeps a negated heading as a subheading instead of opening its section", () => {
    const sections = parseDescription("What you'll do\n- Ship\nWhat you will not do:\n- Meetings all day");

    expect(shape(sections)).toEqual([
      ["duties", [{ type: "list", items: ["Ship"] }, { type: "subheading", text: "What you will not do" }, { type: "list", items: ["Meetings all day"] }]]
    ]);
  });

  it("keeps a bullet that mentions legal words in its section", () => {
    const sections = parseDescription("Requirements\n- Knowledge of privacy policy frameworks\n- Go");

    expect(shape(sections)).toEqual([["requirements", [{ type: "list", items: ["Knowledge of privacy policy frameworks", "Go"] }]]]);
  });

  it("drops hashtags, social links and empty values", () => {
    const sections = parseDescription("Build robots.\n#LI-Hybrid #NI-LI1\nFacebook\nNone");

    expect(shape(sections)).toEqual([["role", [{ type: "paragraph", text: "Build robots." }]]]);
  });

  it("splits bullets glued to the words around them", () => {
    const sections = parseDescription("The role includes\n:• Evaluating tools• Providing support\nRequirements:• B.Sc. in Computer Science");

    expect(shape(sections)).toEqual([
      ["duties", [{ type: "list", items: ["Evaluating tools", "Providing support"] }]],
      ["requirements", [{ type: "list", items: ["B.Sc. in Computer Science"] }]]
    ]);
  });

  it("keeps the open section after a labelled fact", () => {
    const sections = parseDescription("Responsibilities\nLocation: Tel Aviv\n- Ship\n- Test");

    expect(shape(sections)).toEqual([
      ["duties", [{ type: "list", items: ["Ship", "Test"] }]],
      ["more", [{ type: "paragraph", text: "Location: Tel Aviv" }]]
    ]);
  });

  it.each([[""], [null], [undefined]])("returns no sections for %j", (description) => {
    expect(parseDescription(description)).toEqual([]);
  });
});

describe("textDirection", () => {
  it.each([
    ["ניסיון בפיתוח React ו-Node.js – חובה", "rtl"],
    ["Experience with React, including טכנולוגיות", "ltr"],
    ["", "ltr"],
    [null, "ltr"]
  ])("reads %j as %s", (text, direction) => {
    expect(textDirection(text)).toBe(direction);
  });
});
