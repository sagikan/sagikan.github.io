import { createMachine } from "../../lib/stateMachine";

/* A job's tailored resume: it loads the saved one, or tailors a new one when there's none. A failed tailoring goes back
   to the resume that was showing, if there was one */
export const TAILOR = createMachine("tailored resume", {
  initial: "loading",
  states: {
    loading: { loaded: "ready", generate: "tailoring", fail: "failed" },
    tailoring: { loaded: "ready", fail: ["ready", "failed"] },
    ready: { generate: "tailoring" },
    failed: { generate: "tailoring" }
  }
});

// The profile's resume: reading an uploaded PDF and saving the profile never overlap
export const RESUME_FILE = createMachine("profile resume", {
  initial: "idle",
  states: {
    idle: { read: "reading", save: "saving" },
    reading: { done: "idle" },
    saving: { done: "idle" }
  }
});

// The profile's grade sheet, which uploads and removes on its own, alongside the resume
export const GRADE_SHEET = createMachine("grade sheet", {
  initial: "idle",
  states: {
    idle: { start: "busy" },
    busy: { done: "idle" }
  }
});
