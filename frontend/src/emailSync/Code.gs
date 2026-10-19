// Job Tracker email sync.
// Looks for job-related emails in your Gmail and sends them to your Job Tracker, which suggests
// status updates for your applications. This script can only READ your mail (see appsscript.json);
// it never changes it.

const API_URL = "__API_URL__";
const TOKEN = "__TOKEN__";

const FIRST_RUN_DAYS = 45; // how far back the very first run looks
const MAX_PER_RUN = 300;
const BATCH_SIZE = 20;
const QUERY =
  '(application OR applied OR candidacy OR candidate OR interview OR recruiter OR recruiting ' +
  'OR hiring OR position OR "next steps" OR assessment OR offer OR unfortunately OR regret) ' +
  '-category:promotions -category:social -in:spam -in:trash -in:drafts -from:me';

// Run this once. It checks the connection, then schedules a sync every 12 hours.
function setup() {
  post_([]);

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("sync").timeBased().everyHours(12).create();

  sync();
}

function sync() {
  const properties = PropertiesService.getScriptProperties();
  const lastRun = Number(properties.getProperty("lastRun"));
  const startedAt = Math.floor(Date.now() / 1000);
  // Each run covers the time since the previous one (12 hours), plus an hour of overlap for timing
  // drift; the server skips emails it has already seen. If a run failed, the window simply grows to
  // cover the gap.
  const after = lastRun ? lastRun - 3600 : startedAt - FIRST_RUN_DAYS * 86400;

  const ids = listIds_(QUERY + " after:" + after);
  let complete = ids.length < MAX_PER_RUN;

  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const messages = ids.slice(start, start + BATCH_SIZE).map(readMessage_);
    const result = post_(messages);

    if (result.failed > 0 || result.deferred > 0) {
      complete = false;
    }
  }

  // Only move the window forward once everything was handled, so nothing is skipped.
  if (complete) {
    properties.setProperty("lastRun", String(startedAt));
  }
}

function listIds_(query) {
  const ids = [];
  let pageToken;

  do {
    const page = Gmail.Users.Messages.list("me", { q: query, maxResults: 100, pageToken: pageToken });
    (page.messages || []).forEach(function (message) {
      ids.push(message.id);
    });
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MAX_PER_RUN);

  return ids.slice(0, MAX_PER_RUN);
}

function readMessage_(id) {
  const message = Gmail.Users.Messages.get("me", id, { format: "full" });
  const headers = {};

  (message.payload.headers || []).forEach(function (header) {
    headers[header.name.toLowerCase()] = header.value;
  });

  const plain = findPart_(message.payload, "text/plain");
  const html = plain ? null : findPart_(message.payload, "text/html");

  return {
    id: id,
    date: new Date(Number(message.internalDate)).toISOString(),
    from: headers["from"] || "",
    subject: headers["subject"] || "",
    body: plain ? decode_(plain) : html ? stripHtml_(decode_(html)) : message.snippet || ""
  };
}

function findPart_(part, mimeType) {
  if (part.mimeType === mimeType && part.body && part.body.data) {
    return part.body.data;
  }

  const children = part.parts || [];

  for (let i = 0; i < children.length; i++) {
    const found = findPart_(children[i], mimeType);

    if (found) {
      return found;
    }
  }

  return null;
}

function decode_(data) {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString("UTF-8");
}

function stripHtml_(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function post_(messages) {
  const response = UrlFetchApp.fetch(API_URL + "/api/email/ingest", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + TOKEN },
    payload: JSON.stringify({ messages: messages }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(
      "Job Tracker replied " + response.getResponseCode() + ": " + response.getContentText()
    );
  }

  return JSON.parse(response.getContentText());
}
