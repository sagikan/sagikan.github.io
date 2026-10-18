const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const requireAuth = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const mfa = require("../services/mfa");
const auth = require("../services/authService");
const { loginLimiter, registerLimiter, passwordResetLimiter, codeLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const DUMMY_PASSWORD_HASH = bcrypt.hashSync("not-a-real-password", 12);

router.get("/csrf", requireAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ csrfToken: req.user.csrfToken });
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email FROM users WHERE id = $1`,
      [req.user.id]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    res.set("Cache-Control", "no-store");
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load user." });
  }
});

router.post("/register", registerLimiter, async (req, res) => {
  try {
    const email = auth.normalizeEmail(req.body.email);
    const password = req.body.password;

    if (!auth.isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const passwordError = auth.validatePassword(password, email);

    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email`,
      [email, passwordHash]
    );
    const user = result.rows[0];

    auth.setPending(res, user.id, "verify_email");

    let emailSent = true;

    try {
      await auth.sendEmailCode(user, "verify", { force: true });
    } catch (err) {
      console.error(err);
      emailSent = false;
    }

    res.status(201).json({ next: "verify_email", email: user.email, emailSent });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "An account with this email already exists."
      });
    }

    console.error(err);
    res.status(500).json({ error: "Could not create account." });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const email = auth.normalizeEmail(req.body.email);
    const password = req.body.password;

    if (typeof password !== "string") {
      return res.status(400).json({ error: "Invalid credentials." });
    }

    const result = await db.query(
      `SELECT id, email, password_hash, email_verified, totp_enabled, login_locked_until
       FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];

    const locked = user && auth.lockedMessage(user.login_locked_until);

    if (locked) {
      return res.status(429).json({ error: `${locked} You can also reset your password.` });
    }

    const passwordMatches = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);

    if (!user || !passwordMatches) {
      if (user) {
        await auth.recordFailure(user.id, "login");
      }

      return res.status(401).json({ error: "Invalid credentials." });
    }

    await db.query(
      `UPDATE users SET failed_login_attempts = 0, login_locked_until = NULL WHERE id = $1`,
      [user.id]
    );

    const next = auth.nextStage(user);
    auth.setPending(res, user.id, next);

    let emailSent = true;

    if (next === "verify_email") {
      try {
        await auth.sendEmailCode(user, "verify");
      } catch (err) {
        console.error(err);
        emailSent = false;
      }
    }

    res.json({ next, email: user.email, emailSent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not log in." });
  }
});

router.post("/verify-email", codeLimiter, auth.requirePending("verify_email"), async (req, res) => {
  try {
    const codeError = await auth.checkEmailCode("verify", req.pending.id, req.body.code);

    if (codeError) {
      return res.status(codeError.status).json({ error: codeError.error });
    }

    await auth.withTransaction(async (client) => {
      await client.query(`UPDATE users SET email_verified = TRUE WHERE id = $1`, [req.pending.id]);
      await client.query(`DELETE FROM email_verifications WHERE user_id = $1`, [req.pending.id]);
    });

    const user = await auth.getUser(req.pending.id);
    const next = auth.nextStage(user);
    auth.setPending(res, user.id, next);

    res.json({ next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not verify email." });
  }
});

router.post("/resend-verification", codeLimiter, auth.requirePending("verify_email"), async (req, res) => {
  try {
    const user = await auth.getUser(req.pending.id);
    const retryAfter = await auth.sendEmailCode(user, "verify", { force: true });

    if (retryAfter > 0) {
      return res.status(429).json({
        error: `Please wait ${retryAfter} seconds before requesting a new code.`,
        retryAfter,
      });
    }

    res.json({ message: "A new code has been sent." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not send the verification email." });
  }
});

router.post("/mfa/setup", codeLimiter, auth.requirePending("mfa_setup"), async (req, res) => {
  try {
    const user = await auth.getUser(req.pending.id);

    if (!user || user.totp_enabled) {
      return res.status(400).json({ error: "Two-factor authentication is already set up.", restart: true });
    }

    const secret = mfa.generateTotpSecret();

    await db.query(
      `UPDATE users SET totp_secret = $2, totp_last_step = NULL WHERE id = $1`,
      [user.id, mfa.encryptSecret(secret)]
    );

    res.set("Cache-Control", "no-store");
    res.json(await auth.mfaSetupPayload(secret, user.email));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not start two-factor setup." });
  }
});

router.post("/mfa/setup/confirm", codeLimiter, auth.requirePending("mfa_setup"), async (req, res) => {
  try {
    const user = await auth.getUser(req.pending.id);
    const locked = auth.lockedMessage(user.mfa_locked_until);

    if (locked) {
      return res.status(429).json({ error: locked });
    }

    if (!user.totp_secret || user.totp_enabled) {
      return res.status(400).json({ error: "Please restart two-factor setup.", restart: true });
    }

    const step = mfa.verifyTotp(mfa.decryptSecret(user.totp_secret), req.body.code, null);

    if (step === null) {
      await auth.recordFailure(user.id, "mfa");
      return res.status(400).json({ error: "Incorrect code. Check your authenticator app and try again." });
    }

    const recoveryCodes = await auth.withTransaction(async (client) => {
      await client.query(
        `UPDATE users
         SET totp_enabled = TRUE, totp_last_step = $2,
             mfa_failed_attempts = 0, mfa_locked_until = NULL
         WHERE id = $1`,
        [user.id, step]
      );
      return auth.replaceRecoveryCodes(client, user.id);
    });

    auth.issueSession(res, user);
    res.set("Cache-Control", "no-store");
    res.json({ user: { id: user.id, email: user.email }, recoveryCodes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not complete two-factor setup." });
  }
});

router.post("/mfa/verify", codeLimiter, auth.requirePending("mfa"), async (req, res) => {
  try {
    const user = await auth.getUser(req.pending.id);
    const result = await auth.verifySecondFactor(user, req.body);

    if (!result.verified) {
      return res.status(result.status).json({ error: result.error });
    }

    auth.issueSession(res, user);
    res.json({ user: { id: user.id, email: user.email }, recoveryCodesLeft: result.recoveryCodesLeft });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not verify code." });
  }
});

const RESET_SENT_MESSAGE = "If an account exists for that email, we've sent a reset code to it.";

router.post("/password/forgot", passwordResetLimiter, async (req, res) => {
  try {
    const email = auth.normalizeEmail(req.body.email);

    if (!auth.isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const result = await db.query(`SELECT id, email FROM users WHERE email = $1`, [email]);
    const user = result.rows[0];

    if (user) {
      auth.sendEmailCode(user, "reset", { force: true }).catch((err) => console.error(err));
    }

    res.json({ message: RESET_SENT_MESSAGE });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not start password reset." });
  }
});

router.post("/password/reset", passwordResetLimiter, async (req, res) => {
  try {
    const email = auth.normalizeEmail(req.body.email);
    const password = req.body.password;

    const passwordError = auth.validatePassword(password, email);

    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const result = await db.query(`SELECT id FROM users WHERE email = $1`, [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ error: "This code has expired. Request a new one." });
    }

    const codeError = await auth.checkEmailCode("reset", user.id, req.body.code);

    if (codeError) {
      return res.status(codeError.status).json({ error: codeError.error });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await auth.withTransaction(async (client) => {
      await client.query(
        `UPDATE users
         SET password_hash = $2, email_verified = TRUE,
             failed_login_attempts = 0, login_locked_until = NULL,
             token_version = token_version + 1
         WHERE id = $1`,
        [user.id, passwordHash]
      );
      await client.query(`DELETE FROM password_resets WHERE user_id = $1`, [user.id]);
      await client.query(`DELETE FROM email_verifications WHERE user_id = $1`, [user.id]);
    });

    auth.clearSessionCookies(res);
    res.json({ message: "Your password has been reset. You can now log in." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not reset password." });
  }
});

router.post("/logout", requireAuth, requireCsrf, (req, res) => {
  auth.clearSessionCookies(res);
  res.json({ message: "Logged out successfully." });
});

module.exports = router;
