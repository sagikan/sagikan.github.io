import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  StepError,
  serverToday,
  latestDate,
  nextStepDate,
  lockSteps,
  addStep,
  startJourney,
  stepIndex,
  changeStep,
  removeStep,
  loadApplication
} = require("../applicationSteps");

const NOW = new Date("2026-11-11T22:30:00Z");
const LATEST = "2026-11-12";

// Builds a database result with rows
function rows(...list) {
  return { rows: list, rowCount: list.length };
}

// Builds a client whose inserts return new step IDs and whose other queries return the given rows
function fakeClient(...answers) {
  let nextId = 20;

  return {
    query: vi.fn(async (sql) => {
      if (sql.includes("INSERT INTO application_steps")) return rows({ id: String(nextId++) });

      return answers.length ? answers.shift() : rows();
    })
  };
}

// Builds a journey with positions and IDs from the given statuses, one day apart from October 1st
function journey(...statuses) {
  return statuses.map((status, i) => ({ id: String(i + 1), position: i, status, date: `2026-10-0${i + 1}` }));
}

// Lists the SQL statements a client ran, by their first word
function statements(client) {
  return client.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0]);
}

describe("serverToday", () => {
  it("returns the UTC date", () => {
    expect(serverToday(NOW)).toBe("2026-11-11");
  });
});

describe("latestDate", () => {
  it("returns the UTC date a day ahead, for users east of UTC", () => {
    expect(latestDate(NOW)).toBe(LATEST);
  });
});

describe("nextStepDate", () => {
  it("returns the given day, or the current step's date when that is later", () => {
    expect(nextStepDate(journey("Applied", "Interview"), "2026-11-11")).toBe("2026-11-11");
    expect(nextStepDate(journey("Applied", "Interview"), "2026-09-30")).toBe("2026-10-02");
  });

  it("returns the day itself when there are no steps yet", () => {
    expect(nextStepDate([], "2026-11-11")).toBe("2026-11-11");
  });
});

describe("lockSteps", () => {
  it("locks the user's application and returns its steps", async () => {
    const client = fakeClient(rows({ id: "5" }), rows(...journey("Applied")));

    expect(await lockSteps(client, "5", 7)).toEqual(journey("Applied"));
    expect(client.query.mock.calls[0]).toEqual([expect.stringContaining("FOR UPDATE"), ["5", 7]]);
  });

  it("refuses an application that isn't the user's", async () => {
    const client = fakeClient(rows());

    await expect(lockSteps(client, "5", 7)).rejects.toMatchObject({ status: 404, message: "Application not found." });
  });
});

describe("addStep", () => {
  it("inserts the step after the current one, copies its status onto the application and returns its ID", async () => {
    const client = fakeClient();
    const steps = journey("Applied", "Interview");
    const id = await addStep(client, { applicationId: "5", userId: 7, steps, status: "Offer", date: "2026-10-05", latest: LATEST });

    expect(id).toBe("20");
    expect(steps).toHaveLength(3);
    expect(client.query.mock.calls[0][1]).toEqual(["5", 7, 2, "Offer", "2026-10-05"]);
    expect(statements(client)).toEqual(["INSERT", "UPDATE"]);
  });

  it("refuses a step the rules don't allow, changing nothing", async () => {
    const client = fakeClient();
    const attempt = addStep(client, { applicationId: "5", userId: 7, steps: journey("Applied", "Rejected"), status: "Offer", date: "2026-10-05", latest: LATEST });

    await expect(attempt).rejects.toBeInstanceOf(StepError);
    await expect(attempt).rejects.toMatchObject({ status: 400, message: "Offer can't follow Rejected." });
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("startJourney", () => {
  it("starts with Applied on the applied date", async () => {
    const client = fakeClient();
    const steps = await startJourney(client, { applicationId: "5", userId: 7, status: "Applied", appliedAt: "2026-10-01", latest: LATEST, today: "2026-11-11" });

    expect(steps.map(({ status, date }) => [status, date])).toEqual([["Applied", "2026-10-01"]]);
  });

  it("adds a chosen status after Applied, dated today, and dates Applied today when there's no applied date", async () => {
    const client = fakeClient();
    const steps = await startJourney(client, { applicationId: "5", userId: 7, status: "Interview", appliedAt: null, latest: LATEST, today: "2026-11-11" });

    expect(steps.map(({ status, date }) => [status, date])).toEqual([["Applied", "2026-11-11"], ["Interview", "2026-11-11"]]);
  });

  it("never dates the chosen status before the applied date", async () => {
    const client = fakeClient();
    const steps = await startJourney(client, { applicationId: "5", userId: 7, status: "Offer", appliedAt: LATEST, latest: LATEST, today: "2026-11-11" });

    expect(steps[1].date).toBe(LATEST);
  });
});

describe("stepIndex", () => {
  it("finds a step by its ID", () => {
    expect(stepIndex(journey("Applied", "Interview"), 2)).toBe(1);
  });

  it("refuses a step the application doesn't have", () => {
    expect(() => stepIndex(journey("Applied"), "9")).toThrow("Step not found.");
  });
});

describe("changeStep", () => {
  it("saves a new status and date, and copies the current status onto the application", async () => {
    const client = fakeClient();
    const steps = journey("Applied", "Interview", "Rejected");

    await changeStep(client, { applicationId: "5", steps, index: 1, status: "Offer", date: "2026-10-03", latest: LATEST });

    expect(client.query.mock.calls[0][1]).toEqual(["2", "Offer", "2026-10-03"]);
    expect(statements(client)).toEqual(["UPDATE", "UPDATE"]);
  });

  it("copies the first step's date onto the application's applied date", async () => {
    const client = fakeClient();

    await changeStep(client, { applicationId: "5", steps: journey("Applied", "Interview"), index: 0, date: "2026-09-20", latest: LATEST });

    expect(client.query.mock.calls[2]).toEqual([expect.stringContaining("applied_at"), ["5", "2026-09-20"]]);
  });

  it("refuses a change the rules don't allow", async () => {
    const client = fakeClient();
    const attempt = changeStep(client, { applicationId: "5", steps: journey("Applied", "Interview"), index: 0, status: "Offer", latest: LATEST });

    await expect(attempt).rejects.toMatchObject({ status: 400, message: "The first status is always Applied." });
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("removeStep", () => {
  it("deletes the step and copies the new current status onto the application", async () => {
    const client = fakeClient();
    const steps = journey("Applied", "Interview");

    await removeStep(client, { applicationId: "5", steps, index: 1 });

    expect(client.query.mock.calls[0][1]).toEqual(["2"]);
    expect(statements(client)).toEqual(["DELETE", "UPDATE"]);
    expect(steps).toHaveLength(1);
  });

  it("refuses removing the first step", async () => {
    const client = fakeClient();

    await expect(removeStep(client, { applicationId: "5", steps: journey("Applied"), index: 0 })).rejects.toMatchObject({ status: 400 });
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("loadApplication", () => {
  it("returns the application with its steps", async () => {
    const client = fakeClient(rows({ id: "5", steps: [] }));

    expect(await loadApplication(client, "5")).toEqual({ id: "5", steps: [] });
    expect(client.query.mock.calls[0][0]).toContain("application_steps");
  });
});
