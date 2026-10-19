const express = require("express");
const { rateLimit } = require("express-rate-limit");
const db = require("../config/db");
const classifier = require("../services/emailClassifier");
const emailService = require("../services/emailService");

const router = express.Router();

const MAX_MESSAGES = 25;
const LIMITS = { id: 200, from: 300, subject: 400, body: 4000 };

const failureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: "Too many failed requests. Please try again later." });
  }
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => emailService.hashToken(String(req.get("Authorization") || "")),
  handler: (req, res) => {
    res.status(429).json({ error: "Too many requests. Please try again later." });
  }
});

function readMessage(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) {
    return null;
  }

  const date = new Date(raw.date);

  return {
    id: raw.id.slice(0, LIMITS.id),
    date: Number.isNaN(date.getTime()) ? new Date() : date,
    from: String(raw.from ?? "").slice(0, LIMITS.from),
    subject: String(raw.subject ?? "").slice(0, LIMITS.subject),
    body: String(raw.body ?? "").slice(0, LIMITS.body)
  };
}

router.post("/", failureLimiter, limiter, async (req, res) => {
  const header = req.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return res.status(401).json({ error: "Missing token." });
  }

  try {
    const sync = await db.query(
      `SELECT user_id, auto_update FROM email_sync WHERE token_hash = $1`,
      [emailService.hashToken(token)]
    );

    if (sync.rowCount === 0) {
      return res.status(401).json({ error: "Invalid token." });
    }

    const { user_id: userId, auto_update: autoUpdate } = sync.rows[0];
    const raw = req.body?.messages;

    if (!Array.isArray(raw) || raw.length > MAX_MESSAGES) {
      return res.status(400).json({ error: `Send between 0 and ${MAX_MESSAGES} messages.` });
    }

    await db.query(`UPDATE email_sync SET last_ingest_at = NOW() WHERE user_id = $1`, [userId]);

    const messages = raw.map(readMessage).filter(Boolean);

    if (messages.length > 0 && !classifier.isConfigured()) {
      return res.status(503).json({ error: "Email classification is not configured on the server." });
    }

    res.json(await emailService.ingest(userId, autoUpdate, messages));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not process messages." });
  }
});

module.exports = router;
