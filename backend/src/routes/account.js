const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const requireAuth = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const mfa = require("../services/auth/mfa");
const auth = require("../services/auth/authService");

const router = express.Router();

router.use(requireAuth, requireCsrf);

// Returns how many recovery codes are left
router.get("/security", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");

    res.json({ recoveryCodesLeft: await auth.countRecoveryCodes(req.user.id) });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: "Could not load security settings." });
  }
});

// Replaces the recovery codes after a second-factor check
router.post("/recovery-codes", async (req, res) => {
  try {
    const user = await auth.getUser(req.user.id);
    const result = await auth.verifySecondFactor(user, req.body);

    if (!result.verified) {
      return res.status(result.status).json({ error: result.error });
    }

    const recoveryCodes = await auth.withTransaction((client) =>
      auth.replaceRecoveryCodes(client, user.id)
    );

    auth.notifySecurityChange(user.email, "recovery_codes");
    res.set("Cache-Control", "no-store");

    res.json({ recoveryCodes });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: "Could not generate recovery codes." });
  }
});

// Starts a 2FA reset by checking the password and second factor
router.post("/mfa/reset/start", async (req, res) => {
  try {
    const user = await auth.getUser(req.user.id);
    const locked = auth.lockedMessage(user.mfa_locked_until);

    if (locked) {
      return res.status(429).json({ error: locked });
    }

    const passwordResult = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);

    if (
      typeof req.body.password !== "string" ||
      !(await bcrypt.compare(req.body.password, passwordResult.rows[0].password_hash))
    ) {
      await auth.recordFailure(user.id, "mfa");

      return res.status(400).json({ error: "Incorrect password." });
    }

    const result = await auth.verifySecondFactor(user, req.body);

    if (!result.verified) {
      return res.status(result.status).json({ error: result.error });
    }

    const secret = mfa.generateTotpSecret();

    await db.query(
      `UPDATE users SET totp_pending_secret = $2 WHERE id = $1`,
      [user.id, mfa.encryptSecret(secret)]
    );

    res.set("Cache-Control", "no-store");

    res.json(await auth.mfaSetupPayload(secret, user.email));
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: "Could not start authenticator reset." });
  }
});

// Confirms the new authenticator and finishes the 2FA reset
router.post("/mfa/reset/confirm", async (req, res) => {
  try {
    const user = await auth.getUser(req.user.id);
    const locked = auth.lockedMessage(user.mfa_locked_until);

    if (locked) {
      return res.status(429).json({ error: locked });
    }

    if (!user.totp_pending_secret) {
      return res.status(400).json({ error: "Please start the authenticator reset again." });
    }

    const step = mfa.verifyTotp(mfa.decryptSecret(user.totp_pending_secret), req.body.code, null);

    if (step === null) {
      await auth.recordFailure(user.id, "mfa");

      return res.status(400).json({ error: "Incorrect code. Check your new authenticator app and try again." });
    }

    const recoveryCodes = await auth.withTransaction(async (client) => {
      await client.query(
        `UPDATE users
         SET totp_secret = totp_pending_secret, totp_pending_secret = NULL,
             totp_last_step = $2, mfa_failed_attempts = 0, mfa_locked_until = NULL,
             token_version = token_version + 1
         WHERE id = $1`,
        [user.id, step]
      );
      await auth.endAllSessions(client, user.id);

      return auth.replaceRecoveryCodes(client, user.id);
    });

    auth.notifySecurityChange(user.email, "mfa_reset");
    await auth.issueSession(res, await auth.getUser(user.id));
    res.set("Cache-Control", "no-store");

    res.json({ recoveryCodes });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: "Could not complete authenticator reset." });
  }
});

// Deletes the account after a password and second-factor check
router.post("/delete", async (req, res) => {
  try {
    const user = await auth.getUser(req.user.id);
    const locked = auth.lockedMessage(user.mfa_locked_until);

    if (locked) {
      return res.status(429).json({ error: locked });
    }

    if (req.body.confirm !== "DELETE") {
      return res.status(400).json({ error: "Type DELETE to confirm." });
    }

    const passwordResult = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);

    if (
      typeof req.body.password !== "string" ||
      !(await bcrypt.compare(req.body.password, passwordResult.rows[0].password_hash))
    ) {
      await auth.recordFailure(user.id, "mfa");

      return res.status(400).json({ error: "Incorrect password." });
    }

    const result = await auth.verifySecondFactor(user, req.body);

    if (!result.verified) {
      return res.status(result.status).json({ error: result.error });
    }

    await db.query(`DELETE FROM users WHERE id = $1`, [user.id]);

    auth.notifySecurityChange(user.email, "account_deleted");
    auth.clearSessionCookies(res);

    res.json({ message: "Your account has been deleted." });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: "Could not delete account." });
  }
});

module.exports = router;
