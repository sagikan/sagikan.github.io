import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { areaScore, areasFor, tidyLocation } = require("../locations");

describe("areasFor", () => {
  it("takes the city from a city and region pair", () => {
    const areas = areasFor(["London, UK"]);

    expect(areas.cities).toEqual(["london"]);
    expect(areas.regions).toEqual(["uk"]);
  });

  it("treats a single place as a region", () => {
    expect(areasFor(["Berlin"])).toEqual({ cities: [], regions: ["berlin"] });
  });

  it("widens Israel to its cities", () => {
    const { cities, regions } = areasFor(["Tel Aviv, Israel"]);

    expect(cities).toEqual(["tel aviv"]);
    expect(regions).toEqual(expect.arrayContaining(["israel", "haifa", "herzliya"]));
  });

  it("returns nothing for no locations", () => {
    expect(areasFor([])).toEqual({ cities: [], regions: [] });
  });
});

describe("areaScore", () => {
  const areas = areasFor(["Tel Aviv, Israel"]);

  it.each([
    ["the wanted city", "Tel Aviv, Israel", 2],
    ["the wanted city spelled with a hyphen", "Tel-Aviv", 2],
    ["another city in the wanted region", "Haifa", 1],
    ["a remote-only job", "Remote", 1],
    ["a worldwide job", "Worldwide", 1],
    ["a place elsewhere", "Berlin, Germany", 0],
    ["no location", "", 0]
  ])("scores %s", (_title, location, expected) => {
    expect(areaScore(location, areas)).toBe(expected);
  });

  it("scores a remote job tied to another place as no match", () => {
    expect(areaScore("Remote - Berlin", areas)).toBe(0);
  });
});

describe("tidyLocation", () => {
  it("names the Israeli city and finds the workplace model", () => {
    expect(tidyLocation("Tel Aviv-Yafo, Israel (Hybrid)")).toEqual({ location: "Tel Aviv, Israel", workplace: "Hybrid" });
  });

  it("joins up to two cities in the order they appear", () => {
    expect(tidyLocation("Herzliya or Tel Aviv or Haifa").location).toBe("Herzliya / Tel Aviv, Israel");
  });

  it("falls back to Israel when no city is named", () => {
    expect(tidyLocation("Israel")).toEqual({ location: "Israel", workplace: null });
  });

  it("keeps other places as written", () => {
    expect(tidyLocation("Berlin, Germany")).toEqual({ location: "Berlin, Germany", workplace: null });
  });

  it("drops the workplace words from the place", () => {
    expect(tidyLocation("Remote, US")).toEqual({ location: "US", workplace: "Remote" });
  });

  it("returns Remote for a remote-only job", () => {
    expect(tidyLocation("Remote")).toEqual({ location: "Remote", workplace: "Remote" });
  });

  it("skips street addresses with numbers", () => {
    expect(tidyLocation("12 Main St; Berlin").location).toBe("Berlin");
  });

  it.each(["", null, undefined])("returns an empty location for %s", (value) => {
    expect(tidyLocation(value)).toEqual({ location: "", workplace: null });
  });

  it.each([
    ["Remote", "Remote"],
    ["Hybrid", "Hybrid"],
    ["On-site", "On-site"],
    ["in office", "On-site"]
  ])("detects the workplace model in %s", (text, expected) => {
    expect(tidyLocation(`Berlin ${text}`).workplace).toBe(expected);
  });
});
