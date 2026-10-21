const express = require("express");
const { rateLimit } = require("express-rate-limit");
const db = require("../config/db");
const classifier = require("../services/emailClassifier");
const emailService = require("../services/emailService");

const router = express.Router();

const MAX_MESSAGES = 25;
const MAX_IDS = 100;
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

const NAMED_ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", zwnj: "", zwj: "", shy: "" };

function cleanText(text) {
  return String(text ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => safeChar(parseInt(hex, 16), match))
    .replace(/&#(\d+);/g, (match, dec) => safeChar(Number(dec), match))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ﻿ﾠ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeChar(code, fallback) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

function readMessage(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) {
    return null;
  }

  const date = new Date(raw.date);

  return {
    id: raw.id.slice(0, LIMITS.id),
    date: Number.isNaN(date.getTime()) ? new Date() : date,
    from: String(raw.from ?? "").slice(0, LIMITS.from),
    subject: cleanText(raw.subject).slice(0, LIMITS.subject),
    body: cleanText(raw.body).slice(0, LIMITS.body)
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

    if (Array.isArray(req.body?.ids)) {
      if (req.body.ids.length > MAX_IDS) {
        return res.status(400).json({ error: `Send at most ${MAX_IDS} ids.` });
      }

      const ids = req.body.ids.filter((id) => typeof id === "string").map((id) => id.slice(0, LIMITS.id));
      const known = await db.query(
        `SELECT message_id FROM email_events WHERE user_id = $1 AND message_id = ANY($2)`,
        [userId, ids]
      );
      const seen = new Set(known.rows.map((row) => row.message_id));

      await db.query(`UPDATE email_sync SET last_ingest_at = NOW() WHERE user_id = $1`, [userId]);
      return res.json({ unknown: ids.filter((id) => !seen.has(id)) });
    }

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
