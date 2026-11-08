import { createMachine } from "../../lib/stateMachine";

const ACCOUNT_PANELS = ["codes", "authenticator", "delete", "email", "emailDisconnect"];

/* Whether the server can be reached: checked when the app loads, then updated by every request, which reports whether
   the server answered (onReachability in lib/api.js) */
export const API_HEALTH = createMachine("server health", {
  initial: "checking",
  states: {
    checking: { online: "online", offline: "offline" },
    online: { online: "online", offline: "offline" },
    offline: { online: "online", offline: "offline" }
  }
});

/* The app's session. On load it restores the sign-in, and stays restoring until the user's data has loaded (data
   arriving meanwhile doesn't end it early). Signing out, or a request that finds the session gone, leaves the user
   signed out, and a restore that finishes after that changes nothing */
export const SESSION = createMachine("session", {
  initial: "restoring",
  states: {
    restoring: { restore: "signed_in", signIn: "restoring", signOut: "signed_out" },
    signed_out: { signIn: "signed_in", signOut: "signed_out", restore: "signed_out" },
    signed_in: { signIn: "signed_in", signOut: "signed_out" }
  }
});

/* The sign-in page. The server decides which step comes after the credentials and after verifying the email (the same
   steps as SIGN_IN in the backend's authStates); the rest happen on this page. Going back restarts from the credentials,
   except on the recovery codes, which must be seen once */
export const SIGN_IN_STEPS = createMachine("sign-in", {
  initial: "credentials",
  states: {
    credentials: { submitted: ["verify_email", "mfa_setup", "mfa"], forgotPassword: "forgot_password", restart: "credentials" },
    verify_email: { verified: ["mfa_setup", "mfa"], restart: "credentials" },
    mfa_setup: { confirmed: "recovery_codes", restart: "credentials" },
    recovery_codes: {},
    mfa: { restart: "credentials" },
    forgot_password: { codeSent: "reset_password", restart: "credentials" },
    reset_password: { restart: "credentials" }
  }
});

/* Moving 2FA to a new authenticator: confirm it's you, link the new app, then save the new recovery codes. The server
   only waits 15 minutes for the new app's code; after that the reset expires and starts again from the first step */
export const AUTHENTICATOR_RESET = createMachine("authenticator reset", {
  initial: "verify",
  states: {
    verify: { verified: "setup" },
    setup: { confirmed: "codes", expired: "verify" },
    codes: {}
  }
});

// The Account page shows one settings panel at a time; opening another replaces it
export const ACCOUNT_PANEL = createMachine("account panel", {
  initial: "closed",
  states: Object.fromEntries(["closed", ...ACCOUNT_PANELS].map((panel) => [panel, { open: ACCOUNT_PANELS, close: "closed" }]))
});
