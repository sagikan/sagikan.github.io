const express = require("express");
const db = require("../config/db");
const requireAuth = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const auth = require("../services/auth/authService");
const { APPLICATION_FIELDS, MAX_APPLICATIONS, checkApplicationField, isCalendarDate } = require("../services/applications/applicationFields");
const { savedNoteState } = require("../services/applications/noteStates");
const { FIRST_STATUS } = require("../services/applications/statusStates");
const steps = require("../services/applications/applicationSteps");

const router = express.Router();
const ID_PATTERN = /^[1-9]\d{0,17}$/;
const applicationFields = {
  company: "company",
  position: "position",
  location: "location",
  workplace_model: "workplace_model",
  status: "status",
  job_url: "job_url",
  notes: "notes",
  notes_auto: "notes_auto",
  applied_at: "applied_at"
};
const returnedFields = APPLICATION_FIELDS;

router.use(requireAuth, requireCsrf);

// Trims a string value and turns empty optional fields into null
function cleanValue(field, value) {
  return typeof value === "string" ? value.trim() || (["job_url", "notes"].includes(field) ? null : value) : value;
}

// Sends a refused step change's status, or logs the error and sends a generic message
function fail(res, err, fallback) {
  if (err instanceof steps.StepError) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error(err);

  res.status(500).json({ error: fallback });
}

// Returns an error message when an applied date is later than today for the user
function futureAppliedAt(appliedAt) {
  return appliedAt && appliedAt > steps.latestDate() ? "The applied date can't be in the future." : null;
}

// Reads and checks a step's status and date from a request body
function stepBody(body) {
  const value = body && typeof body === "object" && !Array.isArray(body) ? body : {};

  if (value.status !== undefined && checkApplicationField("status", value.status)) {
    throw new steps.StepError(400, "Invalid status.");
  }

  if (value.date !== undefined && !isCalendarDate(value.date)) {
    throw new steps.StepError(400, "date must be a real date in YYYY-MM-DD format.");
  }

  return { status: value.status, date: value.date };
}

// Checks the application ID in the URL, and the step ID when there is one
function checkIds(req) {
  if (!ID_PATTERN.test(req.params.id)) {
    throw new steps.StepError(400, "Invalid application ID.");
  }

  if (req.params.stepId !== undefined && !ID_PATTERN.test(req.params.stepId)) {
    throw new steps.StepError(400, "Invalid step ID.");
  }
}

// Lists the user's applications
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ${returnedFields}
       FROM applications
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: "Could not load applications." });
  }
});

// Creates an application; a status other than the first one becomes a second step after it
router.post("/", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const values = {
      company: body.company,
      position: body.position,
      location: body.location,
      workplace_model: body.workplace_model ?? null,
      status: body.status ?? FIRST_STATUS,
      job_url: cleanValue("job_url", body.job_url ?? null),
      notes: cleanValue("notes", body.notes ?? null),
      notes_auto: body.notes_auto ?? false,
      applied_at: body.applied_at || null
    };

    if (
      typeof values.company !== "string" || !values.company.trim() ||
      typeof values.position !== "string" || !values.position.trim() ||
      typeof values.location !== "string" || !values.location.trim()
    ) {
      return res.status(400).json({ error: "Company, position and location are required." });
    }

    for (const [field, value] of Object.entries(values)) {
      const problem = checkApplicationField(field, value);

      if (problem) {
        return res.status(400).json({ error: problem });
      }
    }

    const future = futureAppliedAt(values.applied_at);

    if (future) {
      return res.status(400).json({ error: future });
    }

    values.notes_auto = savedNoteState(values.notes, values.notes_auto) === "automatic";
    // The applied date is the first step's, so an application sent without one was applied for today
    values.applied_at = values.applied_at || steps.serverToday();

    const count = await db.query(`SELECT COUNT(*)::int AS count FROM applications WHERE user_id = $1`, [req.user.id]);

    if (count.rows[0].count >= MAX_APPLICATIONS) {
      return res.status(400).json({ error: `You can keep up to ${MAX_APPLICATIONS} applications. Delete some old ones first.` });
    }

    const application = await auth.withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO applications
           (user_id, company, position, location, workplace_model, status, job_url, notes, notes_auto, applied_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          req.user.id,
          values.company.trim(),
          values.position.trim(),
          values.location.trim(),
          values.workplace_model,
          FIRST_STATUS,
          values.job_url,
          values.notes,
          values.notes_auto,
          values.applied_at
        ]
      );
      const applicationId = inserted.rows[0].id;

      await steps.startJourney(client, { applicationId, userId: req.user.id, status: values.status, appliedAt: values.applied_at });

      return steps.loadApplication(client, applicationId);
    });

    res.status(201).json(application);
  } catch (err) {
    fail(res, err, "Could not create application.");
  }
});

// Deletes an application
router.delete("/:id", async (req, res) => {
  if (!ID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid application ID." });
  }

  try {
    const result = await db.query(
      `DELETE FROM applications
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Application not found." });
    }

    res.status(204).end();
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: "Could not delete application." });
  }
});

/* Updates the given fields of an application. A new status adds a step dated today, and an applied date moves the
   first step's date; null keeps it, since every application has one */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Invalid application ID." });
    }

    const updates = req.body;

    if (
      !updates ||
      typeof updates !== "object" ||
      Array.isArray(updates)
    ) {
      return res.status(400).json({ error: "Invalid request body." });
    }

    const changes = { ...updates };

    if (Object.hasOwn(changes, "notes_auto") && !Object.hasOwn(changes, "notes")) {
      return res.status(400).json({ error: "notes_auto can only be sent together with notes." });
    }

    // A note saved without saying whether it is automatic is a written one
    if (Object.hasOwn(changes, "notes")) {
      changes.notes_auto ??= false;
    }

    if (typeof changes.notes_auto === "boolean") {
      changes.notes_auto = savedNoteState(cleanValue("notes", changes.notes), changes.notes_auto) === "automatic";
    }

    const fields = Object.keys(changes);

    if (fields.length === 0) {
      return res.status(400).json({ error: "At least one field must be provided." });
    }

    if (fields.some((field) => !Object.hasOwn(applicationFields, field))) {
      return res.status(400).json({ error: "One or more fields cannot be updated." });
    }

    const values = [];
    const assignments = [];

    for (const field of fields) {
      const value = cleanValue(field, changes[field]);
      const problem = checkApplicationField(field, value);

      if (problem) {
        return res.status(400).json({ error: problem });
      }

      changes[field] = value;

      // The status and the applied date live in the steps, saved below; a null applied date keeps the first step's
      if (field === "status" || field === "applied_at") {
        continue;
      }

      values.push(value);
      assignments.push(`${applicationFields[field]} = $${values.length}`);
    }

    const future = futureAppliedAt(changes.applied_at);

    if (future) {
      return res.status(400).json({ error: future });
    }

    const application = await auth.withTransaction(async (client) => {
      const journey = await steps.lockSteps(client, id, req.user.id);

      if (changes.applied_at) {
        await steps.changeStep(client, { applicationId: id, steps: journey, index: 0, date: changes.applied_at });
      }

      if (changes.status !== undefined && changes.status !== journey[journey.length - 1].status) {
        const date = steps.nextStepDate(journey);

        await steps.addStep(client, { applicationId: id, userId: req.user.id, steps: journey, status: changes.status, date });
      }

      if (assignments.length) {
        values.push(id);
        await client.query(`UPDATE applications SET ${assignments.join(", ")} WHERE id = $${values.length}`, values);
      }

      return steps.loadApplication(client, id);
    });

    res.json(application);
  } catch (err) {
    fail(res, err, "Could not update application.");
  }
});

// Adds a new current step: a status that may follow the current one, dated today unless a date is given
router.post("/:id/steps", async (req, res) => {
  try {
    checkIds(req);

    const { status, date } = stepBody(req.body);

    if (status === undefined) {
      throw new steps.StepError(400, "Choose a status.");
    }

    const application = await auth.withTransaction(async (client) => {
      const journey = await steps.lockSteps(client, req.params.id, req.user.id);

      await steps.addStep(client, { applicationId: req.params.id, userId: req.user.id, steps: journey, status, date: date ?? steps.nextStepDate(journey) });

      return steps.loadApplication(client, req.params.id);
    });

    res.status(201).json(application);
  } catch (err) {
    fail(res, err, "Could not add the status.");
  }
});

// Changes a step's status or date
router.patch("/:id/steps/:stepId", async (req, res) => {
  try {
    checkIds(req);

    const { status, date } = stepBody(req.body);

    if (status === undefined && date === undefined) {
      throw new steps.StepError(400, "Send a status or a date.");
    }

    const application = await auth.withTransaction(async (client) => {
      const journey = await steps.lockSteps(client, req.params.id, req.user.id);
      const index = steps.stepIndex(journey, req.params.stepId);

      await steps.changeStep(client, { applicationId: req.params.id, steps: journey, index, status, date });

      return steps.loadApplication(client, req.params.id);
    });

    res.json(application);
  } catch (err) {
    fail(res, err, "Could not change the step.");
  }
});

// Removes a step: an earlier one, or the current one (undo), which makes the step before it current again
router.delete("/:id/steps/:stepId", async (req, res) => {
  try {
    checkIds(req);

    const application = await auth.withTransaction(async (client) => {
      const journey = await steps.lockSteps(client, req.params.id, req.user.id);
      const index = steps.stepIndex(journey, req.params.stepId);

      await steps.removeStep(client, { applicationId: req.params.id, steps: journey, index });

      return steps.loadApplication(client, req.params.id);
    });

    res.json(application);
  } catch (err) {
    fail(res, err, "Could not remove the step.");
  }
});

module.exports = router;
