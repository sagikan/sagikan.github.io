import { describe, expect, it } from "vitest";
import { lastLocationFor, suggestionsFor } from "../suggestions";

const APPLICATIONS = [
  { company: "Acme", location: "Haifa", created_at: "2026-01-01" },
  { company: "acme ", location: "Tel Aviv", created_at: "2026-03-01" },
  { company: "Globex", location: "", created_at: "2026-04-01" },
  { company: "Initech", location: "Eilat", created_at: "2026-02-01" }
];

describe("suggestionsFor", () => {
  it("lists the most used values first, in their latest spelling", () => {
    expect(suggestionsFor(APPLICATIONS, "company")).toEqual(["acme", "Globex", "Initech"]);
  });

  it("skips blank and missing values", () => {
    expect(suggestionsFor([{ company: "  " }, {}, { company: null }], "company")).toEqual([]);
  });

  it("returns an empty list for no items", () => {
    expect(suggestionsFor([], "company")).toEqual([]);
  });

  it("caps the list at 100 suggestions", () => {
    const many = Array.from({ length: 150 }, (_, index) => ({ company: `Company ${index}` }));

    expect(suggestionsFor(many, "company")).toHaveLength(100);
  });
});

describe("lastLocationFor", () => {
  it("returns the newest location used with the company, ignoring case and spaces", () => {
    expect(lastLocationFor(APPLICATIONS, " ACME")).toBe("Tel Aviv");
  });

  it("skips entries without a location", () => {
    expect(lastLocationFor(APPLICATIONS, "Globex")).toBe("");
  });

  it("returns an empty string for an unknown or blank company", () => {
    expect(lastLocationFor(APPLICATIONS, "Umbrella")).toBe("");
    expect(lastLocationFor(APPLICATIONS, "  ")).toBe("");
  });
});
