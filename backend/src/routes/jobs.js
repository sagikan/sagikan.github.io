const express = require("express");
const { rateLimit } = require("express-rate-limit");
const db = require("../config/db");
const requireAuth = require("../middleware/auth");
const { requireCsrf } = require("../middleware/csrf");
const claude = require("../services/anthropic");
const profiles = require("../services/cvProfile");
const jobSearch = require("../services/jobSearch");
const cvTailor = require("../services/cvTailor");
const { APPLICATION_FIELDS } = require("../services/applicationFields");

const router = express.Router();

router.use(requireAuth, requireCsrf);

const MAX_CV_PAGES = 10;
const FULL_DESCRIPTION_MIN = 1200;
const JOB_FIELDS = `
  id, source, company, position, location, workplace_model, url, description,
  match_score, match_reason, match_have, match_missing, state, application_id, created_at,
  TO_CHAR(posted_at, 'YYYY-MM-DD') AS posted_at,
  EXISTS (SELECT 1 FROM cv_tailorings WHERE cv_tailorings.job_id = jobs.id) AS has_tailoring
`;
const TAILORING_FIELDS = `job_id, cv, gaps, flags, include_grade_sheet, updated_at`;

function userLimiter(limit, minutes, error) {
  return rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    keyGenerator: (req) => `user:${req.user.id}`,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error })
  });
}

const readCvLimiter = userLimiter(5, 60, "You've uploaded your resume several times this hour. Please try again later.");
const tailorLimiter = userLimiter(20, 60, "You've tailored a lot of resumes this hour. Please try again later.");

function pdfBody(megabytes) {
  return express.raw({ type: "application/pdf", limit: `${megabytes}mb` });
}

function requireClaude(req, res, next) {
  if (!claude.isConfigured()) {
    return res.status(503).json({ error: "AI features are not configured on the server." });
  }

  next();
}

function decodedHeader(value) {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return "";
  }
}

function jobId(req, res) {
  if (!/^[1-9]\d*$/.test(req.params.id)) {
    res.status(400).json({ error: "Invalid job ID." });
    return null;
  }

  return req.params.id;
}

function fail(res, err, message) {
  if (err instanceof claude.ClaudeError) {
    return res.status(502).json({ error: err.message });
  }

  console.error(err);
  res.status(500).json({ error: message });
}

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function loadProfile(userId) {
  const [profile, gradeSheet] = await Promise.all([
    db.query(`SELECT cv, preferences, updated_at FROM cv_profiles WHERE user_id = $1`, [userId]),
    db.query(`SELECT filename, page_count, uploaded_at FROM grade_sheets WHERE user_id = $1`, [userId])
  ]);

  return {
    cv: profile.rows[0]?.cv ?? null,
    preferences: profile.rows[0] ? profiles.normalizePreferences(profile.rows[0].preferences) : null,
    updatedAt: profile.rows[0]?.updated_at ?? null,
    gradeSheet: gradeSheet.rows[0] ?? null
  };
}

router.get("/profile", async (req, res) => {
  try {
    res.json(await loadProfile(req.user.id));
  } catch (err) {
    fail(res, err, "Could not load your profile.");
  }
});

router.put("/profile/cv", requireClaude, readCvLimiter, pdfBody(5), async (req, res) => {
  try {
    const pdf = await profiles.inspectPdf(req.body);

    if (pdf.error) {
      return res.status(400).json({ error: pdf.error });
    }

    if (pdf.pageCount > MAX_CV_PAGES) {
      return res.status(400).json({ error: `Your resume can have at most ${MAX_CV_PAGES} pages.` });
    }

    const result = await profiles.extractFromPdf(req.body);

    if (!profiles.hasContent(result.cv)) {
      return res.status(422).json({ error: "We couldn't find a resume in that file. Check it's the right PDF." });
    }

    res.json(result);
  } catch (err) {
    fail(res, err, "Could not read your resume.");
  }
});

router.put("/profile", async (req, res) => {
  try {
    const cv = profiles.normalizeCv(req.body?.cv);
    const preferences = profiles.normalizePreferences(req.body?.preferences);

    if (!profiles.hasContent(cv)) {
      return res.status(400).json({ error: "Add at least one experience, education or project entry." });
    }

    const problem = profiles.saveProblem(cv, preferences);

    if (problem) {
      return res.status(400).json({ error: problem });
    }

    await db.query(
      `INSERT INTO cv_profiles (user_id, cv, preferences)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET cv = $2, preferences = $3, updated_at = NOW()`,
      [req.user.id, cv, preferences]
    );

    res.json(await loadProfile(req.user.id));
  } catch (err) {
    fail(res, err, "Could not save your profile.");
  }
});

router.put("/grade-sheet", pdfBody(2), async (req, res) => {
  try {
    const pdf = await profiles.inspectPdf(req.body);

    if (pdf.error) {
      return res.status(400).json({ error: pdf.error });
    }

    const filename = decodedHeader(req.get("X-File-Name")).slice(0, 200) || "grade-sheet.pdf";

    await db.query(
      `INSERT INTO grade_sheets (user_id, filename, pdf, page_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET filename = $2, pdf = $3, page_count = $4, uploaded_at = NOW()`,
      [req.user.id, filename, req.body, pdf.pageCount]
    );

    res.json(await loadProfile(req.user.id));
  } catch (err) {
    fail(res, err, "Could not save your grade sheet.");
  }
});

router.get("/grade-sheet", async (req, res) => {
  try {
    const result = await db.query(`SELECT pdf, filename FROM grade_sheets WHERE user_id = $1`, [req.user.id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "No grade sheet uploaded." });
    }

    res
      .set("Content-Type", "application/pdf")
      .set("Cache-Control", "no-store")
      .set("X-File-Name", encodeURIComponent(result.rows[0].filename))
      .send(result.rows[0].pdf);
  } catch (err) {
    fail(res, err, "Could not load your grade sheet.");
  }
});

router.delete("/grade-sheet", async (req, res) => {
  try {
    await db.query(`DELETE FROM grade_sheets WHERE user_id = $1`, [req.user.id]);
    res.json(await loadProfile(req.user.id));
  } catch (err) {
    fail(res, err, "Could not remove your grade sheet.");
  }
});

router.get("/", async (req, res) => {
  try {
    const [jobs, search] = await Promise.all([
      db.query(
        `SELECT ${JOB_FIELDS} FROM jobs
         WHERE user_id = $1 AND state <> 'dismissed' AND NOT hidden
         ORDER BY (state = 'applied'), match_score DESC NULLS FIRST, created_at DESC`,
        [req.user.id]
      ),
      jobSearch.status(req.user.id)
    ]);

    res.json({ jobs: jobs.rows, search });
  } catch (err) {
    fail(res, err, "Could not load jobs.");
  }
});

router.post("/search", requireClaude, async (req, res) => {
  try {
    res.json(await jobSearch.start(req.user.id, { auto: req.body?.auto === true }));
  } catch (err) {
    fail(res, err, "Could not start a search.");
  }
});

router.post("/", async (req, res) => {
  try {
    const company = text(req.body?.company, 200);
    const position = text(req.body?.position, 200);
    const description = text(req.body?.description, 20000);
    const url = text(req.body?.url, 1000) || null;
    const workplace = profiles.WORKPLACE_MODELS.includes(req.body?.workplace_model) ? req.body.workplace_model : null;

    if (!company || !position) {
      return res.status(400).json({ error: "Company and position are required." });
    }

    if (url && !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "The link must start with http:// or https://." });
    }

    const added = await db.query(
      `INSERT INTO jobs (user_id, source, company, position, location, workplace_model, url, description)
       VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, url) WHERE url IS NOT NULL
         DO UPDATE SET state = CASE WHEN jobs.state = 'dismissed' THEN 'new' ELSE jobs.state END, hidden = FALSE
       RETURNING ${JOB_FIELDS}`,
      [req.user.id, company, position, text(req.body?.location, 200), workplace, url, description]
    );

    res.status(201).json(await scoreAddedJob(req.user.id, added.rows[0]));
  } catch (err) {
    fail(res, err, "Could not add the job.");
  }
});

async function scoreAddedJob(userId, job) {
  if (job.match_score !== null || !claude.isConfigured()) {
    return job;
  }

  try {
    const profile = await db.query(`SELECT cv, preferences FROM cv_profiles WHERE user_id = $1`, [userId]);

    if (profile.rowCount === 0) {
      return job;
    }

    let description = job.description;

    if (job.url && description.length < FULL_DESCRIPTION_MIN) {
      const fetched = await cvTailor.fetchPosting(job.url).catch(() => null);

      if (fetched && fetched.length > description.length) {
        description = fetched;
      }
    }

    const [result] = await jobSearch.score(
      profile.rows[0].cv,
      profiles.normalizePreferences(profile.rows[0].preferences),
      [{ id: job.id, title: job.position, company: job.company, location: job.location, description }],
      { input: 0, output: 0 }
    );

    if (!result) {
      return job;
    }

    const updated = await db.query(
      `UPDATE jobs SET description = $3, match_score = $4, match_have = $5, match_missing = $6
       WHERE id = $1 AND user_id = $2
       RETURNING ${JOB_FIELDS}`,
      [job.id, userId, description, result.match_score, JSON.stringify(result.match_have), JSON.stringify(result.match_missing)]
    );
    return updated.rows[0] ?? job;
  } catch (err) {
    console.error("Could not score the added job:", err.message);
    return job;
  }
}

router.post("/:id/dismiss", async (req, res) => {
  const id = jobId(req, res);
  if (!id) return;

  try {
    // A new job is dismissed. An applied one is only hidden from the Jobs page: it stays applied,
    // so it and the resume that was sent are kept for the Applications page.
    const result = await db.query(
      `UPDATE jobs
       SET state = CASE WHEN state = 'new' THEN 'dismissed' ELSE state END,
           hidden = hidden OR state = 'applied'
       WHERE id = $1 AND user_id = $2 AND state IN ('new', 'applied')
       RETURNING id`,
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Job not found." });
    }

    res.status(204).end();
  } catch (err) {
    fail(res, err, "Could not dismiss the job.");
  }
});

router.get("/:id/tailoring", async (req, res) => {
  const id = jobId(req, res);
  if (!id) return;

  try {
    const result = await db.query(
      `SELECT ${TAILORING_FIELDS} FROM cv_tailorings WHERE job_id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    res.json({ tailoring: result.rows[0] ?? null });
  } catch (err) {
    fail(res, err, "Could not load the tailored resume.");
  }
});

router.post("/:id/tailor", requireClaude, tailorLimiter, async (req, res) => {
  const id = jobId(req, res);
  if (!id) return;

  try {
    const [job, profile] = await Promise.all([
      db.query(`SELECT company, position, location, url, description FROM jobs WHERE id = $1 AND user_id = $2`, [id, req.user.id]),
      db.query(`SELECT cv FROM cv_profiles WHERE user_id = $1`, [req.user.id])
    ]);

    if (job.rowCount === 0) {
      return res.status(404).json({ error: "Job not found." });
    }

    if (profile.rowCount === 0) {
      return res.status(400).json({ error: "Upload your resume first." });
    }

    const posting = job.rows[0];
    let fullDescription = null;

    if (posting.url && posting.description.length < FULL_DESCRIPTION_MIN) {
      fullDescription = await cvTailor.fetchPosting(posting.url).catch((err) => {
        console.error("Could not read posting:", err.message);
        return null;
      });

      if (fullDescription && fullDescription.length > posting.description.length) {
        posting.description = fullDescription;
        await db.query(`UPDATE jobs SET description = $3 WHERE id = $1 AND user_id = $2`, [id, req.user.id, fullDescription]);
      } else {
        fullDescription = null;
      }
    }

    const result = await cvTailor.tailor(profile.rows[0].cv, posting);
    const saved = await db.query(
      `INSERT INTO cv_tailorings (job_id, user_id, cv, gaps, flags)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (job_id) DO UPDATE SET cv = $3, gaps = $4, flags = $5, updated_at = NOW()
       RETURNING ${TAILORING_FIELDS}`,
      [id, req.user.id, result.cv, JSON.stringify(result.gaps), JSON.stringify(result.flags)]
    );

    res.json({ tailoring: saved.rows[0], description: fullDescription });
  } catch (err) {
    fail(res, err, "Could not tailor your resume.");
  }
});

router.put("/:id/tailoring", async (req, res) => {
  const id = jobId(req, res);
  if (!id) return;

  try {
    const current = await db.query(
      `SELECT cv, include_grade_sheet FROM cv_tailorings WHERE job_id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    if (current.rowCount === 0) {
      return res.status(404).json({ error: "Tailor your resume for this job first." });
    }

    const base = req.body?.cv
      ? await db.query(`SELECT cv FROM cv_profiles WHERE user_id = $1`, [req.user.id])
      : null;
    const cv = req.body?.cv ? cvTailor.applyEdits(current.rows[0].cv, req.body.cv, base?.rows[0]?.cv) : current.rows[0].cv;
    const includeGradeSheet = typeof req.body?.include_grade_sheet === "boolean"
      ? req.body.include_grade_sheet
      : current.rows[0].include_grade_sheet;

    const saved = await db.query(
      `UPDATE cv_tailorings SET cv = $3, include_grade_sheet = $4, updated_at = NOW()
       WHERE job_id = $1 AND user_id = $2
       RETURNING ${TAILORING_FIELDS}`,
      [id, req.user.id, cv, includeGradeSheet]
    );

    res.json({ tailoring: saved.rows[0] });
  } catch (err) {
    fail(res, err, "Could not save your changes.");
  }
});

router.post("/:id/apply", async (req, res) => {
  const id = jobId(req, res);
  if (!id) return;

  const appliedAt = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.applied_at) ? req.body.applied_at : null;
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const job = await client.query(
      `SELECT company, position, location, workplace_model, url, state FROM jobs
       WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, req.user.id]
    );

    if (job.rowCount === 0 || job.rows[0].state === "applied") {
      await client.query("ROLLBACK");
      return res.status(job.rowCount === 0 ? 404 : 409).json({
        error: job.rowCount === 0 ? "Job not found." : "You already marked this job as applied."
      });
    }

    const { company, position, location, workplace_model: workplace, url } = job.rows[0];
    const inserted = await client.query(
      `INSERT INTO applications (user_id, company, position, location, workplace_model, status, job_url, applied_at)
       VALUES ($1, $2, $3, $4, $5, 'Applied', $6, COALESCE($7::date, CURRENT_DATE))
       RETURNING id`,
      [req.user.id, company, position, location || "Not specified", workplace, url, appliedAt]
    );
    const applicationId = inserted.rows[0].id;

    const updated = await client.query(
      `UPDATE jobs SET state = 'applied', application_id = $3 WHERE id = $1 AND user_id = $2 RETURNING ${JOB_FIELDS}`,
      [id, req.user.id, applicationId]
    );
    const application = await client.query(`SELECT ${APPLICATION_FIELDS} FROM applications WHERE id = $1`, [applicationId]);

    await client.query("COMMIT");
    res.json({ job: updated.rows[0], application: application.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    fail(res, err, "Could not add the application.");
  } finally {
    client.release();
  }
});

router.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "That file is too large." });
  }

  next(err);
});

module.exports = router;
