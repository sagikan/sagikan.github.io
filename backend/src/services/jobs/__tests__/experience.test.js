import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { adjustForExperience, candidateYears, requiredExperience, requirementPhrase, withoutYearRequirements } = require("../experience");

describe("candidateYears", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the months of a job, inclusive of both ends", () => {
    expect(candidateYears({ experience: [{ title: "Developer", company: "Acme", start: "Jan 2020", end: "Dec 2021" }] })).toBe(2);
  });

  it("counts overlapping jobs once", () => {
    const cv = {
      experience: [
        { title: "Developer", company: "Acme", start: "Jan 2020", end: "Dec 2020" },
        { title: "Contractor", company: "Globex", start: "Jul 2020", end: "Dec 2021" }
      ]
    };

    expect(candidateYears(cv)).toBe(2);
  });

  it("reads year-only dates", () => {
    expect(candidateYears({ experience: [{ title: "Developer", company: "Acme", start: "2020", end: "2021" }] })).toBe(1.1);
  });

  it("counts a job that runs to the present up to the current month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    expect(candidateYears({ experience: [{ title: "Developer", company: "Acme", start: "Jan 2026", end: "Present" }] })).toBe(0.5);
  });

  it("skips military service unless the role is technical", () => {
    const cv = {
      experience: [
        { title: "Soldier", company: "IDF", start: "Jan 2015", end: "Dec 2017" },
        { title: "Software Developer", company: "IDF", start: "Jan 2018", end: "Dec 2018" }
      ]
    };

    expect(candidateYears(cv)).toBe(1);
  });

  it("skips jobs without a readable start date", () => {
    expect(candidateYears({ experience: [{ title: "Developer", company: "Acme", start: "sometime", end: "2021" }] })).toBe(0);
  });

  it.each([null, undefined, {}, { experience: [] }])("returns 0 for %j", (cv) => {
    expect(candidateYears(cv)).toBe(0);
  });
});

describe("requiredExperience", () => {
  it("reads years of work experience as a strict requirement", () => {
    expect(requiredExperience("3+ years of work experience in backend development")).toEqual({ years: 3, looseYears: 0, hinted: false });
  });

  it("reads years of experience with a skill as a loose requirement", () => {
    expect(requiredExperience("3 years of Python experience")).toEqual({ years: 0, looseYears: 3, hinted: false });
  });

  it("reads plain years of experience as loose", () => {
    expect(requiredExperience("5+ years of experience")).toEqual({ years: 0, looseYears: 5, hinted: false });
  });

  it("reads number words", () => {
    expect(requiredExperience("Three years of professional experience").years).toBe(3);
  });

  it("takes the highest requirement in the description", () => {
    expect(requiredExperience("2 years of work experience.\n4 years of work experience as a lead").years).toBe(4);
  });

  it.each([
    ["a nice-to-have", "5 years of experience is a plus"],
    ["a company boast", "Our team has 10 years of experience"],
    ["an upper bound", "Up to 2 years of experience"],
    ["a waived requirement", "3 years of experience or equivalent"],
    ["a degree length", "A 4 years degree in computer science"]
  ])("ignores %s", (_title, description) => {
    expect(requiredExperience(description)).toEqual({ years: 0, looseYears: 0, hinted: false });
  });

  it("ignores an absurd number of years but still hints at work experience", () => {
    expect(requiredExperience("20 years of work experience")).toEqual({ years: 0, looseYears: 0, hinted: true });
  });

  it("hints at a work experience requirement that names no years", () => {
    expect(requiredExperience("Proven work experience in a similar role").hinted).toBe(true);
  });

  it("doesn't hint for entry-level titles", () => {
    expect(requiredExperience("Proven work experience in a similar role", "Junior Developer").hinted).toBe(false);
  });

  it("returns no requirements for an empty description", () => {
    expect(requiredExperience(null)).toEqual({ years: 0, looseYears: 0, hinted: false });
  });
});

describe("adjustForExperience", () => {
  it.each([
    ["no requirement", 80, 3, { years: 0, looseYears: 0, hinted: false }, 80],
    ["a met requirement", 80, 3, { years: 3, looseYears: 0, hinted: false }, 80],
    ["a strict gap of 2 years", 80, 1, { years: 3, looseYears: 0, hinted: false }, 68],
    ["a strict gap capped at 20", 80, 0, { years: 10, looseYears: 0, hinted: false }, 60],
    ["a loose gap capped at 6", 80, 0, { years: 0, looseYears: 8, hinted: false }, 74],
    ["a hint with little experience", 80, 0, { years: 0, looseYears: 0, hinted: true }, 75],
    ["a hint with enough experience", 80, 2, { years: 0, looseYears: 0, hinted: true }, 80],
    ["a score that would go below 0", 5, 0, { years: 10, looseYears: 0, hinted: false }, 0]
  ])("applies %s", (_title, score, haveYears, required, expected) => {
    expect(adjustForExperience(score, haveYears, required)).toBe(expected);
  });
});

describe("requirementPhrase", () => {
  it.each([
    [{ years: 3, looseYears: 5, hinted: true }, "3+ years work experience"],
    [{ years: 0, looseYears: 2, hinted: true }, "2+ years experience"],
    [{ years: 0, looseYears: 0, hinted: true }, "Work experience"],
    [{ years: 0, looseYears: 0, hinted: false }, null]
  ])("describes %j", (required, expected) => {
    expect(requirementPhrase(required)).toBe(expected);
  });
});

describe("withoutYearRequirements", () => {
  it("removes the years so only the experience wording is left", () => {
    expect(withoutYearRequirements("5+ years of experience in Python").trim()).toBe("experience in Python");
  });

  it("leaves text without a requirement alone", () => {
    expect(withoutYearRequirements("Great team and snacks")).toBe("Great team and snacks");
  });

  it("returns an empty string for missing text", () => {
    expect(withoutYearRequirements(null)).toBe("");
  });
});
