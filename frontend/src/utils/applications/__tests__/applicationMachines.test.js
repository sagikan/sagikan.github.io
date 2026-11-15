import { describe, expect, it } from "vitest";
import {
  APPLICATION_EDITOR,
  APPLICATION_STATUS,
  FIRST_STATUS,
  MAX_STEPS,
  NOTE,
  STATUSES,
  STATUS_STACK,
  STEP_ACTION,
  allowedAt,
  canFollow,
  checkDate,
  dateBounds,
  formStatuses,
  menuOptions,
  noteStateOf,
  removeBlocked
} from "../applicationMachines";

const TODAY = "2026-11-11";
const JOURNEY = [
  { status: "Applied", date: "2026-10-01" },
  { status: "Interview", date: "2026-10-08" },
  { status: "Offer", date: "2026-10-20" }
];

// Builds a journey of the given statuses, one day apart from October 1st
function journey(...statuses) {
  return statuses.map((status, i) => ({ status, date: `2026-10-${String(i + 1).padStart(2, "0")}` }));
}

// Lists a menu's options as their labels, with a mark on the greyed-out ones
function labels(options) {
  return options.map((option) => (option.disabled ? `(${option.label})` : option.label));
}

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

describe("APPLICATION_STATUS", () => {
  it("starts at Applied, lists the five statuses, and ends at Rejected and Withdrawn", () => {
    expect(APPLICATION_STATUS.initial).toBe(FIRST_STATUS);
    expect(STATUSES).toEqual(["Applied", "Interview", "Offer", "Rejected", "Withdrawn"]);
    expect(APPLICATION_STATUS.sources("follow")).toEqual(["Applied", "Interview", "Offer"]);
  });
});

describe("STATUS_STACK", () => {
  it("folds from flat, and unfolds to folded or flat as the caller picks", () => {
    expect(STATUS_STACK.next("flat", "fold")).toBe("folded");
    expect(STATUS_STACK.next("folded", "unfold", "folded")).toBe("folded");
    expect(STATUS_STACK.next("folded", "unfold", "flat")).toBe("flat");
  });

  it("has nothing to unfold when flat", () => {
    expect(STATUS_STACK.can("flat", "unfold", "flat")).toBe(false);
  });
});

describe("STEP_ACTION", () => {
  it.each([
    ["askDelete", "delete"],
    ["askRemove", "remove"],
    ["askUndo", "undo"]
  ])("asks on %s and goes back to idle on keep", (event, state) => {
    expect(STEP_ACTION.next("idle", event)).toBe(state);
    expect(STEP_ACTION.next(state, "keep")).toBe("idle");
  });

  it.each([
    ["delete", "idle"],
    ["remove", "removing"],
    ["undo", "undoing"]
  ])("confirms %s into %s", (state, expected) => {
    expect(STEP_ACTION.next(state, "confirm")).toBe(expected);
  });

  it("finishes a removal or an undo once its page is gone", () => {
    expect(STEP_ACTION.next("removing", "finish")).toBe("idle");
    expect(STEP_ACTION.next("undoing", "finish")).toBe("idle");
  });

  it("runs one action at a time, and can't take one back once it's running", () => {
    expect(STEP_ACTION.can("delete", "askUndo")).toBe(false);
    expect(STEP_ACTION.can("removing", "askDelete")).toBe(false);
    expect(STEP_ACTION.can("undoing", "keep")).toBe(false);
  });
});

describe("canFollow", () => {
  it.each([
    ["Applied", "Interview", true],
    ["Applied", "Withdrawn", true],
    ["Interview", "Interview", true],
    ["Offer", "Rejected", true],
    ["Applied", "Applied", false],
    ["Offer", "Interview", false],
    ["Rejected", "Offer", false],
    ["Withdrawn", "Applied", false]
  ])("tells whether %s may be followed by %s", (from, to, expected) => {
    expect(canFollow(from, to)).toBe(expected);
  });
});

describe("allowedAt", () => {
  it("allows only Applied first, and what fits between the neighbors elsewhere", () => {
    expect(allowedAt(JOURNEY, 0)).toEqual(["Applied"]);
    expect(allowedAt(JOURNEY, 1)).toEqual(["Interview"]);
    expect(allowedAt(journey("Applied", "Interview", "Rejected"), 1)).toEqual(["Interview", "Offer"]);
    expect(allowedAt(JOURNEY, 2)).toEqual(["Interview", "Offer", "Rejected", "Withdrawn"]);
  });
});

describe("menuOptions", () => {
  it("offers what may follow the current status, another interview, and Undo", () => {
    expect(labels(menuOptions(journey("Applied", "Interview"), 1))).toEqual(
      ["(Applied)", "Interview", "Another interview", "Offer", "Rejected", "Withdrawn", "Undo Interview"]
    );
  });

  it("has no Undo while Applied is the only step", () => {
    expect(labels(menuOptions(journey("Applied"), 0))).toEqual(["Applied", "Interview", "Offer", "Rejected", "Withdrawn"]);
  });

  it("offers only Undo once the journey is full", () => {
    const full = journey("Applied", ...Array(MAX_STEPS - 1).fill("Interview"));

    expect(labels(menuOptions(full, MAX_STEPS - 1))).toEqual(
      ["(Applied)", "Interview", "(Offer)", "(Rejected)", "(Withdrawn)", "Undo Interview"]
    );
  });

  it("offers an earlier step only what fits between its neighbors", () => {
    expect(labels(menuOptions(JOURNEY, 1))).toEqual(["(Applied)", "Interview", "(Offer)", "(Rejected)", "(Withdrawn)"]);
  });

  it("gives every option its own value, so the menu can tell them apart", () => {
    const values = menuOptions(journey("Applied", "Interview"), 1).map((option) => option.value);

    expect(new Set(values).size).toBe(values.length);
  });
});

describe("dateBounds", () => {
  it("keeps a step between its neighbors, and the current one up to today", () => {
    expect(dateBounds(JOURNEY, 0, TODAY)).toEqual({ min: "", max: "2026-10-08" });
    expect(dateBounds(JOURNEY, 1, TODAY)).toEqual({ min: "2026-10-01", max: "2026-10-20" });
    expect(dateBounds(JOURNEY, 2, TODAY)).toEqual({ min: "2026-10-08", max: TODAY });
  });
});

describe("checkDate", () => {
  it.each([
    ["a new date between the neighbors", "2026-10-10", { valid: true, savable: true }],
    ["the step's own date", "2026-10-08", { valid: true, savable: false }],
    ["a date before the previous step", "2026-09-30", { valid: false, savable: false }],
    ["a date after the next step", "2026-10-21", { valid: false, savable: false }],
    ["no date", "", { valid: false, savable: false }]
  ])("checks %s", (_title, value, expected) => {
    expect(checkDate(JOURNEY, 1, value, TODAY)).toEqual(expected);
  });

  it("refuses a current date after today", () => {
    expect(checkDate(JOURNEY, 2, "2026-11-12", TODAY).valid).toBe(false);
  });
});

describe("removeBlocked", () => {
  it("allows removing a middle or current step", () => {
    expect(removeBlocked(JOURNEY, 1)).toBe("");
    expect(removeBlocked(JOURNEY, 2)).toBe("");
  });

  it("says why the first step, or a step whose neighbors can't follow each other, stays", () => {
    expect(removeBlocked(JOURNEY, 0)).toBe("The first status is always Applied.");
    expect(removeBlocked(journey("Applied", "Offer", "Interview", "Interview"), 2)).toBe("Interview can't follow Offer.");
  });
});

describe("formStatuses", () => {
  it("offers every status for a new application", () => {
    expect(formStatuses(undefined)).toEqual(STATUSES);
  });

  it("offers the current status and what may follow it", () => {
    expect(formStatuses(journey("Applied", "Offer"))).toEqual(["Offer", "Rejected", "Withdrawn"]);
    expect(formStatuses(journey("Applied", "Rejected"))).toEqual(["Rejected"]);
  });

  it("offers only the current status once the journey is full", () => {
    expect(formStatuses(journey("Applied", ...Array(MAX_STEPS - 1).fill("Interview")))).toEqual(["Interview"]);
  });
});
