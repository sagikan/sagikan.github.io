// Applicant Zero email sync.
// Looks for job-related emails in your Gmail and sends them to your Applicant Zero account, which suggests
// status updates for your applications. This script can only READ your mail (see appsscript.json);
// it never changes it.

const API_URL = "__API_URL__";
const TOKEN = "__TOKEN__";

const FIRST_RUN_DAYS = 45;
const MAX_PER_RUN = 300;
const BATCH_SIZE = 20;
const PAUSE_MS = 250;
const RETRY_WAITS_S = [5, 15, 45];
const QUERY =
  '(application OR applied OR candidacy OR candidate OR interview OR recruiter OR recruiting ' +
  'OR hiring OR position OR "next steps" OR assessment OR offer OR unfortunately OR regret) ' +
  '-category:promotions -category:social -in:spam -in:trash -in:drafts -from:me';

// Run this once. It checks the connection, then schedules a sync every 12 hours.
function setup() {
  post_({ messages: [] });

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("sync").timeBased().everyHours(12).create();

  sync();
}

function schedule() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  [10, 22].forEach(function (hour) {
    ScriptApp.newTrigger("sync")
      .timeBased()
      .inTimezone("Asia/Jerusalem")
      .atHour(hour)
      .nearMinute(0)
      .everyDays(1)
      .create();
  });
}

function sync() {
  const properties = PropertiesService.getScriptProperties();
  const lastRun = Number(properties.getProperty("lastRun"));
  const startedAt = Math.floor(Date.now() / 1000);
  const after = lastRun ? lastRun - 3600 : startedAt - FIRST_RUN_DAYS * 86400;

  const listed = listIds_(QUERY + " after:" + after);
  const ids = unknownIds_(listed);
  let complete = listed.length < MAX_PER_RUN;

  for (let start = 0; start < ids.length && complete !== null; start += BATCH_SIZE) {
    const messages = [];

    for (const id of ids.slice(start, start + BATCH_SIZE)) {
      const message = readMessage_(id);

      if (!message) {
        complete = null;
        break;
      }

      messages.push(message);
      Utilities.sleep(PAUSE_MS);
    }

    const result = post_({ messages: messages });

    if (result.failed > 0 || result.deferred > 0) {
      complete = false;
    }
  }

  if (complete === true) {
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

function unknownIds_(ids) {
  let unknown = [];

  for (let start = 0; start < ids.length; start += 100) {
    unknown = unknown.concat(post_({ ids: ids.slice(start, start + 100) }).unknown);
  }

  return unknown;
}

function getMessage_(id) {
  for (let attempt = 0; ; attempt++) {
    try {
      return Gmail.Users.Messages.get("me", id, { format: "full" });
    } catch (err) {
      if (!/quota|rate limit|backend error/i.test(String(err))) {
        throw err;
      }

      if (attempt >= RETRY_WAITS_S.length) {
        return null;
      }

      Utilities.sleep(RETRY_WAITS_S[attempt] * 1000);
    }
  }
}

function readMessage_(id) {
  const message = getMessage_(id);

  if (!message) {
    return null;
  }

  const headers = {};

  (message.payload.headers || []).forEach(function (header) {
    headers[header.name.toLowerCase()] = header.value;
  });

  const plain = findPart_(id, message.payload, "text/plain");
  const html = plain ? null : findPart_(id, message.payload, "text/html");

  return {
    id: id,
    date: new Date(Number(message.internalDate)).toISOString(),
    from: headers["from"] || "",
    subject: headers["subject"] || "",
    body: (plain ? decode_(plain) : html ? stripHtml_(decode_(html)) : "") || message.snippet || ""
  };
}

function findPart_(messageId, part, mimeType) {
  if (part.mimeType === mimeType && part.body) {
    if (part.body.data) {
      return part.body.data;
    }

    if (part.body.attachmentId) {
      return Gmail.Users.Messages.Attachments.get("me", messageId, part.body.attachmentId).data;
    }
  }

  const children = part.parts || [];

  for (let i = 0; i < children.length; i++) {
    const found = findPart_(messageId, children[i], mimeType);

    if (found) {
      return found;
    }
  }

  return null;
}

function decode_(data) {
  if (typeof data !== "string") {
    return Utilities.newBlob(data).getDataAsString("UTF-8");
  }

  if (/[^A-Za-z0-9_\-=]/.test(data)) {
    return data;
  }

  const padded = data + "===".slice((data.length + 3) % 4);

  try {
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString("UTF-8");
  } catch (err) {
    return "";
  }
}

function stripHtml_(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function post_(payload) {
  const response = UrlFetchApp.fetch(API_URL + "/api/email/ingest", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(
      "Applicant Zero replied " + response.getResponseCode() + ": " + response.getContentText()
    );
  }

  return JSON.parse(response.getContentText());
}
