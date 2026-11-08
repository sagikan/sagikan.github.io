import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createApplication, createUser } from "../../../../tests/db/helpers";

const require = createRequire(import.meta.url);
const db = require("../../../config/db");
const emailService = require("../emailService");

const DAY_MS = 24 * 3600 * 1000;

// Records an email event in the given state, created and resolved the given number of days ago
async function addEvent(userId, state, { createdDays = 0, resolvedDays = null, applicationId = null } = {}) {
  const { rows } = await db.query(
    `INSERT INTO email_events (user_id, message_id, suggested_status, application_id, state, created_at, resolved_at)
     VALUES ($1, $2, 'Interview', $3, $4, $5, $6)
     RETURNING id`,
    [
      userId,
      `msg-${Math.random()}`,
      applicationId,
      state,
      new Date(Date.now() - createdDays * DAY_MS),
      resolvedDays === null ? null : new Date(Date.now() - resolvedDays * DAY_MS)
    ]
  );

  return rows[0].id;
}

// Returns each event's state by its ID, leaving out deleted ones
async function statesById() {
  const { rows } = await db.query("SELECT id, state FROM email_events");

  return Object.fromEntries(rows.map((row) => [row.id, row.state]));
}

describe("cleanUpEvents", () => {
  it("expires suggestions waiting more than 30 days, and leaves newer ones pending", async () => {
    const user = await createUser({ email: "dana@example.com" });
    const old = await addEvent(user.id, "pending", { createdDays: 31 });
    const fresh = await addEvent(user.id, "pending", { createdDays: 29 });

    const result = await emailService.cleanUpEvents();
    const expired = (await db.query("SELECT resolved_at FROM email_events WHERE id = $1", [old])).rows[0];

    expect(result).toEqual({ expired: 1, removed: 0 });
    expect(await statesById()).toEqual({ [old]: "expired", [fresh]: "pending" });
    expect(Date.now() - new Date(expired.resolved_at).getTime()).toBeLessThan(60 * 1000);
  });

  it("removes events that led nowhere after 90 days, and keeps the ones that changed a status", async () => {
    const user = await createUser({ email: "dana@example.com" });
    const application = await createApplication(user.id);
    const keptIgnored = await addEvent(user.id, "ignored", { createdDays: 89 });
    const keptDismissed = await addEvent(user.id, "dismissed", { createdDays: 120, resolvedDays: 80 });
    const accepted = await addEvent(user.id, "accepted", { createdDays: 400, resolvedDays: 400, applicationId: application.id });
    const auto = await addEvent(user.id, "auto_applied", { createdDays: 400, resolvedDays: 400, applicationId: application.id });

    await addEvent(user.id, "ignored", { createdDays: 91 });
    await addEvent(user.id, "dismissed", { createdDays: 100, resolvedDays: 91 });
    await addEvent(user.id, "undone", { createdDays: 100, resolvedDays: 91 });
    await addEvent(user.id, "expired", { createdDays: 130, resolvedDays: 95 });

    const result = await emailService.cleanUpEvents();

    expect(result).toEqual({ expired: 0, removed: 4 });
    expect(await statesById()).toEqual({
      [keptIgnored]: "ignored",
      [keptDismissed]: "dismissed",
      [accepted]: "accepted",
      [auto]: "auto_applied"
    });
  });

  it("keeps an expired suggestion for 90 days after it expired", async () => {
    const user = await createUser({ email: "dana@example.com" });
    const old = await addEvent(user.id, "pending", { createdDays: 200 });

    await emailService.cleanUpEvents();

    expect(await statesById()).toEqual({ [old]: "expired" });
  });
});
