import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { JOB, SEARCH, VISIBLE, jobState, inStates, canMove, moveSet } = require("../jobStates");

describe("JOB", () => {
  it.each([
    ["new", "dismiss", "dismissed"],
    ["new", "trim", "dismissed"],
    ["new", "apply", "applied"],
    ["new", "close", "removed"],
    ["new", "expire", "removed"],
    ["dismissed", "expire", "removed"],
    ["dismissed", "apply", "applied"],
    ["dismissed", "addAgain", "new"],
    ["applied", "dismiss", "archived"],
    ["applied", "archive", "archived"],
    ["applied", "addAgain", "applied"],
    ["archived", "dismiss", "archived"],
    ["archived", "addAgain", "applied"]
  ])("moves a %s job on %s to %s", (state, event, expected) => {
    expect(JOB.move(state, event)).toBe(expected);
  });

  it.each([
    ["applied", "apply"],
    ["archived", "apply"],
    ["dismissed", "dismiss"],
    ["applied", "expire"],
    ["dismissed", "close"]
  ])("doesn't let a %s job %s", (state, event) => {
    expect(JOB.can(state, event)).toBe(false);
  });

  it("shows new and applied jobs on the Jobs page", () => {
    expect(VISIBLE).toEqual(["new", "applied"]);
  });
});

describe("SEARCH", () => {
  it.each([
    ["running", "finish", "done", "done"],
    ["running", "finish", "failed", "failed"],
    ["running", "timeOut", undefined, "failed"],
    ["running", "interrupt", undefined, "failed"],
    ["failed", "finish", "done", "done"]
  ])("moves a %s search on %s (as %s) to %s", (state, event, pick, expected) => {
    expect(SEARCH.move(state, event, pick)).toBe(expected);
  });

  it("starts searches as running and never changes a finished one", () => {
    expect(SEARCH.initial).toBe("running");
    expect(SEARCH.can("done", "finish", "failed")).toBe(false);
  });
});

describe("jobState", () => {
  it.each([
    [{ state: "new", hidden: false }, "new"],
    [{ state: "dismissed", hidden: false }, "dismissed"],
    [{ state: "applied", hidden: false }, "applied"],
    [{ state: "applied", hidden: true }, "archived"],
    [{ state: "new", hidden: true }, null]
  ])("reads %o as %s", (row, expected) => {
    expect(jobState(row)).toBe(expected);
  });
});

describe("inStates", () => {
  it("matches each state by both of its columns", () => {
    expect(inStates(["new", "archived"])).toBe("((state = 'new' AND NOT hidden) OR (state = 'applied' AND hidden))");
  });

  it("qualifies the columns with a table name", () => {
    expect(inStates(["dismissed"], "jobs")).toBe("((jobs.state = 'dismissed' AND NOT jobs.hidden))");
  });

  it("rejects a state that isn't stored in a row", () => {
    expect(() => inStates(["removed"])).toThrow("isn't stored in a row");
  });
});

describe("canMove", () => {
  it("matches the jobs an event can move", () => {
    expect(canMove("dismiss")).toBe(inStates(["new", "applied", "archived"]));
  });

  it("can be narrowed to some of those states", () => {
    expect(canMove("dismiss", { only: ["applied", "archived", "dismissed"] })).toBe(inStates(["applied", "archived"]));
  });
});

describe("moveSet", () => {
  it("sets both columns from the state each job moves to", () => {
    const when = "((state = 'applied' AND NOT hidden))";

    expect(moveSet("archive")).toBe(
      `state = CASE WHEN ${when} THEN 'applied' ELSE state END, hidden = CASE WHEN ${when} THEN TRUE ELSE hidden END`
    );
  });

  it("covers every state the event can start from", () => {
    const set = moveSet("dismiss", "jobs");

    expect(set).toContain(`WHEN ${inStates(["new"], "jobs")} THEN 'dismissed'`);
    expect(set).toContain(`WHEN ${inStates(["applied"], "jobs")} THEN TRUE`);
    expect(set).toContain(`WHEN ${inStates(["archived"], "jobs")} THEN TRUE`);
    expect(set).toContain("ELSE jobs.state END");
  });
});
