import { createMachine } from "../../lib/stateMachine";

/* The application form on the Applications page: a blank new entry (application or job post), a new application
   filled in from an email update, or an existing application being edited */
export const APPLICATION_EDITOR = createMachine("application editor", {
  initial: "closed",
  states: {
    closed: { create: "new", createFromEmail: "draft", edit: "editing" },
    new: { close: "closed" },
    draft: { close: "closed" },
    editing: { close: "closed" }
  }
});

/* The note of an application in the form. Empty notes are filled from the latest duplicate. An automatic note is the
   one that fill wrote: it follows the duplicate, and becomes written as soon as the user edits it. A written note is
   never touched. Revert empties an automatic note, or a written one that is exactly the automatic text */
export const NOTE = createMachine("note", {
  initial: "empty",
  states: {
    empty: { fill: "automatic", write: "written" },
    automatic: { refresh: ["automatic", "empty"], write: "written", revert: "empty" },
    written: { write: "written", revert: "empty" }
  }
});

/* An application's status journey, the same table as the server's (backend statusStates.js): each step is a status
   with a date, the last one current. The first step is always the initial status; "follow" lists what may come after
   a step. Interview may follow itself (another round), and nothing follows Rejected or Withdrawn */
export const APPLICATION_STATUS = createMachine("application status", {
  initial: "Applied",
  states: {
    Applied: { follow: ["Interview", "Offer", "Rejected", "Withdrawn"] },
    Interview: { follow: ["Interview", "Offer", "Rejected", "Withdrawn"] },
    Offer: { follow: ["Rejected", "Withdrawn"] },
    Rejected: {},
    Withdrawn: {}
  }
});
export const STATUSES = APPLICATION_STATUS.states;
export const FIRST_STATUS = APPLICATION_STATUS.initial;
export const MAX_STEPS = 10;

/* A card's status area: flat (the current status on top) or folded back to an earlier step. One card is folded at a
   time: folding another unfolds this one */
export const STATUS_STACK = createMachine("status stack", {
  initial: "flat",
  states: {
    flat: { fold: "folded" },
    folded: { fold: "folded", unfold: ["folded", "flat"] }
  }
});

/* An action on one page of the status area, asked first with an inline confirm: deleting the application (current
   page), removing an earlier step, or undoing the current status. A confirmed removal fades the page out and an undo
   folds it away before the step goes; deleting needs no wait. One action at a time */
export const STEP_ACTION = createMachine("step action", {
  initial: "idle",
  states: {
    idle: { askDelete: "delete", askRemove: "remove", askUndo: "undo" },
    delete: { keep: "idle", confirm: "idle" },
    remove: { keep: "idle", confirm: "removing" },
    undo: { keep: "idle", confirm: "undoing" },
    removing: { finish: "idle" },
    undoing: { finish: "idle" }
  }
});

// Returns the state of an application's saved note
export function noteStateOf(job) {
  if (!job?.notes) {
    return "empty";
  }

  return job.notes_auto ? "automatic" : "written";
}

// Tells whether one status may follow another
export function canFollow(from, to) {
  return APPLICATION_STATUS.can(from, "follow", to);
}

// Lists the statuses a step may have without breaking the steps on either side; the first step is always the first status
export function allowedAt(steps, index) {
  const prev = steps[index - 1];
  const next = steps[index + 1];

  return STATUSES.filter((status) =>
    (prev ? canFollow(prev.status, status) : status === FIRST_STATUS) && (!next || canFollow(status, next.status))
  );
}

/* Lists a step's menu options, greying out what the rules don't allow there. The current status's menu adds a step
   after it, so it offers what may follow; a status that may follow itself (Interview) is offered again as "Another
   interview". With a step before it, Undo takes the current status back off; at MAX_STEPS only Undo is left */
export function menuOptions(steps, index) {
  const own = steps[index].status;

  if (index < steps.length - 1) {
    const allowed = allowedAt(steps, index);

    return STATUSES.map((status) => ({ value: status, status, label: status, disabled: status !== own && !allowed.includes(status) }));
  }

  const full = steps.length >= MAX_STEPS;
  const options = STATUSES.flatMap((status) => {
    const option = { value: status, status, label: status, disabled: status !== own && (full || !canFollow(own, status)) };
    const again = { value: `again:${status}`, status, label: `Another ${status.toLowerCase()}`, repeat: true, disabled: false };

    return status === own && !full && canFollow(own, own) ? [option, again] : [option];
  });

  return steps.length < 2 ? options : [...options, { value: "undo", status: own, label: `Undo ${own}`, action: "undo", disabled: false }];
}

// Returns the earliest and latest dates a step may have: between the steps on either side, and never after today
export function dateBounds(steps, index, today) {
  return { min: steps[index - 1]?.date || "", max: steps[index + 1]?.date || today };
}

// Tells whether a picked date fits a step, and whether it can be saved (it fits and differs from the step's date)
export function checkDate(steps, index, value, today) {
  const { min, max } = dateBounds(steps, index, today);
  const valid = Boolean(value) && (!min || value >= min) && value <= max;

  return { valid, savable: valid && value !== steps[index].date };
}

// Returns why a step can't be removed (the first one, or neighbors that can't follow each other), or "" when it can
export function removeBlocked(steps, index) {
  const prev = steps[index - 1];
  const next = steps[index + 1];

  if (index === 0) return `The first status is always ${FIRST_STATUS}.`;
  if (prev && next && !canFollow(prev.status, next.status)) return `${next.status} can't follow ${prev.status}.`;

  return "";
}

// Lists the statuses the application form may save: the current one, or one that may follow it while there's room
export function formStatuses(steps) {
  const current = steps?.[steps.length - 1];

  if (!current) {
    return STATUSES;
  }

  return STATUSES.filter((status) => status === current.status || (steps.length < MAX_STEPS && canFollow(current.status, status)));
}
