const ISRAEL_PLACES = [
  "israel", "tel aviv", "jerusalem", "haifa", "herzliya", "herzlia", "petah tikva", "petach tikva", "petah tiqva",
  "ramat gan", "raanana", "ra anana", "netanya", "rehovot", "beer sheva", "be er sheva", "beersheba", "kfar saba",
  "hod hasharon", "yokneam", "caesarea", "airport city", "bnei brak", "givatayim", "holon", "rishon lezion",
  "rishon le zion", "modiin", "rosh haayin", "rosh ha ayin", "or yehuda", "lod", "ashdod", "ashkelon", "nazareth",
  "kiryat gat", "kiryat ono", "omer", "matam"
];
const ANYWHERE = /\b(anywhere|worldwide|global|emea|europe)\b/i;
const ISRAEL_CITY_NAMES = {
  "tel aviv": "Tel Aviv", "jerusalem": "Jerusalem", "haifa": "Haifa", "herzliya": "Herzliya", "herzlia": "Herzliya",
  "petah tikva": "Petah Tikva", "petach tikva": "Petah Tikva", "petah tiqva": "Petah Tikva", "ramat gan": "Ramat Gan",
  "raanana": "Ra'anana", "ra anana": "Ra'anana", "netanya": "Netanya", "rehovot": "Rehovot", "beer sheva": "Be'er Sheva",
  "be er sheva": "Be'er Sheva", "beersheba": "Be'er Sheva", "kfar saba": "Kfar Saba", "hod hasharon": "Hod HaSharon",
  "yokneam": "Yokneam", "caesarea": "Caesarea", "airport city": "Airport City", "bnei brak": "Bnei Brak",
  "givatayim": "Givatayim", "holon": "Holon", "rishon lezion": "Rishon LeZion", "rishon le zion": "Rishon LeZion",
  "modiin": "Modi'in", "rosh haayin": "Rosh HaAyin", "rosh ha ayin": "Rosh HaAyin", "or yehuda": "Or Yehuda",
  "lod": "Lod", "ashdod": "Ashdod", "ashkelon": "Ashkelon", "nazareth": "Nazareth", "kiryat gat": "Kiryat Gat",
  "kiryat ono": "Kiryat Ono", "omer": "Omer"
};
const WORKPLACE_WORDS = /\b(on[\s-]?site|onsite|in[\s-]?office|hybrid|remote)\b/gi;

// Lowercases text, removes accents and pads it with spaces
function normalize(text) {
  return ` ${String(text || "").toLowerCase().normalize("NFKD").replace(/[^a-z]+/g, " ").trim()} `;
}

// Finds the cities and regions for the wanted locations
function areasFor(locations) {
  const cities = new Set();
  const regions = new Set();

  for (const location of locations) {
    const parts = String(location).split(",").map(normalize).map((part) => part.trim()).filter(Boolean);

    if (parts.length > 1) {
      cities.add(parts[0]);
    }

    for (const part of parts.slice(parts.length > 1 ? 1 : 0)) {
      regions.add(part);

      if (part === "israel" || ISRAEL_PLACES.includes(part)) {
        ISRAEL_PLACES.forEach((place) => regions.add(place));
      }
    }
  }

  return { cities: [...cities], regions: [...regions] };
}

// Scores how well a job's location matches the wanted areas
function areaScore(jobLocation, areas) {
  const text = normalize(jobLocation);

  if (areas.cities.some((city) => text.includes(` ${city} `))) return 2;
  if (areas.regions.some((region) => text.includes(` ${region} `))) return 1;
  if (ANYWHERE.test(jobLocation) || /^\s*remote\s*$/i.test(jobLocation)) return 1;

  return 0;
}

// Detects the workplace model from text
function workplaceIn(text) {
  if (/\bremote\b/i.test(text)) return "Remote";
  if (/\bhybrid\b/i.test(text)) return "Hybrid";
  if (/\b(on[\s-]?site|onsite|in[\s-]?office)\b/i.test(text)) return "On-site";

  return null;
}

// Cleans a job's location into a readable place name
function tidyLocation(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const workplace = workplaceIn(text);
  const words = normalize(text);
  const cities = Object.entries(ISRAEL_CITY_NAMES)
    .map(([key, name]) => ({ name, at: words.indexOf(` ${key} `) }))
    .filter((city) => city.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((city) => city.name)
    .filter((name, index, all) => all.indexOf(name) === index);

  if (cities.length) {
    return { location: `${cities.slice(0, 2).join(" / ")}, Israel`, workplace };
  }

  if (words.includes(" israel ")) {
    return { location: "Israel", workplace };
  }

  const first = text
    .replace(WORKPLACE_WORDS, " ")
    .split(/[.;|]|\b(?:office|address)\s*:/i)
    .map((part) => part.replace(/^[\s,:\-–—()]+|[\s,:\-–—()]+$/g, "").replace(/\s+/g, " "))
    .find((part) => part && !/\d/.test(part));

  return { location: first || (workplace === "Remote" ? "Remote" : ""), workplace };
}

module.exports = { areasFor, areaScore, tidyLocation };
