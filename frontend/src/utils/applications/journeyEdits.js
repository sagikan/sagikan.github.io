/* Optimistic copies of the server's step changes: each returns the application as it will be once saved, with its
   status following the current step and its applied date following the first step. The server checks the rules
   again and answers with the saved application, which replaces this one */

let nextTempId = 0;

// Returns an application with new steps, its status and applied date following them
function withSteps(job, steps) {
  return {
    ...job,
    steps,
    status: steps[steps.length - 1].status,
    applied_at: steps[0].date !== job.steps[0]?.date ? steps[0].date : job.applied_at
  };
}

// Returns the application with a new current step, dated the given day
export function withStepAdded(job, status, date) {
  nextTempId += 1;

  return withSteps(job, [...job.steps, { id: `temp-${nextTempId}`, status, date }]);
}

// Returns the application with one step's status or date changed
export function withStepChanged(job, stepId, changes) {
  return withSteps(job, job.steps.map((step) => (step.id === stepId ? { ...step, ...changes } : step)));
}

// Returns the application without one step
export function withStepRemoved(job, stepId) {
  return withSteps(job, job.steps.filter((step) => step.id !== stepId));
}

// Describes the journey for an export: each step as "Status YYYY-MM-DD", oldest first
export function journeyText(job) {
  return (job.steps || []).map((step) => `${step.status} ${step.date}`).join(" > ");
}
