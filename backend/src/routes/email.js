const express = require("express");
const db = require("../config/db");
const requireAuth = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const auth = require("../services/authService");
const classifier = require("../services/emailClassifier");
const { APPLICATION_FIELDS, generateToken, hashToken } = require("../services/emailService");

const router = express.Router();

router.use(requireAuth, requireCsrf);

const ID_PATTERN = /^[1-9]\d*$/;
const RECENT_HOURS = 24;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(res, err, fallback) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error(err);
  res.status(500).json({ error: fallback });
}

const eventFields = `
  e.id, e.received_at, e.sender, e.subject, e.snippet, e.event_type, e.company, e.position,
  e.suggested_status, e.application_id, e.candidate_ids, e.previous_status, e.state, e.resolved_at
`;

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

router.get("/events", async (req, res) => {
  try {
    const pending = await db.query(
      `SELECT ${eventFields}
       FROM email_events e
       LEFT JOIN applications a ON a.id = e.application_id
       WHERE e.user_id = $1 AND e.state = 'pending'
         AND (a.id IS NULL OR a.status <> e.suggested_status)
       ORDER BY e.received_at DESC NULLS LAST, e.id DESC`,
      [req.user.id]
    );

    const recent = await db.query(
      `SELECT ${eventFields},
              a.company AS application_company, a.position AS application_position,
              a.status = e.suggested_status AS undoable
       FROM email_events e
       JOIN applications a ON a.id = e.application_id
       WHERE e.user_id = $1 AND e.state IN ('auto_applied', 'accepted')
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

function eventId(req) {
  if (!ID_PATTERN.test(req.params.id)) {
    throw new HttpError(400, "Invalid event ID.");
  }

  return req.params.id;
}

async function lockEvent(client, id, userId, states) {
  const result = await client.query(
    `SELECT * FROM email_events WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [id, userId]
  );
  const event = result.rows[0];

  if (!event) {
    throw new HttpError(404, "Update not found.");
  }

  if (!states.includes(event.state)) {
    throw new HttpError(409, "This update was already handled.");
  }

  return event;
}

async function lockApplication(client, id, userId) {
  const result = await client.query(
    `SELECT id, status FROM applications WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [id, userId]
  );

  if (!result.rows[0]) {
    throw new HttpError(404, "Application not found.");
  }

  return result.rows[0];
}

async function loadApplication(client, id) {
  return (await client.query(`SELECT ${APPLICATION_FIELDS} FROM applications WHERE id = $1`, [id])).rows[0];
}

router.post("/events/:id/accept", async (req, res) => {
  try {
    const id = eventId(req);

    const application = await auth.withTransaction(async (client) => {
      const event = await lockEvent(client, id, req.user.id, ["pending"]);
      let applicationId = event.application_id;

      if (!applicationId) {
        const chosen = String(req.body?.applicationId ?? "");

        if (!event.candidate_ids.includes(chosen)) {
          throw new HttpError(400, "Choose which application this email is about.");
        }

        applicationId = chosen;
      }

      const current = await lockApplication(client, applicationId, req.user.id);

      await client.query(`UPDATE applications SET status = $2 WHERE id = $1`, [applicationId, event.suggested_status]);
      await client.query(
        `UPDATE email_events
         SET state = 'accepted', application_id = $2, previous_status = $3, resolved_at = NOW()
         WHERE id = $1`,
        [id, applicationId, current.status]
      );

      return loadApplication(client, applicationId);
    });

    res.json({ application });
  } catch (err) {
    fail(res, err, "Could not apply the update.");
  }
});

router.post("/events/:id/dismiss", async (req, res) => {
  try {
    const id = eventId(req);

    await auth.withTransaction(async (client) => {
      await lockEvent(client, id, req.user.id, ["pending"]);
      await client.query(`UPDATE email_events SET state = 'dismissed', resolved_at = NOW() WHERE id = $1`, [id]);
    });

    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "Could not dismiss the update.");
  }
});

router.post("/events/:id/undo", async (req, res) => {
  try {
    const id = eventId(req);

    const application = await auth.withTransaction(async (client) => {
      const event = await lockEvent(client, id, req.user.id, ["auto_applied", "accepted"]);

      if (!event.application_id) {
        throw new HttpError(404, "Application not found.");
      }

      const current = await lockApplication(client, event.application_id, req.user.id);

      if (current.status !== event.suggested_status) {
        throw new HttpError(409, "The status changed since this update, so it can't be undone.");
      }

      await client.query(`UPDATE applications SET status = $2 WHERE id = $1`, [event.application_id, event.previous_status]);
      await client.query(`UPDATE email_events SET state = 'undone', resolved_at = NOW() WHERE id = $1`, [id]);

      return loadApplication(client, event.application_id);
    });

    res.json({ application });
  } catch (err) {
    fail(res, err, "Could not undo the update.");
  }
});

module.exports = router;
