import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  APPLICATION_STATUS,
  STATUSES,
  FIRST_STATUS,
  MAX_STEPS,
  SCHEDULE_MONTHS,
  canFollow,
  allowedAt,
  canSchedule,
  monthsAfter,
  isAhead,
  dateBounds,
  checkAddStep,
  checkChangeStep,
  checkRemoveStep
} = require("../statusStates");

const TODAY = "2026-11-11";
const LIMIT = "2027-02-11";
const JOURNEY = [
  { status: "Applied", date: "2026-10-01" },
  { status: "Interview", date: "2026-10-08" },
  { status: "Offer", date: "2026-10-20" }
];
const UPCOMING = [
  { status: "Applied", date: "2026-10-01" },
  { status: "Interview", date: "2026-11-20" }
];
const ALLOWED = [
  ["Applied", "Interview"],
  ["Applied", "Offer"],
  ["Applied", "Rejected"],
  ["Applied", "Withdrawn"],
  ["Interview", "Interview"],
  ["Interview", "Offer"],
  ["Interview", "Rejected"],
  ["Interview", "Withdrawn"],
  ["Offer", "Rejected"],
  ["Offer", "Withdrawn"]
];

// Builds a journey of the given statuses, one day apart from October 1st
function journey(...statuses) {
  return statuses.map((status, i) => ({ status, date: `2026-10-${String(i + 1).padStart(2, "0")}` }));
}

describe("APPLICATION_STATUS", () => {
  it("starts at Applied and lists the five statuses", () => {
    expect(FIRST_STATUS).toBe("Applied");
    expect(STATUSES).toEqual(["Applied", "Interview", "Offer", "Rejected", "Withdrawn"]);
    expect(APPLICATION_STATUS.sources("follow")).toEqual(["Applied", "Interview", "Offer"]);
    expect(SCHEDULE_MONTHS).toBe(3);
  });
});

describe("canFollow", () => {
  it.each(ALLOWED)("allows %s to be followed by %s", (from, to) => {
    expect(canFollow(from, to)).toBe(true);
  });

  it.each(
    STATUSES.flatMap((from) => STATUSES.map((to) => [from, to]))
      .filter(([from, to]) => !ALLOWED.some(([a, b]) => a === from && b === to))
  )("refuses %s followed by %s", (from, to) => {
    expect(canFollow(from, to)).toBe(false);
  });
});

describe("allowedAt", () => {
  it("allows only Applied as the first step", () => {
    expect(allowedAt(JOURNEY, 0)).toEqual(["Applied"]);
  });

  it("allows what fits between the steps on either side", () => {
    expect(allowedAt(JOURNEY, 1)).toEqual(["Interview"]);
    expect(allowedAt(journey("Applied", "Interview", "Rejected"), 1)).toEqual(["Interview", "Offer"]);
  });

  it("allows whatever may follow the previous step for the current step", () => {
    expect(allowedAt(JOURNEY, 2)).toEqual(["Interview", "Offer", "Rejected", "Withdrawn"]);
  });
});

describe("canSchedule", () => {
  it.each([
    ["Applied", false],
    ["Interview", true],
    ["Offer", false],
    ["Rejected", false],
    ["Withdrawn", false]
  ])("tells whether %s may be scheduled ahead", (status, expected) => {
    expect(canSchedule(status)).toBe(expected);
  });
});

describe("monthsAfter", () => {
  it.each([
    ["2026-11-11", 3, "2027-02-11"],
    ["2026-11-30", 3, "2027-02-28"],
    ["2027-11-30", 3, "2028-02-29"],
    ["2026-01-31", 1, "2026-02-28"]
  ])("returns %s plus %i months as %s", (iso, months, expected) => {
    expect(monthsAfter(iso, months)).toBe(expected);
  });
});

describe("isAhead", () => {
  it("returns true only when the current step is dated after today", () => {
    expect(isAhead(UPCOMING, TODAY)).toBe(true);
    expect(isAhead(UPCOMING, "2026-11-20")).toBe(false);
    expect(isAhead(JOURNEY, TODAY)).toBe(false);
    expect(isAhead([], TODAY)).toBe(false);
  });
});

describe("dateBounds", () => {
  it("keeps a step between its neighbors' dates", () => {
    expect(dateBounds(JOURNEY, 1, TODAY)).toEqual({ min: "2026-10-01", max: "2026-10-20" });
  });

  it("has no earliest date for the first step and today as the latest for the current one", () => {
    expect(dateBounds(JOURNEY, 0, TODAY)).toEqual({ min: "", max: "2026-10-08" });
    expect(dateBounds(JOURNEY, 2, TODAY)).toEqual({ min: "2026-10-08", max: TODAY });
  });

  it("lets a current step that may be scheduled reach SCHEDULE_MONTHS ahead", () => {
    expect(dateBounds(UPCOMING, 1, TODAY)).toEqual({ min: "2026-10-01", max: LIMIT });
    expect(dateBounds(JOURNEY, 2, TODAY, "Interview")).toEqual({ min: "2026-10-08", max: LIMIT });
  });

  it("keeps an earlier step on or before today when the step after it is ahead", () => {
    expect(dateBounds(UPCOMING, 0, TODAY)).toEqual({ min: "", max: TODAY });
  });
});

describe("checkAddStep", () => {
  it("allows a status that may follow the current one, dated between it and today", () => {
    expect(checkAddStep(JOURNEY, "Rejected", TODAY, TODAY)).toBeNull();
    expect(checkAddStep(journey("Applied", "Interview"), "Interview", TODAY, TODAY)).toBeNull();
  });

  it("allows an interview up to SCHEDULE_MONTHS ahead", () => {
    expect(checkAddStep(JOURNEY.slice(0, 2), "Interview", LIMIT, TODAY)).toBeNull();
  });

  it("allows only Applied as the first step", () => {
    expect(checkAddStep([], FIRST_STATUS, TODAY, TODAY)).toBeNull();
    expect(checkAddStep([], "Interview", TODAY, TODAY)).toBe("The first status is always Applied.");
  });

  it.each([
    ["an unknown status", JOURNEY, "Ghosted", TODAY, "Invalid status."],
    ["a status that can't follow", JOURNEY, "Interview", TODAY, "Interview can't follow Offer."],
    ["anything after a final status", journey("Applied", "Rejected"), "Offer", TODAY, "Offer can't follow Rejected."],
    ["a date before the current step", JOURNEY, "Rejected", "2026-10-19", "The date must be between the previous step's date and today."],
    ["a date after today", JOURNEY, "Rejected", "2026-11-12", "The date must be between the previous step's date and today."],
    ["an interview past the limit", JOURNEY.slice(0, 2), "Interview", "2027-02-12", "The date must be between the previous step's date and 3 months from today."],
    ["a step after an upcoming interview", UPCOMING, "Rejected", TODAY, "The interview on 2026-11-20 is still ahead: undo it first, or move it to today or earlier."]
  ])("refuses %s", (_title, steps, status, date, message) => {
    expect(checkAddStep(steps, status, date, TODAY)).toBe(message);
  });

  it(`refuses a step past ${MAX_STEPS}`, () => {
    const full = journey("Applied", ...Array(MAX_STEPS - 1).fill("Interview"));

    expect(checkAddStep(full.slice(0, -1), "Interview", TODAY, TODAY)).toBeNull();
    expect(checkAddStep(full, "Offer", TODAY, TODAY)).toBe(`An application can have up to ${MAX_STEPS} steps.`);
  });
});

describe("checkChangeStep", () => {
  it("allows a status that fits between its neighbors, and a date between theirs", () => {
    expect(checkChangeStep(journey("Applied", "Interview", "Rejected"), 1, { status: "Offer" }, TODAY)).toBeNull();
    expect(checkChangeStep(JOURNEY, 1, { date: "2026-10-20" }, TODAY)).toBeNull();
    expect(checkChangeStep(JOURNEY, 2, { status: "Withdrawn", date: TODAY }, TODAY)).toBeNull();
  });

  it("allows an upcoming interview to move, up to SCHEDULE_MONTHS ahead", () => {
    expect(checkChangeStep(UPCOMING, 1, { date: LIMIT }, TODAY)).toBeNull();
    expect(checkChangeStep(JOURNEY, 2, { status: "Interview", date: "2026-12-01" }, TODAY)).toBeNull();
  });

  it.each([
    ["a new status for an upcoming interview", 1, { status: "Offer" }, "An upcoming interview can only be moved or undone."],
    ["an upcoming interview past the limit", 1, { date: "2027-02-12" }, "The date must be between the dates of the steps on either side, and not after 3 months from today."],
    ["an earlier step after today", 0, { date: "2026-11-12" }, "The date must be between the dates of the steps on either side, and not after today."]
  ])("refuses %s", (_title, index, changes, message) => {
    expect(checkChangeStep(UPCOMING, index, changes, TODAY)).toBe(message);
  });

  it("allows the first step's date to change, and its status to stay", () => {
    expect(checkChangeStep(JOURNEY, 0, { status: "Applied", date: "2026-09-01" }, TODAY)).toBeNull();
  });

  it.each([
    ["a step that doesn't exist", 5, { date: TODAY }, "Step not found."],
    ["an unknown status", 1, { status: "Ghosted" }, "Invalid status."],
    ["a new status for the first step", 0, { status: "Interview" }, "The first status is always Applied."],
    ["a status the next step can't follow", 1, { status: "Rejected" }, "Rejected doesn't fit between the steps on either side."],
    ["a date before the previous step", 1, { date: "2026-09-30" }, "The date must be between the dates of the steps on either side, and not after today."],
    ["a date after the next step", 1, { date: "2026-10-21" }, "The date must be between the dates of the steps on either side, and not after today."],
    ["a current date after today", 2, { date: "2026-11-12" }, "The date must be between the dates of the steps on either side, and not after today."]
  ])("refuses %s", (_title, index, changes, message) => {
    expect(checkChangeStep(JOURNEY, index, changes, TODAY)).toBe(message);
  });
});

describe("checkRemoveStep", () => {
  it("allows removing a middle step whose neighbors may follow each other, and the current step", () => {
    expect(checkRemoveStep(JOURNEY, 1)).toBeNull();
    expect(checkRemoveStep(JOURNEY, 2)).toBeNull();
  });

  it.each([
    ["the first step", JOURNEY, 0, "The first status, Applied, can't be removed."],
    ["a step that doesn't exist", JOURNEY, 3, "Step not found."],
    ["a step whose neighbors can't follow each other", journey("Applied", "Offer", "Interview", "Interview"), 2, "Interview can't follow Offer."]
  ])("refuses removing %s", (_title, steps, index, message) => {
    expect(checkRemoveStep(steps, index)).toBe(message);
  });
});
