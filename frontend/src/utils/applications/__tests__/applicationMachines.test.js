import { describe, expect, it } from "vitest";
import { APPLICATION_EDITOR } from "../applicationMachines";

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
