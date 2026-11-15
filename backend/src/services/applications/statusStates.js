const { createMachine } = require("../shared/stateMachine");

/* An application's status journey: a list of steps, each a status with a date, the last one the current status.
   The first step is always the initial status. "follow" lists the statuses a step may be followed by: Interview may
   follow itself (another round), and nothing follows Rejected or Withdrawn */
const APPLICATION_STATUS = createMachine("application status", {
  initial: "Applied",
  states: {
    Applied: { follow: ["Interview", "Offer", "Rejected", "Withdrawn"] },
    Interview: { follow: ["Interview", "Offer", "Rejected", "Withdrawn"] },
    Offer: { follow: ["Rejected", "Withdrawn"] },
    Rejected: {},
    Withdrawn: {}
  }
});
const STATUSES = APPLICATION_STATUS.states;
const FIRST_STATUS = APPLICATION_STATUS.initial;
const MAX_STEPS = 10;

// Tells whether one status may follow another
function canFollow(from, to) {
  return APPLICATION_STATUS.can(from, "follow", to);
}

// Lists the statuses a step may have without breaking the steps on either side; the first step is always the first status
function allowedAt(steps, index) {
  const prev = steps[index - 1];
  const next = steps[index + 1];

  return STATUSES.filter((status) =>
    (prev ? canFollow(prev.status, status) : status === FIRST_STATUS) && (!next || canFollow(status, next.status))
  );
}

// Returns the earliest and latest dates a step may have: between the steps on either side, and never after today
function dateBounds(steps, index, today) {
  return { min: steps[index - 1]?.date || "", max: steps[index + 1]?.date || today };
}

// Tells whether a date fits a step's bounds
function dateFits(date, { min, max }) {
  return (!min || date >= min) && date <= max;
}

// Returns why a new current step can't be added, or null when it can
function checkAddStep(steps, status, date, today) {
  const current = steps[steps.length - 1];

  if (!STATUSES.includes(status)) return "Invalid status.";
  if (steps.length >= MAX_STEPS) return `An application can have up to ${MAX_STEPS} steps.`;
  if (!current) return status === FIRST_STATUS ? null : `The first status is always ${FIRST_STATUS}.`;
  if (!canFollow(current.status, status)) return `${status} can't follow ${current.status}.`;

  return dateFits(date, dateBounds([...steps, { status, date }], steps.length, today))
    ? null
    : "The date must be between the previous step's date and today.";
}

// Returns why a step's status or date can't change to the given values, or null when they can
function checkChangeStep(steps, index, { status, date }, today) {
  const step = steps[index];

  if (!step) return "Step not found.";

  if (status !== undefined && status !== step.status) {
    if (!STATUSES.includes(status)) return "Invalid status.";
    if (index === 0) return `The first status is always ${FIRST_STATUS}.`;
    if (!allowedAt(steps, index).includes(status)) return `${status} doesn't fit between the steps on either side.`;
  }

  if (date !== undefined && !dateFits(date, dateBounds(steps, index, today))) {
    return "The date must be between the dates of the steps on either side, and not after today.";
  }

  return null;
}

// Returns why a step can't be removed, or null when it can: the first step stays, and its neighbors must still fit
function checkRemoveStep(steps, index) {
  const prev = steps[index - 1];
  const next = steps[index + 1];

  if (!steps[index]) return "Step not found.";
  if (index === 0) return `The first status, ${FIRST_STATUS}, can't be removed.`;
  if (next && !canFollow(prev.status, next.status)) return `${next.status} can't follow ${prev.status}.`;

  return null;
}

module.exports = {
  APPLICATION_STATUS,
  STATUSES,
  FIRST_STATUS,
  MAX_STEPS,
  canFollow,
  allowedAt,
  dateBounds,
  checkAddStep,
  checkChangeStep,
  checkRemoveStep
};
