import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StatusStack from "../StatusStack";

const JOB = {
  id: "5",
  company: "Acme",
  status: "Offer",
  steps: [
    { id: "1", status: "Applied", date: "2026-10-01" },
    { id: "2", status: "Interview", date: "2026-10-08" },
    { id: "3", status: "Offer", date: "2026-10-20" }
  ]
};

// Renders the status area with spies for every callback
function renderStack(props = {}) {
  const handlers = {
    onFoldChange: vi.fn(),
    onAddStep: vi.fn(),
    onChangeStep: vi.fn(),
    onRemoveStep: vi.fn(),
    onDelete: vi.fn()
  };
  const view = render(<StatusStack job={JOB} folded={false} {...handlers} {...props} />);

  return { ...view, ...handlers };
}

// Returns the page element of a step
function page(container, id) {
  return container.querySelector(`.zpage[data-step="${id}"]`);
}

// Runs every pending fold animation and timer to the end
function finish() {
  act(() => {
    vi.advanceTimersByTime(2000);
  });
}

// Opens a step's status menu and picks an option by its label
function pick(menuName, optionName) {
  fireEvent.click(screen.getByRole("combobox", { name: menuName }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

describe("StatusStack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a page per step, with the current one on top and the pages under it inert", () => {
    const { container } = renderStack();

    expect(screen.getByRole("group", { name: "Status history: Offer, step 3 of 3" })).toBeInTheDocument();
    expect(page(container, "3")).toHaveClass("current", "status-offer");
    expect(page(container, "3")).not.toHaveAttribute("inert");
    expect(page(container, "2")).toHaveClass("earlier", "status-interview");
    expect(page(container, "2")).toHaveAttribute("inert");
    expect(within(page(container, "2")).getByRole("button", { name: /^Interview on 8 Oct/ })).toHaveTextContent("8 Oct");
  });

  it("shades a run of interview rounds deeper and lighter in turn, leaving other pages as they are", () => {
    const steps = [
      { id: "1", status: "Applied", date: "2026-10-01" },
      { id: "2", status: "Interview", date: "2026-10-02" },
      { id: "3", status: "Interview", date: "2026-10-03" },
      { id: "4", status: "Interview", date: "2026-10-04" },
      { id: "5", status: "Interview", date: "2026-10-05" }
    ];
    const { container } = renderStack({ job: { ...JOB, status: "Interview", steps } });

    expect(steps.map(({ id }) => ["deeper", "lighter"].find((shade) => page(container, id).classList.contains(shade)) ?? "")).toEqual(["", "deeper", "lighter", "deeper", ""]);
  });

  it("locks the first step's status, and offers a fold back to the step beneath", () => {
    const { container } = renderStack();

    expect(within(page(container, "1")).getByRole("combobox", { hidden: true })).toBeDisabled();
    expect(within(page(container, "1")).queryByRole("button", { name: /^Remove/, hidden: true })).toBeNull();
    expect(container.querySelector(".zone")).toHaveClass("can-fold");
    expect(screen.getByRole("button", { name: "Fold back to Interview" })).toBeInTheDocument();
  });

  it("folds the top page back one step, announcing what it shows", () => {
    const { container, onFoldChange } = renderStack();

    fireEvent.click(screen.getByRole("button", { name: "Fold back to Interview" }));

    expect(onFoldChange).toHaveBeenCalledWith("5", true);
    expect(page(container, "3")).toHaveClass("turned");
    expect(page(container, "2")).not.toHaveAttribute("inert");
    expect(screen.getByText("Showing Interview from 8 Oct, step 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fold back to Applied" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to the current status, Offer" })).toBeInTheDocument();
  });

  it("returns to the current status on Escape", () => {
    const { container, onFoldChange } = renderStack();

    fireEvent.click(screen.getByRole("button", { name: "Fold back to Interview" }));
    fireEvent.keyDown(page(container, "2"), { key: "Escape" });
    finish();

    expect(onFoldChange).toHaveBeenLastCalledWith("5", false);
    expect(page(container, "3")).not.toHaveClass("turned");
    expect(screen.getByText("Back to Offer")).toBeInTheDocument();
  });

  it("returns to a step when its strip is clicked", () => {
    const { container } = renderStack();

    fireEvent.click(screen.getByRole("button", { name: "Fold back to Interview" }));
    fireEvent.click(screen.getByRole("button", { name: "Fold back to Applied" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to Interview, 8 Oct" }));

    expect(page(container, "2")).not.toHaveClass("turned");
    expect(page(container, "3")).toHaveClass("turned");
  });

  it("starts no animation when the list re-renders with new callbacks", () => {
    const { rerender, ...handlers } = renderStack();
    const frame = vi.spyOn(window, "requestAnimationFrame");

    rerender(<StatusStack job={JOB} folded={false} {...handlers} onFoldChange={vi.fn()} />);

    expect(frame).not.toHaveBeenCalled();
  });

  it("unfolds when another card folds", () => {
    const { container, rerender, ...handlers } = renderStack();

    fireEvent.click(screen.getByRole("button", { name: "Fold back to Interview" }));
    rerender(<StatusStack job={JOB} folded {...handlers} />);
    rerender(<StatusStack job={JOB} folded={false} {...handlers} />);

    expect(page(container, "3")).not.toHaveClass("turned");
  });

  it("unfolds when a new status arrives while folded, such as an accepted email update", () => {
    const { container, rerender, onFoldChange, ...handlers } = renderStack();
    const added = { ...JOB, status: "Rejected", steps: [...JOB.steps, { id: "4", status: "Rejected", date: "2026-10-25" }] };

    fireEvent.click(screen.getByRole("button", { name: "Fold back to Interview" }));
    fireEvent.click(screen.getByRole("button", { name: "Fold back to Applied" }));
    rerender(<StatusStack job={added} folded {...handlers} onFoldChange={onFoldChange} />);
    finish();

    expect([...container.querySelectorAll(".zpage.turned")]).toEqual([]);
    expect(screen.getByRole("group", { name: "Status history: Rejected, step 4 of 4" })).toBeInTheDocument();
    expect(onFoldChange).toHaveBeenLastCalledWith("5", false);
  });

  it("adds a step from the current status's menu, including another interview", () => {
    const job = { ...JOB, status: "Interview", steps: JOB.steps.slice(0, 2) };
    const { onAddStep } = renderStack({ job });

    pick("Change status for Acme", "Offer");
    pick("Change status for Acme", "Another interview");

    expect(onAddStep.mock.calls).toEqual([["5", "Offer"], ["5", "Interview"]]);
  });

  it("keeps the old current status's look under a new one until it lands, also when the server gives it its real ID", () => {
    const job = { ...JOB, status: "Interview", steps: JOB.steps.slice(0, 2) };
    const added = { ...job, status: "Offer", steps: [...job.steps, { id: "temp-1", status: "Offer", date: "2026-10-20" }] };
    const saved = { ...added, steps: [...job.steps, { id: "9", status: "Offer", date: "2026-10-20" }] };
    const { container, rerender, ...handlers } = renderStack({ job });

    rerender(<StatusStack job={added} folded={false} {...handlers} />);
    rerender(<StatusStack job={saved} folded={false} {...handlers} />);
    const whileLanding = page(container, "2").classList.contains("holding");
    finish();

    expect(whileLanding).toBe(true);
    expect(page(container, "2")).not.toHaveClass("holding");
  });

  it("ends a new status's arrival when a fold takes over before it lands", () => {
    const job = { ...JOB, status: "Interview", steps: JOB.steps.slice(0, 2) };
    const added = { ...job, status: "Offer", steps: [...job.steps, { id: "temp-1", status: "Offer", date: "2026-10-20" }] };
    const { container, rerender, ...handlers } = renderStack({ job });

    rerender(<StatusStack job={added} folded={false} {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Fold back to Interview" }));

    expect(page(container, "2")).not.toHaveClass("holding");
    expect(page(container, "temp-1")).toHaveClass("turned");
  });

  it("puts the pages back as they were when the server refuses a new status before it lands", () => {
    const job = { ...JOB, status: "Interview", steps: JOB.steps.slice(0, 2) };
    const added = { ...job, status: "Offer", steps: [...job.steps, { id: "temp-1", status: "Offer", date: "2026-10-20" }] };
    const { container, rerender, ...handlers } = renderStack({ job });

    rerender(<StatusStack job={added} folded={false} {...handlers} />);
    rerender(<StatusStack job={job} folded={false} {...handlers} />);

    expect(page(container, "2")).not.toHaveClass("holding");
    expect(page(container, "temp-1")).toBeNull();
  });

  it("keeps the pages still while an undo folds the current status away", () => {
    const { container, onRemoveStep } = renderStack();

    pick("Change status for Acme", "Undo Offer");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Fold back to Applied" }));
    const turnedWhileUndoing = page(container, "2").classList.contains("turned");
    finish();

    expect(turnedWhileUndoing).toBe(false);
    expect(onRemoveStep).toHaveBeenCalledWith("5", "3");
  });

  it("changes an earlier step's status within the rules", () => {
    const job = { ...JOB, status: "Rejected", steps: [...JOB.steps.slice(0, 2), { id: "3", status: "Rejected", date: "2026-10-20" }] };
    const { onChangeStep } = renderStack({ job });

    fireEvent.click(screen.getByRole("button", { name: "Fold back to Interview" }));
    pick("Change the Interview step for Acme", "Offer");

    expect(onChangeStep).toHaveBeenCalledWith("5", "2", { status: "Offer" });
  });

  it("undoes the current status after asking, once it has folded away, with the step before looking current meanwhile", () => {
    const { container, onRemoveStep } = renderStack();

    pick("Change status for Acme", "Undo Offer");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const callsWhileFolding = onRemoveStep.mock.calls.length;
    const below = page(container, "2").className;
    finish();

    expect(callsWhileFolding).toBe(0);
    expect(below).toMatch(/\bcurrent\b/);
    expect(below).not.toMatch(/\bearlier\b/);
    expect(onRemoveStep).toHaveBeenCalledWith("5", "3");
  });

  it("removes an earlier step after asking", () => {
    const { onRemoveStep } = renderStack();

    fireEvent.click(screen.getByRole("button", { name: "Fold back to Interview" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove the Interview step" }));
    const asked = screen.queryByText("Remove Interview?") !== null;
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    finish();

    expect(asked).toBe(true);
    expect(onRemoveStep).toHaveBeenCalledWith("5", "2");
  });

  it("asks nothing new while a removal is under way", () => {
    renderStack();

    fireEvent.click(screen.getByRole("button", { name: "Fold back to Interview" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove the Interview step" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Fold back to Applied" }));

    expect(screen.queryByText(/^Remove /)).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  });

  it("keeps the application on Keep, and deletes it on Delete", () => {
    const { onDelete } = renderStack();

    fireEvent.click(screen.getByRole("button", { name: "Delete Acme application" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    const callsAfterKeep = onDelete.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Delete Acme application" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(callsAfterKeep).toBe(0);
    expect(onDelete.mock.calls).toEqual([["5"]]);
  });

  it("returns focus to the × after Keep, and to the step before after an undo", () => {
    renderStack();

    fireEvent.click(screen.getByRole("button", { name: "Delete Acme application" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    const afterKeep = document.activeElement;
    pick("Change status for Acme", "Undo Offer");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    finish();

    expect(afterKeep).toHaveAccessibleName("Delete Acme application");
    expect(document.activeElement).toHaveAccessibleName("Change the Interview step for Acme");
  });

  it("changes a step's date from the date box", () => {
    const { onChangeStep } = renderStack();

    fireEvent.click(screen.getByRole("button", { name: /^Offer on 20 Oct/ }));
    fireEvent.change(screen.getByLabelText("Offer date"), { target: { value: "2026-10-22" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onChangeStep).toHaveBeenCalledWith("5", "3", { date: "2026-10-22" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("waits while a change is saving, keeping the look of controls that are off only for the save", () => {
    renderStack({ busy: true });

    expect(screen.getByRole("combobox", { name: "Change status for Acme" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Change status for Acme" })).toHaveClass("waiting");
    expect(screen.getByRole("button", { name: "Delete Acme application" })).toHaveClass("waiting");
    expect(screen.getByRole("button", { name: "Delete Acme application" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Change the Applied step for Acme" })).not.toHaveClass("waiting");
    expect(screen.getByRole("button", { name: "Fold back to Interview" })).toBeEnabled();
  });

  it("shows the button for the resume sent on the current page, and downloads it", () => {
    const onDownloadCv = vi.fn();
    const job = { ...JOB, cv_job_id: "9" };

    renderStack({ job, onDownloadCv });
    fireEvent.click(screen.getByRole("button", { name: "Download the resume you sent to Acme" }));

    expect(onDownloadCv).toHaveBeenCalledWith(job);
  });

  it("keeps the resume button off while it downloads, and leaves it out when no resume was sent", () => {
    const { rerender, ...handlers } = renderStack({ job: { ...JOB, cv_job_id: "9" }, cvBusy: true });
    const busy = screen.getByRole("button", { name: "Download the resume you sent to Acme" }).disabled;

    rerender(<StatusStack job={JOB} folded={false} {...handlers} />);

    expect(busy).toBe(true);
    expect(screen.queryByRole("button", { name: /^Download the resume/ })).toBeNull();
  });
});
