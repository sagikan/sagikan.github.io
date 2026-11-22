const ANYWHERE = /\b(anywhere|worldwide|global|emea|europe)\b/i;
// Israel's cities as postings write them (lowercase, without punctuation), with how each is shown
const ISRAEL_CITY_NAMES = {
  "tel aviv": "Tel Aviv", "jerusalem": "Jerusalem", "haifa": "Haifa", "herzliya": "Herzliya", "herzlia": "Herzliya",
  "petah tikva": "Petah Tikva", "petach tikva": "Petah Tikva", "petah tiqva": "Petah Tikva", "ramat gan": "Ramat Gan",
  "raanana": "Ra'anana", "ra anana": "Ra'anana", "netanya": "Netanya", "rehovot": "Rehovot", "beer sheva": "Be'er Sheva",
  "be er sheva": "Be'er Sheva", "beersheba": "Be'er Sheva", "kfar saba": "Kfar Saba", "hod hasharon": "Hod HaSharon",
  "yokneam": "Yokneam", "caesarea": "Caesarea", "airport city": "Airport City", "bnei brak": "Bnei Brak",
  "givatayim": "Givatayim", "holon": "Holon", "rishon lezion": "Rishon LeZion", "rishon le zion": "Rishon LeZion",
  "modiin": "Modi'in", "rosh haayin": "Rosh HaAyin", "rosh ha ayin": "Rosh HaAyin", "or yehuda": "Or Yehuda",
  "lod": "Lod", "ashdod": "Ashdod", "ashkelon": "Ashkelon", "nazareth": "Nazareth", "kiryat gat": "Kiryat Gat",
  "kiryat ono": "Kiryat Ono", "omer": "Omer", "ness ziona": "Ness Ziona", "nes ziona": "Ness Ziona",
  "yavne": "Yavne", "ramat hasharon": "Ramat HaSharon", "ramat ha sharon": "Ramat HaSharon",
  "beit shemesh": "Beit Shemesh", "beit shemes": "Beit Shemesh", "karmiel": "Karmiel", "carmiel": "Karmiel",
  "migdal haemek": "Migdal HaEmek", "migdal ha emek": "Migdal HaEmek", "kiryat shmona": "Kiryat Shmona",
  "sderot": "Sderot", "afula": "Afula", "tiberias": "Tiberias", "eilat": "Eilat", "even yehuda": "Even Yehuda",
  "shoham": "Shoham", "kfar yona": "Kfar Yona", "rosh pina": "Rosh Pina", "misgav": "Misgav", "nesher": "Nesher",
  "tirat carmel": "Tirat Carmel", "yakum": "Yakum", "shefayim": "Shefayim", "glilot": "Glilot", "dimona": "Dimona",
  "ariel": "Ariel", "matam": "Haifa"
};
// Israel's places in Hebrew, with their names as postings write them in English
const ISRAEL_LOCAL_NAMES = [
  ["תל אביב", "tel aviv"], ["תל-אביב", "tel aviv"], ["ת\"א", "tel aviv"], ["ירושלים", "jerusalem"], ["חיפה", "haifa"],
  ["הרצליה", "herzliya"], ["פתח תקווה", "petah tikva"], ["פתח תקוה", "petah tikva"], ["פ\"ת", "petah tikva"],
  ["רמת גן", "ramat gan"], ["רעננה", "raanana"], ["נתניה", "netanya"], ["רחובות", "rehovot"], ["באר שבע", "beer sheva"],
  ["כפר סבא", "kfar saba"], ["הוד השרון", "hod hasharon"], ["יקנעם", "yokneam"], ["קיסריה", "caesarea"],
  ["איירפורט סיטי", "airport city"], ["בני ברק", "bnei brak"], ["גבעתיים", "givatayim"], ["חולון", "holon"],
  ["ראשון לציון", "rishon lezion"], ["מודיעין", "modiin"], ["ראש העין", "rosh haayin"], ["אור יהודה", "or yehuda"],
  ["לוד", "lod"], ["אשדוד", "ashdod"], ["אשקלון", "ashkelon"], ["נצרת", "nazareth"], ["קרית גת", "kiryat gat"],
  ["קריית גת", "kiryat gat"], ["קרית אונו", "kiryat ono"], ["קריית אונו", "kiryat ono"], ["עומר", "omer"],
  ["נס ציונה", "ness ziona"], ["יבנה", "yavne"], ["רמת השרון", "ramat hasharon"], ["בית שמש", "beit shemesh"],
  ["כרמיאל", "karmiel"], ["מגדל העמק", "migdal haemek"], ["קרית שמונה", "kiryat shmona"],
  ["קריית שמונה", "kiryat shmona"], ["שדרות", "sderot"], ["עפולה", "afula"], ["טבריה", "tiberias"], ["אילת", "eilat"],
  ["אבן יהודה", "even yehuda"], ["שוהם", "shoham"], ["כפר יונה", "kfar yona"], ["ראש פינה", "rosh pina"],
  ["משגב", "misgav"], ["נשר", "nesher"], ["טירת כרמל", "tirat carmel"], ["יקום", "yakum"], ["שפיים", "shefayim"],
  ["גלילות", "glilot"], ["דימונה", "dimona"], ["אריאל", "ariel"], ["ישראל", "israel"]
];
/* Each region that location matching knows, under the name postings write it as: the name it's shown with, its cities,
   and its places in the local language with that language's letters. A posting naming only a city then counts as in its
   country. To add a country, give it an entry here */
const REGIONS = {
  israel: { name: "Israel", cities: ISRAEL_CITY_NAMES, localNames: ISRAEL_LOCAL_NAMES, localLetters: "\\u05d0-\\u05ea" }
};
/* The regions the job feeds collect jobs for, by their names in REGIONS. Each source that serves only some regions (the
   Israeli Tech Map) says which */
const FEED_REGIONS = ["Israel"];
// Each region's places: the region itself and its cities
const REGION_PLACES = Object.entries(REGIONS).map(([key, region]) => [key, ...Object.keys(region.cities)]);
/* Each region's local place names, turned into the English ones before matching (longer names first). A name counts only
   as a whole word, so a longer word that contains it is left alone */
const LOCAL_NAMES = Object.values(REGIONS).map((region) => ({
  letters: new RegExp(`[${region.localLetters}]`),
  names: [...region.localNames]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([local, english]) => [new RegExp(`(?<![${region.localLetters}])${local}(?![${region.localLetters}])`, "g"), ` ${english} `])
}));
const WORKPLACE_WORDS = /\b(on[\s-]?site|onsite|in[\s-]?office|hybrid|remote)\b/gi;
// Normalized place texts kept, and how many before the store starts afresh (so it can't grow without bound)
const NORMALIZED = new Map();
const NORMALIZED_LIMIT = 5000;
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
// Country names, and common short forms, with their two-letter codes
const COUNTRY_CODES = countryCodes();
const FEED_AREAS = areasFor(FEED_REGIONS);

// Lists every country's English name with its two-letter code, from the codes Node knows, plus common short forms
function countryCodes() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const codes = { usa: "us", us: "us", uk: "gb", england: "gb", "great britain": "gb" };

  for (const first of letters) {
    for (const second of letters) {
      const name = countryNames.of(first + second);

      if (name && name !== first + second && !/unknown/i.test(name)) {
        codes[name.toLowerCase()] ??= (first + second).toLowerCase();
      }
    }
  }

  return codes;
}

// Turns a two-letter country code into its English name
function countryName(code) {
  try {
    return code ? countryNames.of(String(code).toUpperCase()) : "";
  } catch {
    return code || "";
  }
}

// Finds the two-letter code of the country a place name ends with, or null
function countryCode(place) {
  return COUNTRY_CODES[String(place || "").split(",").pop().trim().toLowerCase()] || null;
}

// Turns place names in the regions' local languages into their English names
function fromLocalNames(text) {
  return LOCAL_NAMES.reduce(
    (value, region) => (region.letters.test(value) ? region.names.reduce((result, [pattern, english]) => result.replace(pattern, english), value) : value),
    String(text || "")
  );
}

/* Lowercases text, removes accents, writes TLV out as Tel Aviv and pads it with spaces. The same few places fill most
   postings, so results are kept, up to NORMALIZED_LIMIT of them */
function normalize(text) {
  const key = String(text || "");

  if (!NORMALIZED.has(key)) {
    if (NORMALIZED.size >= NORMALIZED_LIMIT) NORMALIZED.clear();
    NORMALIZED.set(key, ` ${fromLocalNames(key).toLowerCase().normalize("NFKD").replace(/[^a-z]+/g, " ").trim()} `.replace(/ tlv /g, " tel aviv "));
  }

  return NORMALIZED.get(key);
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

      // A country, or one of its cities, widens to all of the country's places
      for (const places of REGION_PLACES.filter((list) => list.includes(part))) {
        places.forEach((place) => regions.add(place));
      }
    }
  }

  return { cities: [...cities], regions: [...regions] };
}

// Checks whether a place is in the regions the job feeds collect, by its city or country (being remote doesn't count)
function inFeedRegions(place) {
  const text = normalize(place);

  return [...FEED_AREAS.cities, ...FEED_AREAS.regions].some((name) => text.includes(` ${name} `));
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

// Finds the cities of a region named in text, shown by their names, in the order they appear
function citiesIn(words, region) {
  return Object.entries(region.cities)
    .map(([key, name]) => ({ name, at: words.indexOf(` ${key} `) }))
    .filter((city) => city.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((city) => city.name)
    .filter((name, index, all) => all.indexOf(name) === index);
}

// Cleans a job's location into a readable place name
function tidyLocation(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const workplace = workplaceIn(text);
  const words = normalize(text);

  for (const [key, region] of Object.entries(REGIONS)) {
    const cities = citiesIn(words, region);

    if (cities.length) {
      return { location: `${cities.slice(0, 2).join(" / ")}, ${region.name}`, workplace };
    }

    if (words.includes(` ${key} `)) {
      return { location: region.name, workplace };
    }
  }

  const first = fromLocalNames(text)
    .replace(WORKPLACE_WORDS, " ")
    .split(/[.;|]|\b(?:office|address)\s*:/i)
    .map((part) => part.replace(/^[\s,:\-–—()]+|[\s,:\-–—()]+$/g, "").replace(/\s+/g, " "))
    .find((part) => part && !/\d/.test(part));

  return { location: first || (workplace === "Remote" ? "Remote" : ""), workplace };
}

module.exports = { FEED_REGIONS, FEED_AREAS, areasFor, areaScore, countryCode, countryName, inFeedRegions, tidyLocation };
