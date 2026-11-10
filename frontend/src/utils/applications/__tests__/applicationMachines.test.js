import { describe, expect, it } from "vitest";
import { APPLICATION_EDITOR, NOTE, noteStateOf } from "../applicationMachines";

describe("APPLICATION_EDITOR", () => {
  it.each([
    ["create", "new"],
    ["createFromEmail", "draft"],
    ["edit", "editing"]
  ])("opens the form on %s as %s and closes it again", (event, expected) => {
    expect(APPLICATION_EDITOR.next("closed", event)).toBe(expected);
    expect(APPLICATION_EDITOR.next(expected, "close")).toBe("closed");
  });

  it("starts closed and doesn't switch forms while one is open", () => {
    expect(APPLICATION_EDITOR.initial).toBe("closed");
    expect(APPLICATION_EDITOR.can("editing", "create")).toBe(false);
  });
});

describe("NOTE", () => {
  it("starts empty, and fills an empty note into an automatic one", () => {
    expect(NOTE.initial).toBe("empty");
    expect(NOTE.next("empty", "fill")).toBe("automatic");
  });

  it.each(["empty", "automatic", "written"])("makes a note written when the user edits it from %s", (state) => {
    expect(NOTE.next(state, "write")).toBe("written");
  });

  it("refreshes an automatic note into an automatic or an empty one, as the caller picks", () => {
    expect(NOTE.next("automatic", "refresh", "automatic")).toBe("automatic");
    expect(NOTE.next("automatic", "refresh", "empty")).toBe("empty");
    expect(NOTE.can("automatic", "refresh", "written")).toBe(false);
  });

  it("never fills or refreshes a written note", () => {
    expect(NOTE.can("written", "fill")).toBe(false);
    expect(NOTE.can("written", "refresh", "automatic")).toBe(false);
  });

  it("empties an automatic or written note on revert, but has nothing to revert when empty", () => {
    expect(NOTE.next("automatic", "revert")).toBe("empty");
    expect(NOTE.next("written", "revert")).toBe("empty");
    expect(NOTE.can("empty", "revert")).toBe(false);
  });
});

describe("noteStateOf", () => {
  it.each([
    ["a missing job", null, "empty"],
    ["a job without a note", { notes: null }, "empty"],
    ["a note marked automatic", { notes: "Applied on Oct 10th", notes_auto: true }, "automatic"],
    ["a note not marked automatic", { notes: "Applied on Oct 10th", notes_auto: false }, "written"]
  ])("returns the state for %s", (_title, job, expected) => {
    expect(noteStateOf(job)).toBe(expected);
  });
});
