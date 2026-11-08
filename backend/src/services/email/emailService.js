const crypto = require("crypto");
const db = require("../../config/db");
const auth = require("../auth/authService");
const { classifyEmail } = require("./emailClassifier");
const { matchApplication, transition } = require("./emailMatcher");
const { APPLICATION_FIELDS } = require("../applications/applicationFields");
const { createMachine } = require("../shared/stateMachine");

/* An email event is recorded as ignored, pending (waiting for the user's review) or auto-applied. The user accepts
   or dismisses a pending one, and can undo one that changed an application's status. A pending one nobody reviews
   expires. Events that led nowhere are removed (deleted) after a while; ones that changed a status are kept as the
   record of why it changed */
const EMAIL_EVENT = createMachine("email event", {
  initial: ["ignored", "pending", "auto_applied"],
  states: {
    ignored: { remove: "removed" },
    pending: { accept: "accepted", dismiss: "dismissed", expire: "expired" },
    auto_applied: { undo: "undone" },
    accepted: { undo: "undone" },
    dismissed: { remove: "removed" },
    undone: { remove: "removed" },
    expired: { remove: "removed" },
    removed: {}
  }
});
// Days a suggestion waits for review before it expires
const PENDING_DAYS = 30;
/* Days an event that led nowhere is kept after it was resolved (or recorded, for ignored ones). Longer than the sync
   script ever looks back (45 days), so a removed email is never sent again and recorded twice */
const KEEP_DAYS = 90;
const STATUS_FOR_EVENT = { interview: "Interview", offer: "Offer", rejection: "Rejected" };
const MIN_CONFIDENCE = 0.5;
const AUTO_CONFIDENCE = 0.85;
const AUTO_COMPANY_SCORE = 0.9;
const DAILY_LIMIT = 300;
const CLASSIFY_CONCURRENCY = 4;

// Generates a new email sync token
function generateToken() {
  return `jt_${crypto.randomBytes(32).toString("base64url")}`;
}

// Hashes a sync token for storage
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Shortens an email body to a one-line preview
function snippetOf(body) {
  return body.replace(/\s+/g, " ").trim().slice(0, 200);
}

// Runs a task over the items with limited concurrency
async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;

  // Processes items until none are left
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
}

// Stores an email event
async function insertEvent(client, userId, message, classified, outcome) {
  if (!EMAIL_EVENT.initial.includes(outcome.state)) {
    throw new Error(`An email event can't start as "${outcome.state}"`);
  }

  await client.query(
    `INSERT INTO email_events
       (user_id, message_id, received_at, sender, subject, snippet, event_type, company, position, confidence,
        suggested_status, application_id, candidate_ids, previous_status, state, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             CASE WHEN $15 = 'auto_applied' THEN NOW() END)
     ON CONFLICT (user_id, message_id) DO NOTHING`,
    [
      userId,
      message.id,
      message.date,
      message.from,
      message.subject,
      snippetOf(message.body),
      classified.event,
      classified.company || null,
      classified.position || null,
      classified.confidence,
      outcome.status ?? null,
      outcome.applicationId ?? null,
      outcome.candidateIds ?? [],
      outcome.previousStatus ?? null,
      outcome.state
    ]
  );
}

// Matches a classified email to an application and records the outcome
async function recordOutcome(userId, autoUpdate, applications, message, classified) {
  const status = STATUS_FOR_EVENT[classified.event];

  if (!classified.jobRelated || !status || classified.confidence < MIN_CONFIDENCE) {
    await insertEvent(db, userId, message, classified, { state: "ignored" });

    return "ignored";
  }

  const match = matchApplication(classified, applications, message.date.toISOString().slice(0, 10));

  if (match.kind === "predates") {
    await insertEvent(db, userId, message, classified, { state: "ignored" });

    return "ignored";
  }

  if (match.kind === "none") {
    await insertEvent(db, userId, message, classified, { state: "pending", status });

    return "pending";
  }

  if (match.kind === "ambiguous") {
    const candidates = match.candidates.filter(({ status: current }) => transition(current, status) !== "ignore");

    if (candidates.length === 0) {
      await insertEvent(db, userId, message, classified, { state: "ignored" });

      return "ignored";
    }

    await insertEvent(db, userId, message, classified, {
      state: "pending",
      status,
      candidateIds: candidates.map(({ id }) => id)
    });

    return "pending";
  }

  const { application } = match;
  const action = transition(application.status, status);

  if (action === "ignore") {
    await insertEvent(db, userId, message, classified, { state: "ignored" });

    return "ignored";
  }

  const confident =
    autoUpdate &&
    action === "auto" &&
    match.sure &&
    match.company >= AUTO_COMPANY_SCORE &&
    classified.confidence >= AUTO_CONFIDENCE;

  if (!confident) {
    await insertEvent(db, userId, message, classified, {
      state: "pending",
      status,
      applicationId: application.id
    });

    return "pending";
  }

  const previousStatus = application.status;

  await auth.withTransaction(async (client) => {
    await client.query(`UPDATE applications SET status = $3 WHERE id = $1 AND user_id = $2`, [
      application.id,
      userId,
      status
    ]);
    await insertEvent(client, userId, message, classified, {
      state: "auto_applied",
      status,
      applicationId: application.id,
      previousStatus
    });
  });

  application.status = status;

  return "autoApplied";
}

// Classifies new emails and updates applications
async function ingest(userId, autoUpdate, messages) {
  const counts = { received: messages.length, known: 0, ignored: 0, pending: 0, autoApplied: 0, failed: 0, deferred: 0 };
  const known = await db.query(
    `SELECT message_id FROM email_events WHERE user_id = $1 AND message_id = ANY($2)`,
    [userId, messages.map(({ id }) => id)]
  );
  const knownIds = new Set(known.rows.map((row) => row.message_id));
  let fresh = messages.filter(({ id }) => !knownIds.has(id));
  counts.known = messages.length - fresh.length;

  const used = await db.query(
    `SELECT COUNT(*)::int AS used FROM email_events
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  const budget = Math.max(0, DAILY_LIMIT - used.rows[0].used);
  counts.deferred = Math.max(0, fresh.length - budget);
  fresh = fresh.slice(0, budget);

  if (fresh.length === 0) {
    return counts;
  }

  const classified = await mapWithConcurrency(fresh, CLASSIFY_CONCURRENCY, async (message) => {
    try {
      return { message, result: await classifyEmail(message) };
    } catch (err) {
      console.error(err.message);

      return { message, result: null };
    }
  });
  const applications = (
    await db.query(`SELECT ${APPLICATION_FIELDS} FROM applications WHERE user_id = $1`, [userId])
  ).rows;
  const done = classified
    .filter(({ result }) => result)
    .sort((a, b) => a.message.date - b.message.date);

  counts.failed = classified.length - done.length;

  for (const { message, result } of done) {
    const outcome = await recordOutcome(userId, autoUpdate, applications, message, result);
    counts[outcome] += 1;
  }

  return counts;
}

// Expires suggestions nobody reviewed in time, then removes old events that led nowhere; returns how many of each
async function cleanUpEvents() {
  const expired = await db.query(
    `UPDATE email_events SET state = ${EMAIL_EVENT.sqlList(EMAIL_EVENT.targets("expire"))}, resolved_at = NOW()
     WHERE state IN (${EMAIL_EVENT.sqlList(EMAIL_EVENT.sources("expire"))})
       AND created_at < NOW() - make_interval(days => $1)`,
    [PENDING_DAYS]
  );
  const removed = await db.query(
    `DELETE FROM email_events
     WHERE state IN (${EMAIL_EVENT.sqlList(EMAIL_EVENT.sources("remove"))})
       AND COALESCE(resolved_at, created_at) < NOW() - make_interval(days => $1)`,
    [KEEP_DAYS]
  );

  return { expired: expired.rowCount, removed: removed.rowCount };
}

module.exports = { APPLICATION_FIELDS, EMAIL_EVENT, PENDING_DAYS, KEEP_DAYS, generateToken, hashToken, ingest, cleanUpEvents };
