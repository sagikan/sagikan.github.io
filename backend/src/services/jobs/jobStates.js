const { createMachine } = require("../shared/stateMachine");

/* A job's state, stored in its state and hidden columns. An archived job is an applied one that's hidden from the
   Jobs page but kept, with the resume that was sent, for the Applications page. A removed job is deleted: a found one
   whose posting closed, or an untouched found or a dismissed one past the postings' age limit (see removeOldPostings) */
const JOB = createMachine("job", {
  initial: "new",
  states: {
    new: { dismiss: "dismissed", trim: "dismissed", apply: "applied", addAgain: "new", close: "removed", expire: "removed" },
    dismissed: { apply: "applied", addAgain: "new", expire: "removed" },
    applied: { dismiss: "archived", archive: "archived", addAgain: "applied" },
    archived: { dismiss: "archived", addAgain: "applied" },
    removed: {}
  }
});
const COLUMNS = {
  new: { state: "new", hidden: false },
  dismissed: { state: "dismissed", hidden: false },
  applied: { state: "applied", hidden: false },
  archived: { state: "applied", hidden: true }
};
// Jobs shown on the Jobs page
const VISIBLE = ["new", "applied"];
/* A search runs until it finishes or fails. One that was marked failed for taking too long can still record how it
   ended when it finally finishes */
const SEARCH = createMachine("job search", {
  initial: "running",
  states: {
    running: { finish: ["done", "failed"], timeOut: "failed", interrupt: "failed" },
    failed: { finish: ["done", "failed"] },
    done: {}
  }
});

// Returns the state of a job row from its state and hidden columns
function jobState(row) {
  return Object.keys(COLUMNS).find((state) => COLUMNS[state].state === row.state && COLUMNS[state].hidden === row.hidden) ?? null;
}

// Builds the SQL condition for jobs in any of the given states, optionally qualified by a table name
function inStates(states, table = "") {
  const prefix = table ? `${table}.` : "";
  const conditions = states.map((state) => {
    if (!COLUMNS[state]) {
      throw new Error(`job: "${state}" isn't stored in a row`);
    }

    return `(${prefix}state = ${JOB.sqlList([COLUMNS[state].state])} AND ${COLUMNS[state].hidden ? "" : "NOT "}${prefix}hidden)`;
  });

  return `(${conditions.join(" OR ")})`;
}

// Builds the SQL condition for jobs an event can move, optionally only those in the given states
function canMove(event, { only, table } = {}) {
  return inStates(JOB.sources(event).filter((state) => !only || only.includes(state)), table);
}

// Builds the SET clause that moves each job by an event, according to the state it's in
function moveSet(event, table = "") {
  const prefix = table ? `${table}.` : "";
  const moves = JOB.sources(event).map((from) => [inStates([from], table), COLUMNS[JOB.move(from, event)]]);
  // Builds the CASE expression for one column
  const column = (name, value) => `${name} = CASE ${moves.map(([when, to]) => `WHEN ${when} THEN ${value(to)}`).join(" ")} ELSE ${prefix}${name} END`;

  return `${column("state", (to) => JOB.sqlList([to.state]))}, ${column("hidden", (to) => (to.hidden ? "TRUE" : "FALSE"))}`;
}

module.exports = { JOB, SEARCH, VISIBLE, jobState, inStates, canMove, moveSet };
