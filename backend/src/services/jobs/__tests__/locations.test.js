import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { FEED_AREAS, FEED_REGIONS, areaScore, areasFor, countryCode, countryName, inFeedRegions, tidyLocation } = require("../locations");

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

  it("widens a city alone to all of its country's places", () => {
    expect(areasFor(["Haifa"]).regions).toEqual(expect.arrayContaining(["haifa", "israel", "tel aviv"]));
  });

  it("returns nothing for no locations", () => {
    expect(areasFor([])).toEqual({ cities: [], regions: [] });
  });
});

describe("countryCode", () => {
  it.each([
    ["a country", "Israel", "il"],
    ["the country after a city", "Haifa, Israel", "il"],
    ["a country no list names by hand", "Estonia", "ee"],
    ["a country with a long name", "United States", "us"],
    ["a short form", "Tel Aviv, USA", "us"],
    ["the UK", "London, UK", "gb"],
    ["a city alone", "Haifa", null],
    ["nothing", "", null]
  ])("finds the code of %s", (_title, place, expected) => {
    expect(countryCode(place)).toBe(expected);
  });
});

describe("countryName", () => {
  it.each([
    ["a code", "IL", "Israel"],
    ["a code in lowercase", "pl", "Poland"],
    ["nothing", "", ""],
    ["a value that isn't a code", "not a code", "not a code"]
  ])("names the country of %s", (_title, code, expected) => {
    expect(countryName(code)).toBe(expected);
  });
});

describe("FEED_REGIONS", () => {
  it("collects jobs in Israel only", () => {
    expect(FEED_REGIONS).toEqual(["Israel"]);
  });
});

describe("FEED_AREAS", () => {
  it("holds the feed regions widened to their places", () => {
    expect(FEED_AREAS).toEqual(areasFor(FEED_REGIONS));
    expect(FEED_AREAS.regions).toEqual(expect.arrayContaining(["israel", "haifa", "yokneam"]));
  });
});

describe("inFeedRegions", () => {
  it.each([
    ["a country in the regions", "Israel", true],
    ["a city in them", "Tel Aviv-Yafo", true],
    ["a city and country", "Haifa, Israel", true],
    ["a place in Hebrew", "ירושלים", true],
    ["a place elsewhere", "Berlin, Germany", false],
    ["a remote job", "Remote", false],
    ["a worldwide job", "Anywhere", false],
    ["nothing", "", false]
  ])("treats %s as in them: %s", (_title, place, expected) => {
    expect(inFeedRegions(place)).toBe(expected);
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

  it.each([
    ["a Hebrew city name", "תל אביב-יפו", 2],
    ["another Hebrew city", "יקנעם עילית", 1],
    ["Israel in Hebrew", "ישראל", 1],
    ["the TLV short name", "TLV", 2],
    ["a city added to the list", "Ness Ziona, Israel", 1],
    ["a Hebrew word that only contains a city's name", "מיקום", 0]
  ])("scores %s", (_title, location, expected) => {
    expect(areaScore(location, areas)).toBe(expected);
  });

  it("doesn't read IL as Israel, since it is also Illinois", () => {
    expect(areaScore("Chicago, IL", areas)).toBe(0);
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

  it.each([
    ["תל אביב - יפו", "Tel Aviv, Israel"],
    ["פתח תקווה", "Petah Tikva, Israel"],
    ["TLV office", "Tel Aviv, Israel"],
    ["Yavne, Israel", "Yavne, Israel"],
    ["ישראל", "Israel"]
  ])("names the place in %s", (raw, expected) => {
    expect(tidyLocation(raw).location).toBe(expected);
  });

  it("shows a known business park by its city", () => {
    expect(tidyLocation("MATAM, Israel").location).toBe("Haifa, Israel");
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
