import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { companyScore, matchApplication, positionScore, transition } = require("../emailMatcher");

const BACKEND = { id: 1, company: "Acme", position: "Backend Engineer", applied_at: "2026-03-01" };
const FRONTEND = { id: 2, company: "Acme Inc.", position: "Frontend Developer", applied_at: "2026-03-10" };
const OTHER = { id: 3, company: "Globex", position: "Backend Engineer", applied_at: "2026-03-01" };

describe("companyScore", () => {
  it.each([
    ["the same name", "Acme", "Acme", 1],
    ["names differing only by legal suffixes and case", "ACME Inc.", "acme", 1],
    ["one name containing the other", "Acme Cloud", "Acme", 0.9],
    ["unrelated names", "Acme", "Globex", 0],
    ["a missing name", "", "Acme", 0]
  ])("scores %s", (_title, a, b, expected) => {
    expect(companyScore(a, b)).toBe(expected);
  });

  it("scores partly overlapping names by the share of words in common", () => {
    expect(companyScore("Blue Sky", "Blue Moon")).toBeCloseTo(1 / 3);
  });

  it("ignores accents and punctuation", () => {
    expect(companyScore("Café-Corp", "cafe corp")).toBe(1);
  });
});

describe("positionScore", () => {
  it("scores identical titles as 1", () => {
    expect(positionScore("Backend Engineer", "backend engineer")).toBe(1);
  });

  it("ignores filler words", () => {
    expect(positionScore("Head of the Platform", "Head Platform")).toBe(1);
  });

  it("scores titles by the share of words in common", () => {
    expect(positionScore("Senior Backend Engineer", "Backend Engineer")).toBeCloseTo(2 / 3);
  });

  it("scores unrelated titles as 0", () => {
    expect(positionScore("Backend Engineer", "Product Designer")).toBe(0);
  });
});

describe("matchApplication", () => {
  it("finds no match when no company is close enough", () => {
    expect(matchApplication({ company: "Initech", position: "" }, [BACKEND, OTHER], "2026-04-01")).toEqual({ kind: "none" });
  });

  it("reports an email that arrived before the application was made", () => {
    expect(matchApplication({ company: "Acme", position: "" }, [BACKEND], "2026-02-01")).toEqual({ kind: "predates" });
  });

  it("matches a single application and is sure when the email names no position", () => {
    const result = matchApplication({ company: "Globex", position: "" }, [BACKEND, OTHER], "2026-04-01");

    expect(result).toMatchObject({ kind: "match", application: OTHER, company: 1, position: null, sure: true });
  });

  it("is not sure about a single match whose position doesn't resemble the email's", () => {
    const result = matchApplication({ company: "Globex", position: "Product Designer" }, [OTHER], "2026-04-01");

    expect(result).toMatchObject({ kind: "match", application: OTHER, position: 0, sure: false });
  });

  it("picks the application whose position clearly fits the email", () => {
    const result = matchApplication({ company: "Acme", position: "Backend Engineer" }, [FRONTEND, BACKEND], "2026-04-01");

    expect(result).toMatchObject({ kind: "match", application: BACKEND, sure: true });
  });

  it("is ambiguous when several applications at the company fit equally", () => {
    const result = matchApplication({ company: "Acme", position: "" }, [BACKEND, FRONTEND], "2026-04-01");

    expect(result.kind).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
  });

  it("ignores applications made after the email arrived", () => {
    const result = matchApplication({ company: "Acme", position: "" }, [BACKEND, FRONTEND], "2026-03-05");

    expect(result).toMatchObject({ kind: "match", application: BACKEND });
  });

  it("treats an application without a date as already made", () => {
    const undated = { ...BACKEND, applied_at: null };

    expect(matchApplication({ company: "Acme", position: "" }, [undated], "2020-01-01")).toMatchObject({ kind: "match" });
  });
});

describe("transition", () => {
  it.each([
    ["Applied", "Interview", "auto"],
    ["Applied", "Offer", "auto"],
    ["Interview", "Offer", "auto"],
    ["Applied", "Rejected", "auto"],
    ["Interview", "Rejected", "auto"],
    ["Offer", "Rejected", "review"],
    ["Interview", "Applied", "ignore"],
    ["Offer", "Interview", "ignore"],
    ["Interview", "Interview", "ignore"],
    ["Rejected", "Interview", "ignore"],
    ["Withdrawn", "Offer", "ignore"]
  ])("moves %s to %s as: %s", (current, target, expected) => {
    expect(transition(current, target)).toBe(expected);
  });
});
