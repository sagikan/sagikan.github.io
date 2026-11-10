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

// Returns the state of an application's saved note
export function noteStateOf(job) {
  if (!job?.notes) {
    return "empty";
  }

  return job.notes_auto ? "automatic" : "written";
}
