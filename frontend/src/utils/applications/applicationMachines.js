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
