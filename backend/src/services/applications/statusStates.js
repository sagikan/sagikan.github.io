const { createMachine } = require("../shared/stateMachine");

/* An application's status journey: a list of steps, each a status with a date, the last one the current status.
   The first step is always the initial status. "follow" lists the statuses a step may be followed by: Interview may
   follow itself (another round), and nothing follows Rejected or Withdrawn. "schedule" marks a status whose current
   step may be dated ahead of today, up to SCHEDULE_MONTHS (an interview that's been set up) */
const APPLICATION_STATUS = createMachine("application status", {
  initial: "Applied",
  states: {
    Applied: { follow: ["Interview", "Offer", "Rejected", "Withdrawn"] },
    Interview: { follow: ["Interview", "Offer", "Rejected", "Withdrawn"], schedule: "Interview" },
    Offer: { follow: ["Rejected", "Withdrawn"] },
    Rejected: {},
    Withdrawn: {}
  }
});
const STATUSES = APPLICATION_STATUS.states;
const FIRST_STATUS = APPLICATION_STATUS.initial;
const MAX_STEPS = 10;
const SCHEDULE_MONTHS = 3;

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

// Tells whether a status's step may be dated ahead of today while it's the current step
function canSchedule(status) {
  return APPLICATION_STATUS.can(status, "schedule");
}

// Returns the YYYY-MM-DD date some months after another, on the last day of the month when it's shorter
function monthsAfter(iso, months) {
  const [year, month, day] = iso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month + months, 0)).getUTCDate();

  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

// Tells whether the current step is dated after today, which only a scheduled status may be
function isAhead(steps, today) {
  const current = steps[steps.length - 1];

  return Boolean(current) && current.date > today;
}

/* Returns the earliest and latest dates a step may have: between the steps on either side and never after today, except
   a current step with a status that can be scheduled, which may be up to SCHEDULE_MONTHS ahead. The status is the
   step's own unless a new one is given */
function dateBounds(steps, index, today, status = steps[index].status) {
  const next = steps[index + 1];
  const min = steps[index - 1]?.date || "";

  if (!next && canSchedule(status)) {
    return { min, max: monthsAfter(today, SCHEDULE_MONTHS) };
  }

  return { min, max: next && next.date < today ? next.date : today };
}

// Names a step's latest date in an error message
function latestText(steps, index, status) {
  return !steps[index + 1] && canSchedule(status) ? `${SCHEDULE_MONTHS} months from today` : "today";
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
  if (isAhead(steps, today)) return `The ${current.status.toLowerCase()} on ${current.date} is still ahead: undo it first, or move it to today or earlier.`;
  if (!canFollow(current.status, status)) return `${status} can't follow ${current.status}.`;

  const added = [...steps, { status, date }];

  return dateFits(date, dateBounds(added, steps.length, today))
    ? null
    : `The date must be between the previous step's date and ${latestText(added, steps.length, status)}.`;
}

// Returns why a step's status or date can't change to the given values, or null when they can
function checkChangeStep(steps, index, { status, date }, today) {
  const step = steps[index];

  if (!step) return "Step not found.";

  if (status !== undefined && status !== step.status) {
    if (!STATUSES.includes(status)) return "Invalid status.";
    if (index === 0) return `The first status is always ${FIRST_STATUS}.`;
    if (!allowedAt(steps, index).includes(status)) return `${status} doesn't fit between the steps on either side.`;
    if (index === steps.length - 1 && isAhead(steps, today)) return `An upcoming ${step.status.toLowerCase()} can only be moved or undone.`;
  }

  const newStatus = status ?? step.status;

  if (date !== undefined && !dateFits(date, dateBounds(steps, index, today, newStatus))) {
    return `The date must be between the dates of the steps on either side, and not after ${latestText(steps, index, newStatus)}.`;
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
  SCHEDULE_MONTHS,
  canFollow,
  allowedAt,
  canSchedule,
  monthsAfter,
  isAhead,
  dateBounds,
  checkAddStep,
  checkChangeStep,
  checkRemoveStep
};
