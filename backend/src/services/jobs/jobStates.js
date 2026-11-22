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

/* A job board's state, stored in its active column (new boards start on through the column's default). An off board
   isn't fetched, except a company board RETRY_DAYS after its last fetch (refreshStaleBoards), whose result moves it
   again. A company board goes off when it's gone or fails MAX_FAILURES times in a row; a JSearch search goes on and off
   with what the users want */
const BOARD = createMachine("job board", {
  initial: "on",
  states: {
    on: { succeed: "on", fail: ["on", "off"], vanish: "off", want: "on", unwant: "off" },
    off: { succeed: "on", fail: "off", vanish: "off", want: "on", unwant: "off" }
  }
});
// How each board state is stored in the active column
const BOARD_COLUMN = { on: "TRUE", off: "FALSE" };

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

// Builds the SQL condition for boards in any of the given states, optionally qualified by a table name
function boardIn(states, table = "") {
  const prefix = table ? `${table}.` : "";
  const conditions = states.map((state) => {
    if (!Object.hasOwn(BOARD_COLUMN, state)) {
      throw new Error(`job board: "${state}" isn't a valid state`);
    }

    return `${prefix}active = ${BOARD_COLUMN[state]}`;
  });

  return `(${conditions.join(" OR ")})`;
}

/* Builds the SET clause that moves each board by an event, according to the state it's in. For a move with two
   outcomes, `stay` is the SQL condition under which the board keeps its state; otherwise it takes the other one */
function boardMoveSet(event, { stay, table = "" } = {}) {
  const prefix = table ? `${table}.` : "";
  const cases = BOARD.sources(event).map((from) => {
    const to = BOARD.next(from, event);

    if (to) {
      return `WHEN ${boardIn([from], table)} THEN ${BOARD_COLUMN[to]}`;
    }

    if (!stay) {
      throw new Error(`job board: "${event}" from "${from}" has two outcomes, so it needs a stay condition`);
    }

    const other = BOARD.states.find((state) => state !== from && BOARD.can(from, event, state));

    return `WHEN ${boardIn([from], table)} THEN CASE WHEN ${stay} THEN ${BOARD_COLUMN[from]} ELSE ${BOARD_COLUMN[other]} END`;
  });

  return `active = CASE ${cases.join(" ")} ELSE ${prefix}active END`;
}

module.exports = { JOB, SEARCH, BOARD, VISIBLE, jobState, inStates, canMove, moveSet, boardIn, boardMoveSet };
