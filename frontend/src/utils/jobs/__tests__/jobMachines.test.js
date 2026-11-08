import { describe, expect, it } from "vitest";
import { JOB_MODAL } from "../jobMachines";

describe("JOB_MODAL", () => {
  it.each(["profile", "add", "tailor"])("opens and closes the %s dialog", (dialog) => {
    expect(JOB_MODAL.next("closed", "open", dialog)).toBe(dialog);
    expect(JOB_MODAL.next(dialog, "close")).toBe("closed");
  });

  it("starts closed and opens one dialog at a time", () => {
    expect(JOB_MODAL.initial).toBe("closed");
    expect(JOB_MODAL.can("profile", "open", "tailor")).toBe(false);
  });
});
