const APPLICATION_FIELDS = `
  id, company, position, location, workplace_model, status, job_url, notes,
  TO_CHAR(applied_at, 'YYYY-MM-DD') AS applied_at, created_at,
  (
    SELECT jobs.id FROM jobs
    JOIN cv_tailorings ON cv_tailorings.job_id = jobs.id
    WHERE jobs.application_id = applications.id
    LIMIT 1
  ) AS cv_job_id
`;

module.exports = { APPLICATION_FIELDS };
