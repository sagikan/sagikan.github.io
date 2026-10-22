const express = require("express");
const db = require("../config/db");
const requireAuth = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const { APPLICATION_FIELDS } = require("../services/applicationFields");

const router = express.Router();

router.use(requireAuth, requireCsrf);

const allowedStatuses = ["Applied", "Interview", "Offer", "Rejected", "Withdrawn"];
const allowedWorkplaceModels = ["On-site", "Hybrid", "Remote"];
const applicationFields = {
  company: "company",
  position: "position",
  location: "location",
  workplace_model: "workplace_model",
  status: "status",
  job_url: "job_url",
  notes: "notes",
  applied_at: "applied_at"
}
const returnedFields = APPLICATION_FIELDS;

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
    const { company, position, location, workplace_model, status, job_url, notes, applied_at } = req.body;

    if (
      typeof company !== "string" || !company.trim() ||
      typeof position !== "string" || !position.trim() ||
      typeof location !== "string" || !location.trim()
    ) {
      return res.status(400).json({ error: "Company, position and location are required." });
    }

    if (!allowedStatuses.includes(status ?? "Applied")) {
      return res.status(400).json({ error: "Invalid status." });
    }

    if (workplace_model != null && !allowedWorkplaceModels.includes(workplace_model)) {
      return res.status(400).json({ error: "Invalid workplace model." });
    }

    const result = await db.query(
      `INSERT INTO applications
         (user_id, company, position, location, workplace_model, status, job_url, notes, applied_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${returnedFields}`,
      [
        req.user.id,
        company.trim(),
        position.trim(),
        location.trim(),
        workplace_model ?? null,
        status ?? "Applied",
        job_url ?? null,
        notes ?? null,
        applied_at ?? null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create application." });
  }
});

router.delete("/:id", async (req, res) => {
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

    if (!/^[1-9]\d*$/.test(id)) {
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
    };

    if (
      fields.filter(
        (field) => !Object.hasOwn(applicationFields, field)
      ).length > 0
    ) {
      return res.status(400).json({error: "One or more fields cannot be updated." });
    }

    for (const field of fields) {
      const value = updates[field];

      switch (field) {
        case "company":
        case "position":
        case "location":
          if (typeof value !== "string" || !value.trim()) {
            return res.status(400).json({ error: `${field} must be a non-empty string.` });
          }
          break;
        case "status":
          if (!allowedStatuses.includes(value)) {
            return res.status(400).json({ error: `Invalid ${field}.` });
          }
          break;
        case "workplace_model":
          if (value !== null && !allowedWorkplaceModels.includes(value)) {
            return res.status(400).json({ error: "Invalid workplace model." });
          }
          break;
        case "job_url":
        case "notes":
          if (value !== null && typeof value !== "string") {
            return res.status(400).json({ error: `${field} must be a string or null.` });
          }
          break;
        case "applied_at":
          if (
            value !== null &&
            (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
          ) {
            return res.status(400).json({ error: `${field} must be in YYYY-MM-DD format or null.` });
          }
          break;
        default:
          return res.status(400).json({ error: `${field} cannot be updated.` });
      }
    }

    const values = [];
    const assignments = fields.map((field, index) => {
      let value = updates[field];

      if (field === "company" || field === "position" || field === "location") {
        value = value.trim();
      }

      values.push(value);
      return `${applicationFields[field]} = $${index + 1}`;
    });

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
