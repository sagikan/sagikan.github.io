/* The version of the privacy policy, as the date it was last changed (YYYY-MM-DD).
   Change it whenever the policy changes: users who haven't seen this version are told about the update */
export const POLICY_VERSION = "2026-10-31";

// Formats the policy's date for display
export function policyDate() {
  return new Date(`${POLICY_VERSION}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/* Checks whether to tell the user the policy was updated: they must be signed in, their last seen version must be loaded
   (undefined means not loaded yet) and differ, and they must not already be reading the policy */
export function needsPolicyNotice({ authenticated, seenVersion, route }) {
  return authenticated && seenVersion !== undefined && seenVersion !== POLICY_VERSION && route !== "/privacy";
}
