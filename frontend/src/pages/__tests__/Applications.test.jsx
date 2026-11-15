import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localISO } from "../../lib/api";
import Applications from "../Applications";

const RECENT = {
  id: "71",
  state: "accepted",
  subject: "Interview invitation",
  sender: "Review Labs <jobs@reviewlabs.example>",
  received_at: "2026-11-15T08:00:00Z",
  resolved_at: new Date().toISOString(),
  suggested_status: "Interview",
  previous_status: "Applied",
  application_company: "Review Labs",
  application_position: "Backend Engineer",
  undoable: true
};
const PENDING = {
  id: "72",
  state: "pending",
  subject: "Interview: Robotics Engineer",
  sender: "Newco Robotics <talent@newco.example>",
  received_at: "2026-11-15T07:00:00Z",
  suggested_status: "Interview",
  company: "Newco Robotics",
  position: "Robotics Engineer",
  application_id: null,
  candidate_ids: []
};

// Renders the page with applications, email updates and an answer for every update action
function renderPage(answer, applications = []) {
  const onResolveEmailUpdate = vi.fn(async () => answer);

  render(
    <Applications
      csrfToken="token-1"
      applications={applications}
      emailUpdates={{ pending: [PENDING], recent: [RECENT] }}
      onResolveEmailUpdate={onResolveEmailUpdate}
      error=""
      onDismissError={() => {}}
      onSave={async () => ""}
      onDelete={() => {}}
      onUnauthorized={() => {}}
      savingIds={new Set()}
      onAddStep={() => {}}
      onChangeStep={() => {}}
      onRemoveStep={() => {}}
    />
  );

  return { onResolveEmailUpdate };
}

describe("Applications", () => {
  // jsdom doesn't lay anything out, so the charts and rows get stand-ins that measure nothing
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}

      disconnect() {}
    });
    Range.prototype.getBoundingClientRect = () => ({ width: 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete Range.prototype.getBoundingClientRect;
  });

  it("orders a day's applications by status, also one without an applied date", () => {
    const today = localISO(new Date());
    // Builds an application created now, applied today and moved on to its status today
    const job = (id, position, status, appliedAt) => ({
      id,
      company: "Acme",
      position,
      status,
      applied_at: appliedAt,
      created_at: new Date().toISOString(),
      steps: [{ id: `${id}-1`, status: "Applied", date: today }, { id: `${id}-2`, status, date: today }]
    });

    renderPage("", [
      job("1", "Rejected without a date", "Rejected", null),
      job("2", "Offer", "Offer", today),
      job("3", "Rejected with a date", "Rejected", today)
    ]);
    const titles = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);

    expect(titles).toEqual(["Offer", "Rejected without a date", "Rejected with a date"]);
  });

  it("shows a failed undo's message in the recent updates, not in the review section", async () => {
    const { onResolveEmailUpdate } = renderPage("The status changed since this update, so it can't be undone.");

    fireEvent.click(screen.getByRole("button", { name: /Approved in past day/ }));
    fireEvent.click(screen.getByRole("button", { name: /Needs your review/ }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const recent = screen.getByRole("region", { name: "Recent email updates" });
    const message = await within(recent).findByText("The status changed since this update, so it can't be undone.");

    expect(onResolveEmailUpdate).toHaveBeenCalledWith("71", "undo", undefined);
    expect(message).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Emails to review" })).queryByText(/can't be undone/)).toBeNull();
  });

  it("shows a failed review action's message in the review section", async () => {
    renderPage("Could not update. Please try again.");

    fireEvent.click(screen.getByRole("button", { name: /Needs your review/ }));
    fireEvent.click(screen.getByRole("button", { name: /Approved in past day/ }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    const review = screen.getByRole("region", { name: "Emails to review" });
    const message = await within(review).findByText("Could not update. Please try again.");

    expect(message).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Recent email updates" })).queryByText("Could not update. Please try again.")).toBeNull();
  });
});
