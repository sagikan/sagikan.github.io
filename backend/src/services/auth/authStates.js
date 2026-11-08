const { createMachine } = require("../shared/stateMachine");

/* Sign-in steps. The step a user is on is kept in the pending cookie; each route names the move it makes, and only
   accepts a cookie for a step that move can start from. Which step comes next depends on the account (nextStage) */
const SIGN_IN = createMachine("sign-in", {
  initial: "credentials",
  states: {
    credentials: { register: "verify_email", logIn: ["verify_email", "mfa_setup", "mfa"] },
    verify_email: { resendCode: "verify_email", verifyEmail: ["mfa_setup", "mfa"] },
    mfa_setup: { startAuthenticator: "mfa_setup", confirmAuthenticator: "signed_in" },
    mfa: { verifySecondFactor: "signed_in" },
    signed_in: {}
  }
});
// Steps that are skipped once the account has done them, in order; a user who has done them all is asked for 2FA
const SETUP_STEPS = [
  { stage: "verify_email", done: (user) => user.email_verified },
  { stage: "mfa_setup", done: (user) => user.totp_enabled }
];
/* Failed attempts lock sign-in (or 2FA) for a while: a failure either keeps it open, counting, or locks it and resets
   the count. A lock ends when its time runs out, or for sign-in when the password is reset */
const LOCKOUT = createMachine("lockout", {
  initial: "open",
  states: {
    open: { fail: ["open", "locked"], succeed: "open", resetPassword: "open" },
    locked: { expire: "open", resetPassword: "open" }
  }
});
const LOCKS = {
  login: { attempts: "failed_login_attempts", until: "login_locked_until", max: 10, minutes: 15 },
  mfa: { attempts: "mfa_failed_attempts", until: "mfa_locked_until", max: 5, minutes: 15 }
};
/* An emailed code (email verification or password reset). Sending replaces any code with a fresh one; it's then
   active until it expires, it's used, or too many wrong tries use it up */
const EMAIL_CODE = createMachine("email code", {
  initial: "missing",
  states: {
    missing: { send: "active" },
    active: { send: "active", wrongCode: ["active", "used_up"], use: "missing", expire: "expired" },
    used_up: { send: "active", expire: "expired" },
    expired: { send: "active" }
  }
});
const EMAIL_CODE_MAX_ATTEMPTS = 5;
/* The authenticator. Sign-up stores a secret that becomes active once a code from it is confirmed. Replacing it later
   keeps the old one working until a code from the new one is confirmed, which must happen within
   REPLACE_AUTHENTICATOR_MINUTES; after that the replacement expires */
const AUTHENTICATOR = createMachine("authenticator", {
  initial: "none",
  states: {
    none: { start: "setting_up" },
    setting_up: { start: "setting_up", confirm: "enabled" },
    enabled: { startReplacing: "replacing" },
    replacing: { startReplacing: "replacing", confirmReplacing: "enabled", expire: "enabled" }
  }
});
const REPLACE_AUTHENTICATOR_MINUTES = 15;

// Returns the next sign-in step for a user
function nextStage(user) {
  return SETUP_STEPS.find(({ done }) => !done(user))?.stage ?? "mfa";
}

// Returns whether a lock is in place, given the time it ends
function lockState(until, now = new Date()) {
  return until && new Date(until) > now ? "locked" : "open";
}

// Builds the SQL that clears a lock and its failed attempts
function unlockSql(kind) {
  return `${LOCKS[kind].attempts} = 0, ${LOCKS[kind].until} = NULL`;
}

// Returns the state of a stored email code, from its row (valid means not expired)
function codeState(row) {
  if (!row) return "missing";
  if (!row.valid) return "expired";

  return row.attempts >= EMAIL_CODE_MAX_ATTEMPTS ? "used_up" : "active";
}

// Returns the state of a user's authenticator from their account fields; a replacement without a recent start has expired
function authenticatorState(user, now = new Date()) {
  if (user.totp_enabled) {
    const startedAt = user.totp_pending_at ? new Date(user.totp_pending_at).getTime() : null;
    const current = startedAt !== null && now.getTime() - startedAt < REPLACE_AUTHENTICATOR_MINUTES * 60 * 1000;

    return user.totp_pending_secret && current ? "replacing" : "enabled";
  }

  return user.totp_secret ? "setting_up" : "none";
}

module.exports = {
  SIGN_IN,
  LOCKOUT,
  LOCKS,
  EMAIL_CODE,
  EMAIL_CODE_MAX_ATTEMPTS,
  AUTHENTICATOR,
  REPLACE_AUTHENTICATOR_MINUTES,
  nextStage,
  lockState,
  unlockSql,
  codeState,
  authenticatorState
};
