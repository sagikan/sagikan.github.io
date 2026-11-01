import { describe, expect, it } from "vitest";
import { duplicateNote, findLatestDuplicate, ordinalDate, withSuggestedNote } from "../duplicates";

const OLD = { id: 1, position: "Backend Engineer", company: "Orbit", status: "Applied", job_url: "https://orbit.example/jobs/1", applied_at: "2020-03-05", created_at: "2020-03-05T08:00:00Z" };
const NEWER = { id: 2, position: "Backend Engineer", company: "Orbit", status: "Rejected", job_url: "https://orbit.example/jobs/2", applied_at: "2021-06-21", created_at: "2021-06-21T08:00:00Z" };
const OTHER_ROLE = { id: 3, position: "Frontend Engineer", company: "Orbit", status: "Applied", job_url: null, applied_at: "2022-01-01", created_at: "2022-01-01T08:00:00Z" };
const OTHER_COMPANY = { id: 4, position: "Backend Engineer", company: "Pinnacle", status: "Applied", job_url: null, applied_at: "2022-02-02", created_at: "2022-02-02T08:00:00Z" };

describe("findLatestDuplicate", () => {
  it("returns the most recent application for the same position and company, whatever the order of the list", () => {
    expect(findLatestDuplicate([OLD, NEWER, OTHER_ROLE], { position: "Backend Engineer", company: "Orbit" })).toBe(NEWER);
    expect(findLatestDuplicate([NEWER, OLD, OTHER_ROLE], { position: "Backend Engineer", company: "Orbit" })).toBe(NEWER);
  });

  it("ignores case and spaces around the names", () => {
    expect(findLatestDuplicate([OLD], { position: "  backend ENGINEER ", company: " orbit " })).toBe(OLD);
  });

  it.each([
    ["another position", { position: "Data Engineer", company: "Orbit" }],
    ["another company", { position: "Backend Engineer", company: "Globex" }],
    ["a position that only starts the same", { position: "Backend", company: "Orbit" }]
  ])("finds nothing for %s", (_title, query) => {
    expect(findLatestDuplicate([OLD, NEWER, OTHER_ROLE, OTHER_COMPANY], query)).toBeNull();
  });

  it.each([
    ["no position", { position: "", company: "Orbit" }],
    ["a blank position", { position: "   ", company: "Orbit" }],
    ["no company", { position: "Backend Engineer", company: "" }],
    ["a blank company", { position: "Backend Engineer", company: "  " }]
  ])("finds nothing for %s", (_title, query) => {
    expect(findLatestDuplicate([OLD, NEWER], query)).toBeNull();
  });

  it("finds nothing in an empty list", () => {
    expect(findLatestDuplicate([], { position: "Backend Engineer", company: "Orbit" })).toBeNull();
  });

  it("only counts applications made on or before the given day, and picks the most recent of those", () => {
    const query = { position: "Backend Engineer", company: "Orbit" };

    expect(findLatestDuplicate([OLD, NEWER], { ...query, day: "2021-06-20" })).toBe(OLD);
    expect(findLatestDuplicate([OLD, NEWER], { ...query, day: "2021-06-21" })).toBe(NEWER);
    expect(findLatestDuplicate([OLD, NEWER], { ...query, day: "2021-06-22" })).toBe(NEWER);
    expect(findLatestDuplicate([OLD, NEWER], { ...query, day: "2020-03-05" })).toBe(OLD);
    expect(findLatestDuplicate([OLD, NEWER], { ...query, day: "2020-03-04" })).toBeNull();
  });

  it("leaves out the application being edited", () => {
    expect(findLatestDuplicate([OLD, NEWER], { position: "Backend Engineer", company: "Orbit", excludeId: 2 })).toBe(OLD);
  });

  it("uses the day the card was created when it has no applied date", () => {
    const undated = { ...NEWER, id: 5, applied_at: null, created_at: "2023-04-04T12:00:00" };

    expect(findLatestDuplicate([OLD, undated], { position: "Backend Engineer", company: "Orbit" })).toBe(undated);
  });

  it("prefers the card listed first when two were made on the same day", () => {
    const first = { ...OLD, id: 6, applied_at: "2024-05-05" };
    const second = { ...OLD, id: 7, applied_at: "2024-05-05" };

    expect(findLatestDuplicate([first, second], { position: "Backend Engineer", company: "Orbit" })).toBe(first);
  });
});

describe("ordinalDate", () => {
  const NOW = new Date("2026-10-31T12:00:00");

  it.each([
    ["2026-10-01", "Oct 1st"],
    ["2026-10-02", "Oct 2nd"],
    ["2026-10-03", "Oct 3rd"],
    ["2026-10-04", "Oct 4th"],
    ["2026-10-10", "Oct 10th"],
    ["2026-10-11", "Oct 11th"],
    ["2026-10-12", "Oct 12th"],
    ["2026-10-13", "Oct 13th"],
    ["2026-10-21", "Oct 21st"],
    ["2026-10-22", "Oct 22nd"],
    ["2026-10-23", "Oct 23rd"],
    ["2026-10-30", "Oct 30th"],
    ["2026-10-31", "Oct 31st"],
    ["2026-01-15", "Jan 15th"],
    ["2026-12-25", "Dec 25th"]
  ])("writes %s as %s", (day, expected) => {
    expect(ordinalDate(day, NOW)).toBe(expected);
  });

  it("adds the year when it is not the current one", () => {
    expect(ordinalDate("2025-10-10", NOW)).toBe("Oct 10th, 2025");
    expect(ordinalDate("2027-01-01", NOW)).toBe("Jan 1st, 2027");
  });
});

describe("duplicateNote", () => {
  const NOW_YEAR = new Date().getFullYear();

  it("says Applied, the date and the link", () => {
    expect(duplicateNote({ ...OLD, applied_at: `${NOW_YEAR}-10-10` })).toBe(`Applied on Oct 10th: ${OLD.job_url}`);
  });

  it("says Rejected for a rejected application", () => {
    expect(duplicateNote({ ...NEWER, applied_at: `${NOW_YEAR}-10-01` })).toBe(`Rejected on Oct 1st: ${NEWER.job_url}`);
  });

  it.each(["Applied", "Interview", "Offer", "Withdrawn"])("says Applied for a %s application", (status) => {
    expect(duplicateNote({ ...OLD, status, applied_at: `${NOW_YEAR}-10-10` })).toMatch(/^Applied on Oct 10th/);
  });

  it.each([null, undefined, ""])("leaves out the link when the application has %j", (job_url) => {
    expect(duplicateNote({ ...OLD, job_url, applied_at: `${NOW_YEAR}-10-10` })).toBe("Applied on Oct 10th");
  });

  it("names the year of an older application", () => {
    expect(duplicateNote({ ...OLD, applied_at: "2020-03-05" })).toBe(`Applied on Mar 5th, 2020: ${OLD.job_url}`);
  });
});

describe("withSuggestedNote", () => {
  const BLANK = { position: "", company: "", applied_at: "2030-01-01", notes: "", autoNote: "" };
  const FILLED = { ...BLANK, position: "Backend Engineer", company: "Orbit" };

  it("fills the note from the most recent application for the same position and company", () => {
    const result = withSuggestedNote(BLANK, FILLED, "company", [OLD, NEWER]);

    expect(result.notes).toBe(duplicateNote(NEWER));
    expect(result.autoNote).toBe(duplicateNote(NEWER));
  });

  it("leaves the note empty when there is no duplicate", () => {
    expect(withSuggestedNote(BLANK, FILLED, "company", [OTHER_ROLE, OTHER_COMPANY])).toMatchObject({ notes: "", autoNote: "" });
  });

  it("changes the filled note when the duplicate changes, and clears it when there is none", () => {
    const first = withSuggestedNote(BLANK, FILLED, "company", [OLD, NEWER]);
    const earlier = withSuggestedNote(first, { ...first, applied_at: "2021-01-01" }, "applied_at", [OLD, NEWER]);
    const gone = withSuggestedNote(earlier, { ...earlier, company: "Globex" }, "company", [OLD, NEWER]);

    expect(earlier.notes).toBe(duplicateNote(OLD));
    expect(gone.notes).toBe("");
  });

  it("keeps a note the user wrote", () => {
    const written = { ...FILLED, notes: "Referred by Dana", autoNote: "" };

    expect(withSuggestedNote(written, written, "company", [OLD, NEWER]).notes).toBe("Referred by Dana");
  });

  it("keeps the note when the user cleared a filled one", () => {
    const first = withSuggestedNote(BLANK, FILLED, "company", [OLD, NEWER]);
    const cleared = { ...first, notes: "" };

    expect(withSuggestedNote(cleared, { ...cleared, applied_at: "2031-01-01" }, "applied_at", [OLD, NEWER]).notes).toBe("");
  });

  it.each(["notes", "location", "status", "job_url", "workplace_model"])("does nothing when the changed field is %s", (field) => {
    const first = withSuggestedNote(BLANK, FILLED, "company", [OLD, NEWER]);
    const next = { ...first, [field]: "changed", notes: field === "notes" ? "typed" : first.notes };

    expect(withSuggestedNote(first, next, field, [OLD, NEWER])).toBe(next);
  });

  it("fills the note when no field is named, such as when the form first opens", () => {
    expect(withSuggestedNote(FILLED, FILLED, null, [OLD, NEWER]).notes).toBe(duplicateNote(NEWER));
  });

  it("only counts applications made on or before the form's date", () => {
    const result = withSuggestedNote(BLANK, { ...FILLED, applied_at: "2021-01-01" }, "applied_at", [OLD, NEWER]);

    expect(result.notes).toBe(duplicateNote(OLD));
  });
});
