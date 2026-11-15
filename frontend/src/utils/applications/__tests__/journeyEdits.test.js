import { describe, expect, it } from "vitest";
import { journeyText, withStepAdded, withStepChanged, withStepRemoved } from "../journeyEdits";

const JOB = {
  id: "5",
  company: "Acme",
  status: "Interview",
  applied_at: "2026-10-01",
  steps: [
    { id: "1", status: "Applied", date: "2026-10-01" },
    { id: "2", status: "Interview", date: "2026-10-08" }
  ]
};

describe("withStepAdded", () => {
  it("adds a current step and makes its status the application's", () => {
    const job = withStepAdded(JOB, "Offer", "2026-10-20");

    expect(job.steps.slice(2)).toEqual([{ id: expect.any(String), status: "Offer", date: "2026-10-20" }]);
    expect(job.status).toBe("Offer");
    expect(JOB.steps).toHaveLength(2);
  });

  it("gives each new step its own ID", () => {
    expect(withStepAdded(JOB, "Offer", "2026-10-20").steps[2].id).not.toBe(withStepAdded(JOB, "Offer", "2026-10-20").steps[2].id);
  });
});

describe("withStepChanged", () => {
  it("changes the current step's status, and the application's with it", () => {
    expect(withStepChanged(JOB, "2", { status: "Offer" })).toMatchObject({ status: "Offer", applied_at: "2026-10-01" });
  });

  it("moves the applied date with the first step's date", () => {
    expect(withStepChanged(JOB, "1", { date: "2026-09-28" }).applied_at).toBe("2026-09-28");
  });
});

describe("withStepRemoved", () => {
  it("removes a step, making the one before it current", () => {
    const job = withStepRemoved(JOB, "2");

    expect(job.steps.map(({ id }) => id)).toEqual(["1"]);
    expect(job.status).toBe("Applied");
  });
});

describe("journeyText", () => {
  it("lists the steps with their dates, oldest first", () => {
    expect(journeyText(JOB)).toBe("Applied 2026-10-01 > Interview 2026-10-08");
  });

  it("is empty for an application without steps", () => {
    expect(journeyText({})).toBe("");
  });
});
