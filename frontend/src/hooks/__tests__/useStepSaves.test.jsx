import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addStep, changeStep, removeStep } from "../../lib/api";
import { useStepSaves } from "../useStepSaves";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal()),
  addStep: vi.fn(),
  changeStep: vi.fn(),
  removeStep: vi.fn()
}));

const JOB = {
  id: "5",
  status: "Interview",
  applied_at: "2026-10-01",
  steps: [
    { id: "1", status: "Applied", date: "2026-10-01" },
    { id: "2", status: "Interview", date: "2026-10-08" }
  ]
};
const OTHER = { id: "6", status: "Applied", steps: [{ id: "3", status: "Applied", date: "2026-10-02" }] };

// Builds an API answer
function answer(ok, data, status = ok ? 200 : 400) {
  return { response: { ok, status }, data };
}

// Renders the hook over a list of applications kept in a plain variable, as App keeps them in state
function renderSaves() {
  const store = { applications: [JOB, OTHER] };
  const onError = vi.fn();
  const onUnauthorized = vi.fn();
  const onSaved = vi.fn();
  // Applies an update to the list, as setApplications does
  const setApplications = (update) => {
    store.applications = update(store.applications);
  };
  const view = renderHook(() => useStepSaves({ applications: store.applications, setApplications, onError, onUnauthorized, onSaved, csrfToken: "token-1" }));

  return { ...view, store, onError, onUnauthorized, onSaved };
}

describe("useStepSaves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a new step at once and marks the application as saving until the server answers", async () => {
    let reply;
    addStep.mockReturnValue(new Promise((resolve) => {
      reply = resolve;
    }));
    const { result, store, onSaved } = renderSaves();
    let saving;

    act(() => {
      saving = result.current.onAddStep("5", "Offer");
    });
    const shown = store.applications[0];
    const busy = result.current.savingIds.has("5");
    await act(async () => {
      reply(answer(true, { ...JOB, id: "5", status: "Offer", steps: [...JOB.steps, { id: "9", status: "Offer", date: "2026-11-11" }] }));
      await saving;
    });

    expect(shown).toMatchObject({ status: "Offer" });
    expect(busy).toBe(true);
    expect(addStep).toHaveBeenCalledWith("5", { status: "Offer", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }, "token-1");
    expect(store.applications[0].steps[2].id).toBe("9");
    expect(result.current.savingIds.has("5")).toBe(false);
    expect(store.applications[1]).toBe(OTHER);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("puts the card back and reports the server's message when a save is refused", async () => {
    removeStep.mockResolvedValue(answer(false, { error: "The first status, Applied, can't be removed." }));
    const { result, store, onError, onSaved } = renderSaves();

    await act(() => result.current.onRemoveStep("5", "1"));

    expect(onSaved).not.toHaveBeenCalled();
    expect(store.applications[0]).toBe(JOB);
    expect(onError).toHaveBeenLastCalledWith("The first status, Applied, can't be removed.");
    expect(removeStep).toHaveBeenCalledWith("5", "1", "token-1");
  });

  it("falls back to its own message when the server gives none", async () => {
    changeStep.mockResolvedValue(answer(false, {}));
    const { result, onError } = renderSaves();

    await act(() => result.current.onChangeStep("5", "2", { date: "2026-10-09" }));

    expect(onError).toHaveBeenLastCalledWith("Could not change the step.");
    expect(changeStep).toHaveBeenCalledWith("5", "2", { date: "2026-10-09" }, "token-1");
  });

  it("puts the card back when the server can't be reached", async () => {
    changeStep.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result, store, onError } = renderSaves();

    await act(() => result.current.onChangeStep("5", "2", { status: "Offer" }));

    expect(store.applications[0]).toBe(JOB);
    expect(onError).toHaveBeenLastCalledWith("Could not reach the server. Please try again.");
  });

  it("ends the session when the server says it's over", async () => {
    addStep.mockResolvedValue(answer(false, { error: "Authentication required." }, 401));
    const { result, onUnauthorized } = renderSaves();

    await act(() => result.current.onAddStep("5", "Offer"));

    expect(onUnauthorized).toHaveBeenCalled();
  });

  it("does nothing for an application it doesn't have", async () => {
    const { result } = renderSaves();

    await act(() => result.current.onAddStep("99", "Offer"));

    expect(addStep).not.toHaveBeenCalled();
  });
});
