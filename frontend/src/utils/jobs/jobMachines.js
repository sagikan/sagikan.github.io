import { createMachine } from "../../lib/stateMachine";

// The Jobs page shows one dialog at a time: the profile, adding a job, or a job's tailored resume
export const JOB_MODAL = createMachine("job dialog", {
  initial: "closed",
  states: {
    closed: { open: ["profile", "add", "tailor"] },
    profile: { close: "closed" },
    add: { close: "closed" },
    tailor: { close: "closed" }
  }
});
