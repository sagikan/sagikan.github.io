const db = require("../../config/db");
const { eachLimited } = require("../shared/eachLimited");
const { boardsIn } = require("./boardLinks");
const { comeetBoard, nameGuesses, probeBoard } = require("./boardProbe");
const { readCareersPage } = require("./careersPage");

/* Israeli Tech Map (https://github.com/mluggy/techmap) by Michael Lugassy, under the Open Database License.
   Only the company boards are read from it: its job lists for their board links and for which companies are hiring,
   and its company files for their board IDs, careers pages, names and websites. It covers one region, so its import runs
   only while the feeds collect that region */
const REGION = "Israel";
const REPO = "mluggy/techmap";
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`;
// The repository's job lists (one per field) and company files, found in its file listing
const JOB_LIST = /^jobs\/[\w-]+\.csv$/;
const COMPANY_FILE = /^companies\/[\w-]+\.json$/;
// The company name that starts each row of a job list
const LIST_COMPANY = /^﻿?"([^"]*)"/;
const BOARD_ID = /^[\w.-]{1,80}$/;
const COMEET_ID = /^[\w.-]{1,80}\/[0-9A-F]{2}\.[0-9A-F]{3}$/i;
const COMPANY_BATCH = 2000;
const CAREERS_BATCH = 400;
const PROBE_BATCH = 500;
const RECHECK_DAYS = 90;
const CONCURRENCY = 8;
const MAX_LINK = 500;
const MAX_NAME = 200;
const HEADERS = { "User-Agent": "ApplicantZero/1.0" };

// Fetches a text file, or returns an empty string when it fails
async function fetchText(url) {
  try {
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });

    return response.ok ? await response.text() : "";
  } catch {
    return "";
  }
}

// Returns a link that is a plain http(s) link, or null
function plainLink(value) {
  try {
    const url = new URL(String(value || ""));

    return ["http:", "https:"].includes(url.protocol) && url.href.length <= MAX_LINK ? url.href : null;
  } catch {
    return null;
  }
}

// Reads a company file: its boards, its careers page when that isn't a board itself, its name and its website
function companyBoards(company) {
  if (!company || company.isActive === false) {
    return { boards: [], careersUrl: null, name: null, website: null };
  }

  const links = [
    COMEET_ID.test(company.comeetId || "") && `https://www.comeet.com/jobs/${company.comeetId}`,
    BOARD_ID.test(company.greenhouseId || "") && `https://boards.greenhouse.io/${company.greenhouseId}`,
    BOARD_ID.test(company.leverId || "") && `https://jobs.lever.co/${company.leverId}`
  ].filter(Boolean);
  const careersUrl = plainLink(company.careersUrl);
  const careersBoards = boardsIn(careersUrl);
  const name = String(company.name || "").trim().slice(0, MAX_NAME) || null;
  const boards = boardsIn([...links, careersUrl].filter(Boolean).join("\n")).map((board) => ({ ...board, company: name }));

  return { boards, careersUrl: careersUrl && careersBoards.length === 0 ? careersUrl : null, name, website: plainLink(company.websiteUrl) };
}

/* Finds the boards that the job lists link to, the companies the lists show hiring, and those of them whose board the
   lists already give */
async function jobLists(tree) {
  const paths = tree.filter((item) => item.type === "blob" && JOB_LIST.test(item.path || "")).map((item) => item.path);
  const lists = [];

  await eachLimited(paths, CONCURRENCY, async (path) => {
    lists.push(await fetchText(`${RAW}/${path}`));
  });

  const text = lists.join("\n");
  const hiring = new Set();
  const covered = new Set();

  for (const line of text.split("\n")) {
    const name = LIST_COMPANY.exec(line)?.[1];

    if (name && name !== "company") {
      hiring.add(name);
      if (boardsIn(line).length) covered.add(name);
    }
  }

  return { boards: boardsIn(text), hiring: [...hiring], covered: [...covered] };
}

// Reads the company files that are new or changed since the last run, a batch at a time
async function companyFileBoards(tree) {
  const files = tree.filter((item) => item.type === "blob" && COMPANY_FILE.test(item.path || ""));

  if (files.length === 0) {
    return [];
  }

  const { rows } = await db.query(`SELECT path, sha FROM techmap_companies`);
  const known = new Map(rows.map((row) => [row.path, row.sha]));
  const changed = files.filter((file) => known.get(file.path) !== file.sha).slice(0, COMPANY_BATCH);
  const boards = [];
  const read = [];

  await eachLimited(changed, CONCURRENCY, async (file) => {
    const text = await fetchText(`${RAW}/${file.path}`);
    let company = null;

    try {
      company = JSON.parse(text);
    } catch {
      return;
    }

    const found = companyBoards(company);
    boards.push(...found.boards);
    read.push({ ...found, path: file.path, sha: file.sha });
  });

  // Saves the files read in one statement; a changed file is looked at afresh, so its careers page and the probe run again
  if (read.length) {
    await db.query(
      `INSERT INTO techmap_companies (path, sha, careers_url, name, website, has_board)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::boolean[])
       ON CONFLICT (path) DO UPDATE SET sha = EXCLUDED.sha, careers_url = EXCLUDED.careers_url, name = EXCLUDED.name,
         website = EXCLUDED.website, has_board = EXCLUDED.has_board, careers_checked_at = NULL, probed_at = NULL`,
      [
        read.map((file) => file.path),
        read.map((file) => file.sha),
        read.map((file) => file.careersUrl),
        read.map((file) => file.name),
        read.map((file) => file.website),
        read.map((file) => file.boards.length > 0)
      ]
    );
  }

  await db.query(`DELETE FROM techmap_companies WHERE NOT (path = ANY($1::text[]))`, [files.map((file) => file.path)]);

  return boards;
}

/* Notes in one statement that a batch of companies was checked (the column says how), and which of them turned out to
   have a board */
async function noteChecked(column, checked) {
  if (checked.length === 0) {
    return;
  }

  await db.query(
    `UPDATE techmap_companies AS t SET ${column} = NOW(), has_board = x.has_board
     FROM UNNEST($1::text[], $2::boolean[]) AS x(path, has_board)
     WHERE t.path = x.path`,
    [checked.map((item) => item.path), checked.map((item) => item.hasBoard)]
  );
}

/* Looks for boards on a batch of the companies' own careers pages, hiring companies first. A Comeet widget gives only
   the company's code, so its board is found by trying the company's likely names */
async function careersPageBoards(lists) {
  const { rows } = await db.query(
    `SELECT path, careers_url, name, website FROM techmap_companies
     WHERE careers_url IS NOT NULL AND NOT has_board AND NOT (name = ANY($4::text[]))
       AND (careers_checked_at IS NULL OR careers_checked_at < NOW() - make_interval(days => $1))
     ORDER BY name = ANY($3::text[]) DESC, careers_checked_at NULLS FIRST
     LIMIT $2`,
    [RECHECK_DAYS, CAREERS_BATCH, lists.hiring, lists.covered]
  );
  const boards = [];
  const checked = [];

  await eachLimited(rows, CONCURRENCY, async (row) => {
    const found = await readCareersPage(row.careers_url);
    const guesses = nameGuesses(row.name, row.website || row.careers_url);

    for (const code of found.comeetCodes) {
      const board = await comeetBoard(code, guesses);
      if (board) found.boards.push(board);
    }

    boards.push(...found.boards.map((board) => ({ ...board, company: row.name })));
    checked.push({ path: row.path, hasBoard: found.boards.length > 0 });
  });

  await noteChecked("careers_checked_at", checked);

  return boards;
}

/* Asks the job systems for a batch of companies with no board yet, by their likely names, hiring companies first.
   A company with a careers page is asked only once its page was read */
async function probedBoards(lists) {
  const { rows } = await db.query(
    `SELECT path, name, website FROM techmap_companies
     WHERE NOT has_board AND name IS NOT NULL AND NOT (name = ANY($4::text[]))
       AND (careers_url IS NULL OR careers_checked_at IS NOT NULL)
       AND (probed_at IS NULL OR probed_at < NOW() - make_interval(days => $1))
     ORDER BY name = ANY($3::text[]) DESC, probed_at NULLS FIRST
     LIMIT $2`,
    [RECHECK_DAYS, PROBE_BATCH, lists.hiring, lists.covered]
  );
  const boards = [];
  const checked = [];

  await eachLimited(rows, CONCURRENCY, async (row) => {
    const board = await probeBoard(nameGuesses(row.name, row.website));

    if (board) {
      boards.push({ ...board, company: row.name });
    }

    checked.push({ path: row.path, hasBoard: Boolean(board) });
  });

  await noteChecked("probed_at", checked);

  return boards;
}

/* Finds company boards from the tech map: from its lists and company files, from the companies' careers pages, and by
   asking the job systems for the rest. The repository's file listing says which lists and files there are */
async function findBoards() {
  const tree = JSON.parse((await fetchText(TREE_URL)) || "{}").tree || [];
  const lists = await jobLists(tree);
  const listed = [...lists.boards, ...(await companyFileBoards(tree))];
  const careers = await careersPageBoards(lists);
  const probed = await probedBoards(lists);

  return { listed, careers, probed };
}

module.exports = { REGION, findBoards, companyBoards };
