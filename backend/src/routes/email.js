const express = require("express");
const db = require("../config/db");
const requireAuth = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const auth = require("../services/auth/authService");
const classifier = require("../services/email/emailClassifier");
const { EMAIL_EVENT, generateToken, hashToken, roundRecorded } = require("../services/email/emailService");
const { movesStatusSql, transition } = require("../services/email/emailMatcher");
const { MAX_STEPS } = require("../services/applications/statusStates");
const steps = require("../services/applications/applicationSteps");

const router = express.Router();
const ID_PATTERN = /^[1-9]\d*$/;
const RECENT_HOURS = 24;
const eventFields = `
  e.id, e.received_at, e.sender, e.subject, e.snippet, e.event_type, e.company, e.position,
  e.suggested_status, e.application_id, e.candidate_ids, e.previous_status, e.state, e.resolved_at
`;

// Error that carries an HTTP status
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

router.use(requireAuth, requireCsrf);

// Sends the status of an HTTP or step error, or logs any other error and sends a generic message
function fail(res, err, fallback) {
  if (err instanceof HttpError || err instanceof steps.StepError) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error(err);

  res.status(500).json({ error: fallback });
}

// Returns whether email sync is connected and its settings
router.get("/status", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT auto_update, last_ingest_at FROM email_sync WHERE user_id = $1`,
      [req.user.id]
    );
    const sync = result.rows[0];

    res.set("Cache-Control", "no-store");

    res.json({
      connected: Boolean(sync),
      autoUpdate: sync?.auto_update ?? false,
      lastIngestAt: sync?.last_ingest_at ?? null,
      classifierConfigured: classifier.isConfigured()
    });
  } catch (err) {
    fail(res, err, "Could not load email sync settings.");
  }
});

// Creates a new sync token, replacing any previous one
router.post("/token", async (req, res) => {
  try {
    const token = generateToken();

    await db.query(
      `INSERT INTO email_sync (user_id, token_hash) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, last_ingest_at = NULL`,
      [req.user.id, hashToken(token)]
    );

    res.set("Cache-Control", "no-store");

    res.json({ token });
  } catch (err) {
    fail(res, err, "Could not create the email sync token.");
  }
});

// Turns automatic status updates on or off
router.post("/settings", async (req, res) => {
  try {
    if (typeof req.body?.autoUpdate !== "boolean") {
      throw new HttpError(400, "autoUpdate must be true or false.");
    }

    const result = await db.query(
      `UPDATE email_sync SET auto_update = $2 WHERE user_id = $1 RETURNING auto_update`,
      [req.user.id, req.body.autoUpdate]
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, "Email sync is not set up.");
    }

    res.json({ autoUpdate: result.rows[0].auto_update });
  } catch (err) {
    fail(res, err, "Could not save the setting.");
  }
});

// Disconnects email sync and removes its events
router.post("/disconnect", async (req, res) => {
  try {
    await auth.withTransaction(async (client) => {
      await client.query(`DELETE FROM email_sync WHERE user_id = $1`, [req.user.id]);
      await client.query(`DELETE FROM email_events WHERE user_id = $1`, [req.user.id]);
    });

    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "Could not disconnect email sync.");
  }
});

// Lists pending and recent email events
router.get("/events", async (req, res) => {
  try {
    /* A pending event is listed while its move can still apply. Another round is listed only while it isn't recorded yet
       (roundRecorded in emailService.js): the current step is dated before the email's day */
    const pending = await db.query(
      `SELECT ${eventFields}
       FROM email_events e
       LEFT JOIN applications a ON a.id = e.application_id
       WHERE e.user_id = $1 AND e.state IN (${EMAIL_EVENT.sqlList(EMAIL_EVENT.sources("accept"))})
         AND (a.id IS NULL OR ${movesStatusSql("a.status", "e.suggested_status")})
         AND NOT COALESCE(a.status = e.suggested_status AND (
           SELECT s.step_date FROM application_steps s WHERE s.application_id = a.id ORDER BY s.position DESC LIMIT 1
         ) >= (e.received_at AT TIME ZONE 'UTC')::date, FALSE)
       ORDER BY e.received_at DESC NULLS LAST, e.id DESC`,
      [req.user.id]
    );
    const recent = await db.query(
      `SELECT ${eventFields},
              a.company AS application_company, a.position AS application_position,
              COALESCE(current_step.step_count > 1 AND CASE
                WHEN e.step_id IS NULL THEN a.status = e.suggested_status
                ELSE e.step_id = current_step.id
              END, FALSE) AS undoable
       FROM email_events e
       JOIN applications a ON a.id = e.application_id
       LEFT JOIN LATERAL (
         SELECT s.id, COUNT(*) OVER () AS step_count
         FROM application_steps s
         WHERE s.application_id = a.id
         ORDER BY s.position DESC
         LIMIT 1
       ) AS current_step ON TRUE
       WHERE e.user_id = $1 AND e.state IN (${EMAIL_EVENT.sqlList(EMAIL_EVENT.sources("undo"))})
         AND e.resolved_at > NOW() - make_interval(hours => $2)
       ORDER BY e.resolved_at DESC
       LIMIT 50`,
      [req.user.id, RECENT_HOURS]
    );

    res.set("Cache-Control", "no-store");

    res.json({ pending: pending.rows, recent: recent.rows });
  } catch (err) {
    fail(res, err, "Could not load email updates.");
  }
});

// Reads and validates the event ID from the URL
function eventId(req) {
  if (!ID_PATTERN.test(req.params.id)) {
    throw new HttpError(400, "Invalid event ID.");
  }

  return req.params.id;
}

// Locks an event row, checks that the move is allowed from its state and returns it with the state it moves to
async function lockEvent(client, id, userId, move) {
  const result = await client.query(
    `SELECT * FROM email_events WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [id, userId]
  );
  const event = result.rows[0];

  if (!event) {
    throw new HttpError(404, "Update not found.");
  }

  if (!EMAIL_EVENT.can(event.state, move)) {
    throw new HttpError(409, "This update was already handled.");
  }

  return { event, next: EMAIL_EVENT.move(event.state, move) };
}

/* Tells whether an event's step is still the application's current step, so undoing it removes that step. Events
   from before steps were recorded have none: for them the current step must have the event's status */
function isUpdateStep(event, journey) {
  const current = journey[journey.length - 1];

  if (journey.length < 2) {
    return false;
  }

  return event.step_id ? current.id === String(event.step_id) : current.status === event.suggested_status;
}

// Applies a pending event's status to an application
router.post("/events/:id/accept", async (req, res) => {
  try {
    const id = eventId(req);
    const application = await auth.withTransaction(async (client) => {
      const { event, next } = await lockEvent(client, id, req.user.id, "accept");
      let applicationId = event.application_id;

      if (!applicationId) {
        const chosen = String(req.body?.applicationId ?? "");

        if (!event.candidate_ids.includes(chosen)) {
          throw new HttpError(400, "Choose which application this email is about.");
        }

        applicationId = chosen;
      }

      const journey = await steps.lockSteps(client, applicationId, req.user.id);
      const current = journey[journey.length - 1];

      const received = event.received_at ? event.received_at.toISOString().slice(0, 10) : "";

      if (transition(current.status, event.suggested_status) === "ignore" || (received && roundRecorded(current, event.suggested_status, received))) {
        throw new HttpError(409, "The application's status changed, so this update no longer applies.");
      }

      if (journey.length >= MAX_STEPS) {
        throw new HttpError(409, `This application already has ${MAX_STEPS} steps. Remove one to add this update.`);
      }

      const stepId = await steps.addStep(client, {
        applicationId,
        userId: req.user.id,
        steps: journey,
        status: event.suggested_status,
        date: steps.nextStepDate(journey)
      });

      await client.query(
        `UPDATE email_events
         SET state = $4, application_id = $2, previous_status = $3, resolved_at = NOW(), step_id = $5
         WHERE id = $1`,
        [id, applicationId, current.status, next, stepId]
      );

      return steps.loadApplication(client, applicationId);
    });

    res.json({ application });
  } catch (err) {
    fail(res, err, "Could not apply the update.");
  }
});

// Dismisses a pending event
router.post("/events/:id/dismiss", async (req, res) => {
  try {
    const id = eventId(req);

    await auth.withTransaction(async (client) => {
      const { next } = await lockEvent(client, id, req.user.id, "dismiss");

      await client.query(`UPDATE email_events SET state = $2, resolved_at = NOW() WHERE id = $1`, [id, next]);
    });

    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "Could not dismiss the update.");
  }
});

// Reverts an applied event to the application's previous status
router.post("/events/:id/undo", async (req, res) => {
  try {
    const id = eventId(req);
    const application = await auth.withTransaction(async (client) => {
      const { event, next } = await lockEvent(client, id, req.user.id, "undo");

      if (!event.application_id) {
        throw new HttpError(404, "Application not found.");
      }

      const journey = await steps.lockSteps(client, event.application_id, req.user.id);
      const index = journey.length - 1;

      if (!isUpdateStep(event, journey)) {
        throw new HttpError(409, "The status changed since this update, so it can't be undone.");
      }

      await steps.removeStep(client, { applicationId: event.application_id, steps: journey, index });
      await client.query(`UPDATE email_events SET state = $2, resolved_at = NOW() WHERE id = $1`, [id, next]);

      return steps.loadApplication(client, event.application_id);
    });

    res.json({ application });
  } catch (err) {
    fail(res, err, "Could not undo the update.");
  }
});

module.exports = router;
