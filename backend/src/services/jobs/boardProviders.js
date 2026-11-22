const { htmlToText } = require("../shared/htmlText");
const { safeFetch } = require("../shared/safeFetch");
const { areaScore, countryName } = require("./locations");

const JSEARCH_PAGES = Math.min(5, Math.max(1, Number(process.env.JSEARCH_PAGES) || 1));
const JSEARCH_HOST = "jsearch.p.rapidapi.com";
const RETRY_MS = 5000;
const MAX_PAGES = 5;
// Workday returns at most 20 postings a request, and turns away requests that come too close together
const WORKDAY_PAGE = 20;
const WORKDAY_GAP_MS = 1000;
const WORKDAY_RETRIES = 2;
/* Every job system the feeds read, each declaring all that the rest of the code needs to know about it:
   - url, parse (and nextUrl, lightUrl, details, fetchJobs, format, headers, redirectGone, refreshHours, aggregator):
     how to read a board
   - hosts: the sites its boards and postings live on (a posting there needs no closed check)
   - links: patterns that find its boards in links and pages, capturing the board's token; linkToken builds a token
     captured in parts, and tokenFormat checks a token that isn't a plain name
   - probe: whether a board can be found by trying a company's likely names
   - discoverySite: the site Claude's web search looks on for boards
   A new system also needs adding to job_boards_provider_check in schema.sql (a test checks the two match) */
const PROVIDERS = {
  greenhouse: {
    hosts: ["greenhouse.io"],
    links: [
      /(?:job-boards|boards)\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([A-Za-z0-9_-]+)/gi,
      /(?:boards-api|api)\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/gi
    ],
    probe: true,
    discoverySite: "job-boards.greenhouse.io",
    url: (token) => `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
    // The list without descriptions, much smaller, which is enough to check a guessed board
    lightUrl: (token) => `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`,
    parse: (data, board) => (data?.jobs || []).map((job) => ({
      externalId: String(job.id),
      company: job.company_name || board.company,
      title: job.title,
      location: job.location?.name || "",
      workplace: workplaceFrom(job.location?.name),
      url: job.absolute_url,
      description: htmlToText(job.content),
      postedAt: toDate(job.first_published || job.updated_at)
    }))
  },
  lever: {
    hosts: ["lever.co"],
    links: [/(?:jobs\.lever\.co|api\.lever\.co\/v0\/postings)\/([A-Za-z0-9._-]+)/gi],
    probe: true,
    discoverySite: "jobs.lever.co",
    url: (token) => `https://api.lever.co/v0/postings/${token}?mode=json`,
    parse: (data, board) => (Array.isArray(data) ? data : []).map((job) => ({
      externalId: job.id,
      company: board.company,
      title: job.text,
      location: (job.categories?.allLocations || [job.categories?.location]).filter(Boolean).join(" / "),
      workplace: { onsite: "On-site", hybrid: "Hybrid", remote: "Remote" }[job.workplaceType] || workplaceFrom(job.categories?.location),
      url: job.hostedUrl,
      description: [
        job.descriptionPlain,
        ...(job.lists || []).map((list) => `${list.text}\n${htmlToText(list.content)}`),
        job.additionalPlain
      ].filter(Boolean).join("\n\n"),
      postedAt: toDate(job.createdAt)
    }))
  },
  ashby: {
    hosts: ["ashbyhq.com"],
    links: [/(?:jobs\.ashbyhq\.com|api\.ashbyhq\.com\/posting-api\/job-board)\/([A-Za-z0-9._%-]+)/gi],
    probe: true,
    discoverySite: "jobs.ashbyhq.com",
    url: (token) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=false`,
    parse: (data, board) => (data?.jobs || []).filter((job) => job.isListed !== false).map((job) => ({
      externalId: job.id,
      company: board.company,
      title: job.title,
      location: [job.location, ...(job.secondaryLocations || []).map((other) => other.location)].filter(Boolean).join(" / "),
      workplace: { OnSite: "On-site", Hybrid: "Hybrid", Remote: "Remote" }[job.workplaceType] || (job.isRemote ? "Remote" : null),
      url: job.jobUrl,
      description: job.descriptionPlain || htmlToText(job.descriptionHtml),
      postedAt: toDate(job.publishedAt)
    }))
  },
  comeet: {
    hosts: ["comeet.com", "comeet.co"],
    // A Comeet board is the company's name and its code, such as tripleten/98.008
    links: [/comeet\.com?\/jobs\/([A-Za-z0-9._-]+\/[0-9A-F]{2}\.[0-9A-F]{3})/gi],
    tokenFormat: /^[A-Za-z0-9._-]{1,80}\/[0-9A-F]{2}\.[0-9A-F]{3}$/i,
    discoverySite: "comeet.com/jobs",
    format: "html",
    // Its pages are about 2 MB, and its companies post less often than the bigger systems' do
    refreshHours: 24,
    url: (token) => `https://www.comeet.com/jobs/${token}`,
    // A name that no longer matches the company's code (a renamed company) sends the page to Comeet's home page
    redirectGone: (url, token) => !pathOf(url).split("/").includes(token.split("/")[1].toLowerCase()),
    parse: (page, board) => [jsonAfter(page, "COMPANY_POSITIONS_DATA")].flat().filter((job) => job?.uid && !job.is_internal).map((job) => ({
      externalId: job.uid,
      company: job.company_name || board.company,
      title: job.name,
      location: [job.location?.city, countryName(job.location?.country)].filter(Boolean).join(", ") || job.location?.name || "",
      workplace: workplaceName(job.workplace_type) || (job.location?.is_remote ? "Remote" : null),
      url: job.url_comeet_hosted_page || job.url_active_page,
      description: (job.custom_fields?.details || [])
        .map((part) => [part?.name, htmlToText(part?.value)].filter(Boolean).join("\n"))
        .filter(Boolean)
        .join("\n\n"),
      postedAt: toDate(job.time_updated)
    }))
  },
  workable: {
    hosts: ["workable.com"],
    links: [/apply\.workable\.com\/(?:api\/v\d+\/(?:widget\/)?accounts\/)?([A-Za-z0-9_-]+)/gi, /\/\/([a-z0-9-]+)\.workable\.com/gi],
    probe: true,
    discoverySite: "apply.workable.com",
    url: (token) => `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}?details=true`,
    parse: (data, board) => (data?.jobs || []).map((job) => ({
      externalId: job.shortcode,
      company: data.name || board.company,
      title: job.title,
      location: (job.locations?.length ? job.locations.filter((place) => !place.hidden) : [job])
        .map((place) => [place.city, place.country].filter(Boolean).join(", "))
        .filter(Boolean)
        .join(" / "),
      workplace: job.telecommuting ? "Remote" : null,
      url: job.shortlink || job.url,
      description: htmlToText(job.description),
      postedAt: toDate(job.published_on || job.created_at)
    }))
  },
  smartrecruiters: {
    hosts: ["smartrecruiters.com"],
    links: [/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/gi],
    probe: true,
    discoverySite: "jobs.smartrecruiters.com",
    url: (token) => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100`,
    nextUrl: (data, token) => {
      const offset = (Number(data?.offset) || 0) + (data?.content?.length || 0);

      return data?.content?.length && offset < Number(data?.totalFound)
        ? `${PROVIDERS.smartrecruiters.url(token)}&offset=${offset}`
        : null;
    },
    parse: (data, board) => (data?.content || []).filter((job) => job.visibility !== "INTERNAL").map((job) => ({
      externalId: job.id,
      company: job.company?.name || board.company,
      title: job.name,
      // The city field sometimes holds the country, so a repeated part is left out
      location: [...new Set([job.location?.city, countryName(job.location?.country)].filter(Boolean))].join(", "),
      workplace: job.location?.remote ? "Remote" : job.location?.hybrid ? "Hybrid" : null,
      url: `https://jobs.smartrecruiters.com/${encodeURIComponent(job.company?.identifier || board.token)}/${encodeURIComponent(job.id)}`,
      description: "",
      postedAt: toDate(job.releasedDate)
    })),
    // The list leaves the description out, so it comes from each posting
    details: {
      url: (job, board) =>
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board.token)}/postings/${encodeURIComponent(job.externalId)}`,
      parse: (data) => Object.entries(data?.jobAd?.sections || {})
        .filter(([key]) => key !== "companyDescription")
        .map(([, section]) => [section?.title, htmlToText(section?.text)].filter(Boolean).join("\n"))
        .filter(Boolean)
        .join("\n\n")
    }
  },
  recruitee: {
    hosts: ["recruitee.com"],
    links: [/\/\/([a-z0-9-]+)\.recruitee\.com/gi],
    probe: true,
    url: (token) => `https://${token}.recruitee.com/api/offers/`,
    parse: (data, board) => (data?.offers || []).filter((job) => !job.status || job.status === "published").map((job) => ({
      externalId: String(job.id ?? ""),
      company: job.company_name || board.company,
      title: job.title,
      location: job.location || [job.city, job.country].filter(Boolean).join(", "),
      workplace: job.remote ? "Remote" : job.hybrid ? "Hybrid" : job.on_site ? "On-site" : null,
      url: job.careers_url,
      description: [htmlToText(job.description), htmlToText(job.requirements)].filter(Boolean).join("\n\n"),
      postedAt: toDate(String(job.published_at || job.created_at || "").replace(" UTC", "Z").replace(" ", "T"))
    }))
  },
  bamboohr: {
    hosts: ["bamboohr.com"],
    links: [/\/\/([a-z0-9-]+)\.bamboohr\.com/gi],
    probe: true,
    url: (token) => `https://${token}.bamboohr.com/careers/list`,
    // A company that left BambooHR is sent to BambooHR's home page
    redirectGone: (url, token) => hostOf(url) !== `${token.toLowerCase()}.bamboohr.com`,
    parse: (data, board) => (data?.result || []).map((job) => ({
      externalId: String(job.id ?? ""),
      company: board.company,
      title: job.jobOpeningName,
      location: [job.location?.city, job.location?.state, job.atsLocation?.country].filter(Boolean).join(", "),
      workplace: job.isRemote ? "Remote" : null,
      url: `https://${board.token}.bamboohr.com/careers/${encodeURIComponent(job.id)}`,
      description: "",
      postedAt: null
    })),
    // The list leaves the description out, so it comes from each posting
    details: {
      url: (job, board) => `https://${board.token}.bamboohr.com/careers/${encodeURIComponent(job.externalId)}/detail`,
      parse: (data) => htmlToText(data?.result?.jobOpening?.description)
    }
  },
  workday: {
    hosts: ["myworkdayjobs.com"],
    // A Workday board is the company's host and its site, after an optional language (en-US) or its feed's path
    links: [/\/\/([a-z0-9-]+\.wd\d{1,3})\.myworkdayjobs\.com\/(?:[a-z]{2}-[a-z]{2}\/|wday\/cxs\/[a-z0-9-]+\/)?([A-Za-z0-9_-]+)/gi],
    linkToken: (match) => `${match[1]}/${match[2]}`,
    tokenFormat: /^[a-z0-9-]{1,80}\.wd\d{1,3}\/[A-Za-z0-9_-]{1,80}$/i,
    fetchJobs: workdayJobs,
    // The list leaves the description out, so it comes from each posting
    details: {
      options: { safe: true },
      url: (job, board) => `${workdayAddress(board.token).api}${job.externalId}`,
      parse: (data) => htmlToText(data?.jobPostingInfo?.jobDescription)
    }
  },
  jsearch: {
    aggregator: true,
    url: (token) => {
      const [query, country] = token.split("|");
      const params = new URLSearchParams({ query, page: "1", num_pages: String(JSEARCH_PAGES), date_posted: "month" });
      if (country) params.set("country", country);

      return `https://${JSEARCH_HOST}/search-v2?${params}`;
    },
    headers: () => ({ "X-RapidAPI-Key": process.env.JSEARCH_API_KEY, "X-RapidAPI-Host": JSEARCH_HOST }),
    // /search-v2 returns the jobs in data.jobs; the old /search returned them in data
    parse: (data) => [data?.data?.jobs, data?.data].find(Array.isArray)?.map((job) => ({
      externalId: job.job_id,
      company: job.employer_name,
      title: job.job_title,
      location: [job.job_city, job.job_state, countryName(job.job_country)].filter(Boolean).join(", ") || job.job_location || "",
      workplace: job.job_is_remote ? "Remote" : workplaceFrom(job.job_title),
      url: jsearchLink(job),
      description: unwrap(job.job_description),
      expiresAt: toDate(job.job_offer_expiration_datetime_utc ||
        (job.job_offer_expiration_timestamp && job.job_offer_expiration_timestamp * 1000)),
      postedAt: toDate(job.job_posted_at_datetime_utc || (job.job_posted_at_timestamp && job.job_posted_at_timestamp * 1000))
    })) || []
  }
};

// Detects a remote or hybrid workplace from text
function workplaceFrom(text) {
  if (/\bremote\b/i.test(text || "")) return "Remote";
  if (/\bhybrid\b/i.test(text || "")) return "Hybrid";

  return null;
}

// Turns a workplace type such as "on_site" into its name
function workplaceName(value) {
  const text = String(value || "");

  if (/remote/i.test(text)) return "Remote";
  if (/hybrid/i.test(text)) return "Hybrid";
  if (/on.?site|office/i.test(text)) return "On-site";

  return null;
}

// Reads the JSON value assigned to a name in a page's script (the page may declare the name empty first)
function jsonAfter(page, name) {
  const text = String(page || "");
  const match = new RegExp(`\\b${name}\\s*=\\s*[[{]`).exec(text);

  if (!match) {
    return null;
  }

  const start = match.index + match[0].length - 1;
  let depth = 0;
  let inString = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (char === "\\") index++;
      else if (char === "\"") inString = false;
    } else if (char === "\"") {
      inString = true;
    } else if (char === "[" || char === "{") {
      depth++;
    } else if ((char === "]" || char === "}") && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

// Turns a date value into an ISO string, or null
function toDate(value) {
  const date = value ? new Date(value) : null;

  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

// Joins words split across lines and removes empty lines
function unwrap(text) {
  return String(text || "")
    .replace(/([a-z])(?:\r?\n)+\r?([a-z])/g, "$1$2")
    .replace(/(?:\r?\n\r?)+/g, "\n")
    .trim();
}

// Picks the best apply link for a JSearch job
function jsearchLink(job) {
  const direct = (job.apply_options || []).find((option) => option?.is_direct && option.apply_link);

  return direct?.apply_link || job.job_apply_link || job.job_google_link;
}

// Returns a URL's host name in lowercase, or an empty string
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// Returns a URL's path in lowercase, without its query or hash, or an empty string
function pathOf(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

// Splits a Workday board token (company.wd5/Site) into its API and public addresses
function workdayAddress(token) {
  const [host, site] = token.split("/");
  const tenant = host.split(".")[0];

  return {
    api: `https://${host}.myworkdayjobs.com/wday/cxs/${tenant}/${site}`,
    page: `https://${host}.myworkdayjobs.com/${site}`
  };
}

/* Picks the location filter of a Workday board that holds the most jobs in the wanted areas. Workday filters by its own
   IDs for places, and a board may group them in more than one way (countries, cities), sometimes as groups inside one
   filter, each with its own name */
function workdayFilter(facets, areas) {
  const groups = (facets || []).flatMap((facet) => {
    const nested = (facet.values || []).filter((value) => value.facetParameter && Array.isArray(value.values));

    return nested.length ? nested : [facet];
  });
  let best = null;

  for (const facet of groups) {
    const values = facet.values || [];
    const matched = /location/i.test(facet.facetParameter || "") ? values.filter((value) => value.id && areaScore(value.descriptor, areas) > 0) : [];
    const count = matched.reduce((sum, value) => sum + (Number(value.count) || 0), 0);

    if (matched.length && (!best || count > best.count)) {
      best = { count, facets: { [facet.facetParameter]: matched.map((value) => value.id) }, places: matched.map((value) => value.descriptor) };
    }
  }

  return best;
}

// Turns Workday's "Posted 3 Days Ago" into a day, at midnight so that it reads the same all day
function workdayPosted(text) {
  const value = String(text || "");
  const days = /today/i.test(value) ? 0 : /yesterday/i.test(value) ? 1 : Number(/(\d+)\+?\s+days?/i.exec(value)?.[1]);

  if (!Number.isFinite(days)) {
    return null;
  }

  const date = new Date(Date.now() - days * 86_400_000);
  date.setUTCHours(0, 0, 0, 0);

  return date.toISOString();
}

/* Reads a Workday board's postings in the wanted areas. A first request reads the board's location filters; a board
   with none in the wanted areas has nothing to read */
async function workdayJobs(board, areas) {
  const { api, page } = workdayAddress(board.token);
  const first = await fetchPatiently(`${api}/jobs`, { safe: true, body: { appliedFacets: {}, limit: 1, offset: 0, searchText: "" } }, WORKDAY_RETRIES);

  if (first.gone) {
    return { gone: true, jobs: [] };
  }

  const filter = areas ? workdayFilter(first.data?.facets, areas) : { facets: {}, places: [] };
  const jobs = [];

  for (let index = 0; filter && index < MAX_PAGES; index++) {
    await sleep(WORKDAY_GAP_MS);
    const { data } = await fetchPatiently(`${api}/jobs`, {
      safe: true,
      body: { appliedFacets: filter.facets, limit: WORKDAY_PAGE, offset: index * WORKDAY_PAGE, searchText: "" }
    }, WORKDAY_RETRIES);
    const postings = data?.jobPostings || [];

    jobs.push(...postings.map((job) => ({
      externalId: job.externalPath,
      company: board.company,
      title: job.title,
      // A job in several places shows only how many, so it gets the board's places in the wanted areas
      location: /^\d+ locations?$/i.test(job.locationsText || "") ? filter.places.join(" / ") : job.locationsText || "",
      workplace: workplaceFrom(job.locationsText),
      url: `${page}${job.externalPath}`,
      description: "",
      postedAt: workdayPosted(job.postedOn)
    })));

    if (postings.length < WORKDAY_PAGE) break;
  }

  return { gone: false, jobs };
}

/* Fetches JSON, or a page's text, sending `body` as JSON when given, and reports a 404 as gone. Some job systems send
   an unknown board to their home page instead: `redirectGone` tells from the final address whether a redirect means that.
   `safe` sends the request through the safe fetch, whose connections Workday accepts where it turns Node's fetch away */
async function fetchData(url, { headers = {}, format = "json", body, redirectGone, safe = false } = {}) {
  const allHeaders = {
    Accept: format === "html" ? "text/html" : "application/json",
    "Accept-Language": "en-US",
    "User-Agent": "ApplicantZero/1.0",
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...headers
  };
  const json = body ? JSON.stringify(body) : undefined;
  const response = safe
    ? await safeFetch(url, { headers: allHeaders, body: json, timeoutMs: 20_000 })
    : await fetch(url, { method: body ? "POST" : "GET", headers: allHeaders, body: json, signal: AbortSignal.timeout(20_000) });
  const redirected = safe ? response.url !== new URL(url).href : response.redirected;

  if (response.status === 404 || (redirected && redirectGone?.(response.url))) {
    return { gone: true };
  }

  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  }

  if (format === "html") {
    return { data: await response.text() };
  }

  return { data: safe ? JSON.parse(await response.text()) : await response.json() };
}

// Waits for the given number of milliseconds
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetches, retrying when rate limited, waiting RETRY_MS longer each time (JSearch once, Workday twice)
async function fetchPatiently(url, options, retries = 1) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchData(url, options);
    } catch (err) {
      if (err.status !== 429 || attempt >= retries) throw err;
      await sleep(RETRY_MS * (attempt + 1));
    }
  }
}

/* Fetches a board's pages and reads their postings, reporting a board that no longer exists as gone. A system that
   filters by place on its side (Workday) gets the wanted areas. `light` asks for a smaller list where the system has one,
   for checking a board rather than storing its postings */
async function fetchPostings(provider, board, areas = null, { light = false } = {}) {
  if (provider.fetchJobs) {
    return provider.fetchJobs(board, areas);
  }

  const fetcher = provider.aggregator ? fetchPatiently : fetchData;
  const redirectGone = provider.redirectGone && ((url) => provider.redirectGone(url, board.token));
  const jobs = [];
  let url = light && provider.lightUrl ? provider.lightUrl(board.token) : provider.url(board.token);

  for (let page = 0; url && page < MAX_PAGES; page++) {
    const { gone, data } = await fetcher(url, { headers: provider.headers?.(), format: provider.format, redirectGone });

    if (gone) {
      return { gone: true, jobs: [] };
    }

    jobs.push(...provider.parse(data, board));
    url = provider.nextUrl?.(data, board.token) || null;
  }

  return { gone: false, jobs };
}

module.exports = { PROVIDERS, fetchData, fetchPostings, sleep };
