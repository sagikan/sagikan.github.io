const crypto = require("crypto");
const db = require("../config/db");
const auth = require("./authService");
const { classifyEmail } = require("./emailClassifier");
const { matchApplication, transition } = require("./emailMatcher");
const { APPLICATION_FIELDS } = require("./applicationFields");

const STATUS_FOR_EVENT = { interview: "Interview", offer: "Offer", rejection: "Rejected" };
const MIN_CONFIDENCE = 0.5;
const AUTO_CONFIDENCE = 0.85;
const AUTO_COMPANY_SCORE = 0.9;
const DAILY_LIMIT = 300;
const CLASSIFY_CONCURRENCY = 4;

function generateToken() {
  return `jt_${crypto.randomBytes(32).toString("base64url")}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function snippetOf(body) {
  return body.replace(/\s+/g, " ").trim().slice(0, 200);
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function insertEvent(client, userId, message, classified, outcome) {
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

module.exports = { APPLICATION_FIELDS, generateToken, hashToken, ingest };
