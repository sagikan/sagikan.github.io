const express = require("express");
const db = require("../config/db");
const requireAuth = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const { APPLICATION_FIELDS, MAX_APPLICATIONS, checkApplicationField } = require("../services/applicationFields");

const router = express.Router();

router.use(requireAuth, requireCsrf);

const ID_PATTERN = /^[1-9]\d{0,17}$/;
const applicationFields = {
  company: "company",
  position: "position",
  location: "location",
  workplace_model: "workplace_model",
  status: "status",
  job_url: "job_url",
  notes: "notes",
  applied_at: "applied_at"
};
const returnedFields = APPLICATION_FIELDS;

function cleanValue(field, value) {
  return typeof value === "string" ? value.trim() || (["job_url", "notes"].includes(field) ? null : value) : value;
}

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

router.post("/", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const values = {
      company: body.company,
      position: body.position,
      location: body.location,
      workplace_model: body.workplace_model ?? null,
      status: body.status ?? "Applied",
      job_url: cleanValue("job_url", body.job_url ?? null),
      notes: cleanValue("notes", body.notes ?? null),
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

    const count = await db.query(`SELECT COUNT(*)::int AS count FROM applications WHERE user_id = $1`, [req.user.id]);

    if (count.rows[0].count >= MAX_APPLICATIONS) {
      return res.status(400).json({ error: `You can keep up to ${MAX_APPLICATIONS} applications. Delete some old ones first.` });
    }

    const result = await db.query(
      `INSERT INTO applications
         (user_id, company, position, location, workplace_model, status, job_url, notes, applied_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${returnedFields}`,
      [
        req.user.id,
        values.company.trim(),
        values.position.trim(),
        values.location.trim(),
        values.workplace_model,
        values.status,
        values.job_url,
        values.notes,
        values.applied_at
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create application." });
  }
});

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

    const fields = Object.keys(updates);

    if (fields.length === 0) {
      return res.status(400).json({ error: "At least one field must be provided." });
    }

    if (fields.some((field) => !Object.hasOwn(applicationFields, field))) {
      return res.status(400).json({ error: "One or more fields cannot be updated." });
    }

    const values = [];
    const assignments = [];

    for (const field of fields) {
      const value = cleanValue(field, updates[field]);
      const problem = checkApplicationField(field, value);

      if (problem) {
        return res.status(400).json({ error: problem });
      }

      values.push(value);
      assignments.push(`${applicationFields[field]} = $${values.length}`);
    }

    values.push(id);
    const idParam = values.length;
    values.push(req.user.id);
    const userIdParam = values.length;
    const result = await db.query(
      `UPDATE applications
       SET ${assignments.join(", ")}
       WHERE id = $${idParam} AND user_id = $${userIdParam}
       RETURNING ${returnedFields}`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Application not found." });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update application." });
  }
});

module.exports = router;
