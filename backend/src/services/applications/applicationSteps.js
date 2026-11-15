const { APPLICATION_FIELDS } = require("./applicationFields");
const { FIRST_STATUS, checkAddStep, checkChangeStep, checkRemoveStep } = require("./statusStates");

const DAY_MS = 24 * 60 * 60 * 1000;

// Error for a step change the rules refuse, carrying the HTTP status to answer with
class StepError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Returns today's date on the server (UTC) as YYYY-MM-DD
function serverToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Returns the latest date a step may have: today for the user, who can be up to a day ahead of the server's UTC date
function latestDate(now = new Date()) {
  return new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
}

// Returns the later of two YYYY-MM-DD dates
function laterDate(a, b) {
  return a > b ? a : b;
}

// Returns the date for a new current step: the given day (today on the server by default), never before the current step
function nextStepDate(steps, day = serverToday()) {
  return laterDate(day, steps[steps.length - 1]?.date || "");
}

// Locks one of the user's applications and returns its steps, oldest first; throws when it isn't theirs
async function lockSteps(client, applicationId, userId) {
  const application = await client.query(
    `SELECT id FROM applications WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [applicationId, userId]
  );

  if (application.rowCount === 0) {
    throw new StepError(404, "Application not found.");
  }

  const steps = await client.query(
    `SELECT id::text AS id, position, status, TO_CHAR(step_date, 'YYYY-MM-DD') AS date
     FROM application_steps
     WHERE application_id = $1
     ORDER BY position`,
    [applicationId]
  );

  return steps.rows;
}

// Copies the current step's status onto the application
async function syncStatus(client, applicationId) {
  await client.query(
    `UPDATE applications SET status = current.status
     FROM (
       SELECT status FROM application_steps WHERE application_id = $1 ORDER BY position DESC LIMIT 1
     ) AS current
     WHERE applications.id = $1`,
    [applicationId]
  );
}

// Adds a new current step after the checks pass, and returns its ID
async function addStep(client, { applicationId, userId, steps, status, date, latest = latestDate() }) {
  const problem = checkAddStep(steps, status, date, latest);

  if (problem) {
    throw new StepError(400, problem);
  }

  const position = steps.length ? steps[steps.length - 1].position + 1 : 0;
  const inserted = await client.query(
    `INSERT INTO application_steps (application_id, user_id, position, status, step_date)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id::text AS id`,
    [applicationId, userId, position, status, date]
  );

  steps.push({ id: inserted.rows[0].id, position, status, date });
  await syncStatus(client, applicationId);

  return inserted.rows[0].id;
}

/* Gives a new application its journey: the first status on the day it was applied for, then the chosen status today
   when it's a different one */
async function startJourney(client, { applicationId, userId, status, appliedAt, latest = latestDate(), today = serverToday() }) {
  const steps = [];

  await addStep(client, { applicationId, userId, steps, status: FIRST_STATUS, date: appliedAt || today, latest });

  if (status !== FIRST_STATUS) {
    await addStep(client, { applicationId, userId, steps, status, date: nextStepDate(steps, today), latest });
  }

  return steps;
}

// Finds a step by its ID, throwing when the application has no such step
function stepIndex(steps, stepId) {
  const index = steps.findIndex((step) => step.id === String(stepId));

  if (index === -1) {
    throw new StepError(404, "Step not found.");
  }

  return index;
}

// Changes a step's status or date after the checks pass; the first step's date is also the application's applied date
async function changeStep(client, { applicationId, steps, index, status, date, latest = latestDate() }) {
  const problem = checkChangeStep(steps, index, { status, date }, latest);

  if (problem) {
    throw new StepError(400, problem);
  }

  const step = steps[index];

  step.status = status ?? step.status;
  step.date = date ?? step.date;
  await client.query(
    `UPDATE application_steps SET status = $2, step_date = $3 WHERE id = $1`,
    [step.id, step.status, step.date]
  );
  await syncStatus(client, applicationId);

  if (index === 0 && date !== undefined) {
    await client.query(`UPDATE applications SET applied_at = $2 WHERE id = $1`, [applicationId, date]);
  }
}

// Removes a step after the checks pass; removing the current one makes the step before it current again
async function removeStep(client, { applicationId, steps, index }) {
  const problem = checkRemoveStep(steps, index);

  if (problem) {
    throw new StepError(400, problem);
  }

  await client.query(`DELETE FROM application_steps WHERE id = $1`, [steps[index].id]);
  steps.splice(index, 1);
  await syncStatus(client, applicationId);
}

// Loads an application's returned fields, its steps included
async function loadApplication(client, applicationId) {
  return (await client.query(`SELECT ${APPLICATION_FIELDS} FROM applications WHERE id = $1`, [applicationId])).rows[0];
}

module.exports = {
  StepError,
  serverToday,
  latestDate,
  nextStepDate,
  lockSteps,
  addStep,
  startJourney,
  stepIndex,
  changeStep,
  removeStep,
  loadApplication
};
