import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const dev = require("../devMode");

const SKILL_TEXT = "JavaScript TypeScript Python SQL Node.js React PostgreSQL Docker Git";

describe("offline", () => {
  it("is on in development", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(dev.offline).toBe(true);
  });

  it("is off when real APIs are requested in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("USE_REAL_APIS", "true");

    expect(dev.offline).toBe(false);
  });

  it("is off outside development", () => {
    expect(dev.offline).toBe(false);
  });
});

describe("sampleResume", () => {
  it("returns a resume with the sections the app expects, and preferences", () => {
    const { cv, preferences } = dev.sampleResume();

    expect(cv).toMatchObject({ name: expect.any(String), email: expect.any(String) });
    ["experience", "projects", "education", "skills", "extras", "links"].forEach((section) => expect(cv[section].length).toBeGreaterThan(0));
    expect(preferences.roles.length).toBeGreaterThan(0);
  });
});

describe("scores", () => {
  const { cv } = dev.sampleResume();

  it("scores a posting by the resume skills it mentions and the technologies it asks for that are missing", () => {
    const [result] = dev.scores(cv, [{ id: 7, title: "Backend Engineer", description: "Looking for Node.js and Docker, plus Kubernetes experience" }]);

    expect(result).toEqual({ id: "7", score: 57, have: ["Node.js", "Docker"], missing: ["Kubernetes"] });
  });

  it("matches whole words only", () => {
    const [result] = dev.scores(cv, [{ id: 1, title: "Gitless", description: "Javascripting and Reactive programming" }]);

    expect(result.have).toEqual([]);
  });

  it("caps the score at 95", () => {
    const [result] = dev.scores(cv, [{ id: 1, title: "Engineer", description: SKILL_TEXT }]);

    expect(result.score).toBe(95);
    expect(result.have).toHaveLength(8);
  });

  it("floors the score at 15", () => {
    const [result] = dev.scores(cv, [{ id: 1, title: "Engineer", description: "Kubernetes AWS GCP Azure Terraform GraphQL Kafka" }]);

    expect(result.score).toBe(15);
    expect(result.missing).toHaveLength(6);
  });

  it("scores a posting without a description from its title", () => {
    const [result] = dev.scores(cv, [{ id: 1, title: "Python Developer" }]);

    expect(result.have).toEqual(["Python"]);
  });
});

describe("tailoring", () => {
  const base = {
    headline: "Software Engineer",
    summary: "Builds things.",
    experience: [{ id: "e1", bullets: [{ id: "b1", text: "one" }, { id: "b2", text: "two" }, { id: "b3", text: "three" }] }],
    projects: [{ id: "p1", bullets: [{ id: "b4", text: "four" }] }, { id: "p2", bullets: [] }, { id: "p3", bullets: [] }, { id: "p4", bullets: [] }],
    skills: [{ category: "A", items: ["Docker"] }, { category: "B", items: ["Go"] }]
  };

  it("puts the first two bullets in reverse and marks the first one as tailored", () => {
    const result = dev.tailoring(base, { company: "Acme", position: "Backend Engineer" });

    expect(result.experience).toEqual([{
      id: "e1",
      bullets: [{ source_id: "b2", text: "two (tailored for Acme)" }, { source_id: "b1", text: "one" }]
    }]);
  });

  it("takes the headline from the job title, without what follows a dash or bracket", () => {
    expect(dev.tailoring(base, { position: "Backend Engineer - Remote" }).headline).toBe("Backend Engineer");
    expect(dev.tailoring(base, { position: "Backend Engineer (Hybrid)" }).headline).toBe("Backend Engineer");
  });

  it("keeps the headline and names the job generically when the job has no title or company", () => {
    const result = dev.tailoring(base, {});

    expect(result.headline).toBe("Software Engineer");
    expect(result.experience[0].bullets[0].text).toBe("two (tailored for this job)");
  });

  it("reverses the projects and skill groups, keeping at most 3 projects", () => {
    const result = dev.tailoring(base, { company: "Acme" });

    expect(result.projects.map((project) => project.id)).toEqual(["p4", "p3", "p2"]);
    expect(result.skills.map((group) => group.category)).toEqual(["B", "A"]);
  });

  it("lists the technologies the resume lacks as gaps", () => {
    expect(dev.tailoring(base, {}).gaps).toEqual(["Kubernetes", "GraphQL", "AWS"]);

    const withKubernetes = { ...base, skills: [{ category: "A", items: ["kubernetes", "AWS"] }] };

    expect(dev.tailoring(withKubernetes, {}).gaps).toEqual(["GraphQL"]);
  });
});

describe("classify", () => {
  it.each([
    ["a rejection", "Unfortunately we are not moving forward with your application", "rejection"],
    ["a rejection that starts with thanks", "Thank you for applying. After review, we regret to inform you", "rejection"],
    ["an offer", "We are pleased to offer you the position", "offer"],
    ["an interview invitation", "We'd like to schedule a call to talk", "interview"],
    ["an assessment", "Please complete the coding challenge", "assessment"],
    ["a viewed notice", "The employer viewed your application", "viewed"],
    ["a received confirmation", "Thank you for applying to Acme", "received"],
    ["an unrelated email", "Our weekly newsletter is here", "other"]
  ])("recognizes %s", (_title, body, event) => {
    expect(dev.classify({ from: "Acme <jobs@acme.com>", subject: "", body }).event).toBe(event);
  });

  it("treats a decision as winning over a confirmation in the same email", () => {
    expect(dev.classify({ from: "", subject: "Thank you for applying", body: "Unfortunately, other candidates were chosen" }).event).toBe("rejection");
  });

  it("marks emails about applications or roles as job related even without a decision", () => {
    expect(dev.classify({ from: "", subject: "About your role", body: "Hello" })).toMatchObject({ jobRelated: true, event: "other" });
    expect(dev.classify({ from: "", subject: "Newsletter", body: "Hello" })).toMatchObject({ jobRelated: false, event: "other" });
  });

  it.each([
    ["a quoted name", "\"Acme Corp\" <jobs@acme.com>", "Acme Corp"],
    ["a plain name", "Acme Careers <jobs@acme.com>", "Acme Careers"],
    ["a bare address", "jobs@acme.com", ""],
    ["no sender", undefined, ""]
  ])("reads the company from %s", (_title, from, company) => {
    expect(dev.classify({ from, subject: "", body: "" }).company).toBe(company);
  });

  it("returns a fixed confidence and no position", () => {
    expect(dev.classify({ from: "", subject: "", body: "" })).toMatchObject({ confidence: 0.6, position: "" });
  });
});
