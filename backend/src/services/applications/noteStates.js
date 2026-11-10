const { createMachine } = require("../shared/stateMachine");

/* An application's note, stored in its notes and notes_auto columns. An automatic note is the one the form's
   duplicate warning wrote; saving a note any other way makes it written, and saving none empties it. The form
   decides which one a save is, so every move can start from any state */
const NOTE = createMachine("note", {
  initial: "empty",
  states: {
    empty: { clear: "empty", write: "written", generate: "automatic" },
    automatic: { clear: "empty", write: "written", generate: "automatic" },
    written: { clear: "empty", write: "written", generate: "automatic" }
  }
});

// Returns the state a saved note ends in: none is empty, one marked automatic is automatic, any other is written
function savedNoteState(notes, auto) {
  const event = notes === null ? "clear" : auto ? "generate" : "write";

  return NOTE.move(NOTE.sources(event)[0], event);
}

module.exports = { NOTE, savedNoteState };
