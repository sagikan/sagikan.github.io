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

// Builds an Acme application applied on October 1st, whose current step has the given status and date
function application(id, position, status, date) {
  return {
    id,
    company: "Acme",
    position,
    status,
    applied_at: "2026-10-01",
    steps: [{ id: `${id}-1`, status: "Applied", date: "2026-10-01" }, { id: `${id}-2`, status, date }]
  };
}

// Renders the page with applications, email updates and an answer for every update action
function renderPage(answer, applications = [], emailUpdates = { pending: [PENDING], recent: [RECENT] }) {
  const onResolveEmailUpdate = vi.fn(async () => answer);

  render(
    <Applications
      csrfToken="token-1"
      applications={applications}
      emailUpdates={emailUpdates}
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

  it("lists only upcoming interviews under Upcoming, soonest first and without the glow", () => {
    renderPage("", [
      application("1", "Later", "Interview", "2099-02-01"),
      application("2", "Past", "Interview", "2026-10-08"),
      application("3", "Sooner", "Interview", "2099-01-01"),
      application("4", "Offer", "Offer", "2026-10-08")
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Upcoming" }));
    const titles = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);

    expect(titles).toEqual(["Sooner", "Later"]);
    expect(document.querySelector(".app-card.upcoming")).toBeNull();
  });

  it("names a suggestion that repeats the status as another interview, in review and in recent updates", () => {
    const job = application("9", "Backend Engineer", "Interview", "2026-10-08");
    const pending = { ...PENDING, application_id: "9" };
    const recent = { ...RECENT, previous_status: "Interview" };

    renderPage("", [job], { pending: [pending], recent: [recent] });
    fireEvent.click(screen.getByRole("button", { name: /Needs your review/ }));
    fireEvent.click(screen.getByRole("button", { name: /Approved in past day/ }));

    expect(screen.getByRole("group", { name: "Another interview" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Another interview. Accepted by you" })).toBeInTheDocument();
  });

  it("lists a card waiting on an email update in the main list too, with its status area instead of the update", () => {
    const job = application("9", "Backend Engineer", "Interview", "2099-01-01");
    const pending = { ...PENDING, application_id: "9", suggested_status: "Rejected" };

    renderPage("", [job], { pending: [pending], recent: [] });
    fireEvent.click(screen.getByRole("button", { name: /Needs your review/ }));
    const review = screen.getByRole("region", { name: "Emails to review" });
    const listed = screen.getByRole("heading", { name: "Backend Engineer, upcoming interview" }).closest(".app-card");

    expect(within(review).getByRole("group", { name: "Interview to Rejected" })).toBeInTheDocument();
    expect(review).not.toContainElement(listed);
    expect(listed.querySelector(".app-suggestion")).toBeNull();
    expect(screen.getAllByRole("group", { name: "Interview to Rejected" })).toHaveLength(1);
  });

  it("folds only the main list's card, not its copy in the review section", async () => {
    const job = application("9", "Backend Engineer", "Interview", "2026-10-08");
    const pending = { ...PENDING, application_id: "9", suggested_status: "Rejected" };

    renderPage("", [job], { pending: [pending], recent: [] });
    fireEvent.click(screen.getByRole("button", { name: /Needs your review/ }));
    fireEvent.click(screen.getByRole("button", { name: "Fold back to Applied" }));
    const review = screen.getByRole("region", { name: "Emails to review" });
    const listed = await screen.findByRole("group", { name: "Status history: Applied, step 1 of 2" });

    expect(listed.closest(".app-card")).toHaveClass("folded");
    expect(within(review).getByRole("group", { name: "Interview to Rejected" }).closest(".app-card")).not.toHaveClass("folded");
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
