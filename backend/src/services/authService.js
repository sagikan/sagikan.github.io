const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const db = require("../config/db");
const { sendCodeEmail, sendSecurityNotice } = require("./mailer");
const mfa = require("./mfa");

const isProduction = process.env.NODE_ENV === "production";
const baseCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/",
};
const JWT_ALGORITHM = "HS256";
const SESSION_IDLE_MINUTES = 60;
const SESSION_MAX_HOURS = 24;
const PENDING_COOKIE = "pending_auth";
const PENDING_MINUTES = 15;
const EMAIL_CODE_MINUTES = 15;
const EMAIL_RESEND_SECONDS = 60;
const EMAIL_MAX_SENDS_PER_DAY = 8;
const EMAIL_MAX_ATTEMPTS = 5;
const MFA_MAX_ATTEMPTS = 5;
const MFA_LOCK_MINUTES = 15;
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_LOCK_MINUTES = 15;
const EMAIL_CODE_TABLES = {
  verify: "email_verifications",
  reset: "password_resets",
};
const RENEW_AFTER_MINUTES = 5;

function validatePassword(password, email) {
  if (typeof password !== "string") {
    return "Invalid password.";
  }

  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    return "Password must be 12–72 characters long.";
  }

  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return "Password must include uppercase and lowercase letters, a number and a symbol.";
  }

  const emailName = email.split("@")[0];

  if (emailName.length >= 3 && password.toLowerCase().includes(emailName)) {
    return "Password must not contain your email address.";
  }

  return null;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function signToken(payload, expiresInSeconds) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: Math.max(1, Math.floor(expiresInSeconds)),
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
}

function hashSessionId(sessionId) {
  return crypto.createHash("sha256").update(String(sessionId)).digest("hex");
}

function sessionCookie(res, payload, sessionEndsAt) {
  const seconds = Math.min(SESSION_IDLE_MINUTES * 60, (sessionEndsAt - Date.now()) / 1000);
  res.cookie("token", signToken(payload, seconds), { ...baseCookieOptions, maxAge: seconds * 1000 });
}

async function issueSession(res, user) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const result = await db.query(
    `INSERT INTO sessions (id_hash, user_id, expires_at)
     VALUES ($1, $2, NOW() + make_interval(hours => $3))
     RETURNING expires_at`,
    [hashSessionId(sessionId), user.id, SESSION_MAX_HOURS]
  );

  res.clearCookie(PENDING_COOKIE, baseCookieOptions);
  sessionCookie(res, {
    id: user.id,
    typ: "session",
    ver: user.token_version,
    sid: sessionId,
    csrfToken: crypto.randomBytes(32).toString("hex"),
  }, result.rows[0].expires_at.getTime());
}

function renewSession(res, payload, sessionEndsAt) {
  const ageSeconds = Math.floor(Date.now() / 1000) - (payload.iat ?? 0);

  if (ageSeconds < RENEW_AFTER_MINUTES * 60) {
    return;
  }

  const { id, typ, ver, sid, csrfToken } = payload;
  sessionCookie(res, { id, typ, ver, sid, csrfToken }, sessionEndsAt);
}

function endSession(sessionId) {
  return db.query(`DELETE FROM sessions WHERE id_hash = $1`, [hashSessionId(sessionId)]);
}

function endAllSessions(client, userId) {
  return client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

function removeExpiredSessions() {
  return db.query(`DELETE FROM sessions WHERE expires_at < NOW()`);
}

function clearSessionCookies(res) {
  res.clearCookie("token", baseCookieOptions);
  res.clearCookie(PENDING_COOKIE, baseCookieOptions);
}

function setPending(res, user, stage) {
  const token = signToken({ id: user.id, typ: "pending", ver: user.token_version, stage }, PENDING_MINUTES * 60);

  res.cookie(PENDING_COOKIE, token, {
    ...baseCookieOptions,
    maxAge: PENDING_MINUTES * 60 * 1000,
  });
}

function requirePending(stage) {
  return async (req, res, next) => {
    let payload;

    try {
      payload = verifyToken(req.cookies?.[PENDING_COOKIE]);

      if (payload.typ !== "pending" || payload.stage !== stage) {
        throw new Error("Wrong stage");
      }

      const result = await db.query(`SELECT token_version FROM users WHERE id = $1`, [payload.id]);

      if (!result.rows[0] || result.rows[0].token_version !== payload.ver) {
        throw new Error("Stale sign-in");
      }
    } catch {
      res.clearCookie(PENDING_COOKIE, baseCookieOptions);
      return res.status(401).json({
        error: "Your sign-in session expired. Please log in again.",
        restart: true,
      });
    }

    req.pending = payload;
    next();
  };
}

function nextStage(user) {
  if (!user.email_verified) return "verify_email";
  if (!user.totp_enabled) return "mfa_setup";
  return "mfa";
}

async function getUser(id) {
  const result = await db.query(
    `SELECT id, email, email_verified, totp_secret, totp_pending_secret, totp_enabled,
            totp_last_step, mfa_locked_until, login_locked_until, token_version
     FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}

async function withTransaction(callback) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function sendEmailCode(user, kind, { force = false } = {}) {
  const table = EMAIL_CODE_TABLES[kind];
  const existing = await db.query(
    `SELECT EXTRACT(EPOCH FROM (NOW() - sent_at)) AS age,
            expires_at > NOW() AS valid,
            CASE WHEN window_started_at > NOW() - INTERVAL '24 hours' THEN send_count ELSE 0 END AS sends_today
     FROM ${table} WHERE user_id = $1`,
    [user.id]
  );
  const row = existing.rows[0];

  if (row && row.valid && Number(row.age) < EMAIL_RESEND_SECONDS) {
    return { retryAfter: Math.ceil(EMAIL_RESEND_SECONDS - Number(row.age)) };
  }

  if (row && row.valid && !force) {
    return { sent: false };
  }

  if (row && Number(row.sends_today) >= EMAIL_MAX_SENDS_PER_DAY) {
    return { dailyLimit: true };
  }

  const code = mfa.generateEmailCode();

  await sendCodeEmail(user.email, code, kind);
  await db.query(
    `INSERT INTO ${table} (user_id, code_hash, attempts, expires_at, sent_at, send_count, window_started_at)
     VALUES ($1, $2, 0, NOW() + make_interval(mins => $3), NOW(), 1, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET code_hash = EXCLUDED.code_hash,
           attempts = 0,
           expires_at = EXCLUDED.expires_at,
           sent_at = EXCLUDED.sent_at,
           send_count = CASE WHEN ${table}.window_started_at > NOW() - INTERVAL '24 hours'
                             THEN ${table}.send_count + 1 ELSE 1 END,
           window_started_at = CASE WHEN ${table}.window_started_at > NOW() - INTERVAL '24 hours'
                                    THEN ${table}.window_started_at ELSE NOW() END`,
    [user.id, mfa.hashCode(code), EMAIL_CODE_MINUTES]
  );

  return { sent: true };
}

async function checkEmailCode(kind, userId, rawCode) {
  const table = EMAIL_CODE_TABLES[kind];
  const code = String(rawCode || "").replace(/\s/g, "");
  const result = await db.query(
    `SELECT code_hash, attempts, expires_at > NOW() AS valid
     FROM ${table} WHERE user_id = $1`,
    [userId]
  );
  const row = result.rows[0];

  if (!row || !row.valid) {
    return { status: 400, error: "This code has expired. Request a new one." };
  }

  if (row.attempts >= EMAIL_MAX_ATTEMPTS) {
    return { status: 429, error: "Too many attempts. Request a new code." };
  }

  if (!/^\d{6}$/.test(code) || !mfa.safeEqual(mfa.hashCode(code), row.code_hash)) {
    await db.query(`UPDATE ${table} SET attempts = attempts + 1 WHERE user_id = $1`, [userId]);
    return { status: 400, error: "Incorrect code. Please try again." };
  }

  return null;
}

function lockedMessage(until) {
  if (until && new Date(until) > new Date()) {
    const minutes = Math.ceil((new Date(until) - new Date()) / 60000);
    return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }

  return null;
}

async function recordFailure(userId, kind) {
  const [attemptsColumn, lockColumn, max, minutes] = kind === "login"
    ? ["failed_login_attempts", "login_locked_until", LOGIN_MAX_ATTEMPTS, LOGIN_LOCK_MINUTES]
    : ["mfa_failed_attempts", "mfa_locked_until", MFA_MAX_ATTEMPTS, MFA_LOCK_MINUTES];

  await db.query(
    `UPDATE users SET
       ${attemptsColumn} = CASE WHEN ${attemptsColumn} + 1 >= $2 THEN 0
                                ELSE ${attemptsColumn} + 1 END,
       ${lockColumn} = CASE WHEN ${attemptsColumn} + 1 >= $2
                            THEN NOW() + make_interval(mins => $3)
                            ELSE ${lockColumn} END
     WHERE id = $1`,
    [userId, max, minutes]
  );
}

async function verifySecondFactor(user, { code, recoveryCode }) {
  const locked = lockedMessage(user.mfa_locked_until);

  if (locked) {
    return { verified: false, status: 429, error: locked };
  }

  let verified = false;
  let recoveryCodesLeft;

  if (recoveryCode) {
    const used = await db.query(
      `UPDATE recovery_codes SET used_at = NOW()
       WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
       RETURNING id`,
      [user.id, mfa.hashCode(mfa.normalizeRecoveryCode(recoveryCode))]
    );
    verified = used.rowCount === 1;

    if (verified) {
      recoveryCodesLeft = await countRecoveryCodes(user.id);
    }
  } else {
    const step = mfa.verifyTotp(mfa.decryptSecret(user.totp_secret), code, user.totp_last_step);

    if (step !== null) {
      const updated = await db.query(
        `UPDATE users SET totp_last_step = $2
         WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
        [user.id, step]
      );
      verified = updated.rowCount === 1;
    }
  }

  if (!verified) {
    await recordFailure(user.id, "mfa");
    return {
      verified: false,
      status: 400,
      error: recoveryCode
        ? "That recovery code is invalid or has already been used."
        : "Incorrect code. Check your authenticator app and try again.",
    };
  }

  await db.query(
    `UPDATE users SET mfa_failed_attempts = 0, mfa_locked_until = NULL WHERE id = $1`,
    [user.id]
  );

  return { verified: true, recoveryCodesLeft };
}

async function countRecoveryCodes(userId) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count FROM recovery_codes
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  return result.rows[0].count;
}

async function replaceRecoveryCodes(client, userId) {
  const codes = mfa.generateRecoveryCodes();

  await client.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [userId]);

  for (const code of codes) {
    await client.query(
      `INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
      [userId, mfa.hashCode(mfa.normalizeRecoveryCode(code))]
    );
  }

  return codes;
}

async function mfaSetupPayload(secret, email) {
  return {
    qrCode: await QRCode.toDataURL(mfa.totpUri(secret, email), { margin: 1, width: 220 }),
    secret: secret.match(/.{1,4}/g).join(" "),
  };
}

function notifySecurityChange(email, kind) {
  sendSecurityNotice(email, kind).catch((err) => console.error(`Could not send the ${kind} notice:`, err.message));
}

module.exports = {
  notifySecurityChange,
  validatePassword,
  normalizeEmail,
  isValidEmail,
  verifyToken,
  hashSessionId,
  issueSession,
  renewSession,
  endSession,
  endAllSessions,
  removeExpiredSessions,
  clearSessionCookies,
  setPending,
  requirePending,
  nextStage,
  getUser,
  withTransaction,
  sendEmailCode,
  checkEmailCode,
  lockedMessage,
  recordFailure,
  verifySecondFactor,
  countRecoveryCodes,
  replaceRecoveryCodes,
  mfaSetupPayload,
};
