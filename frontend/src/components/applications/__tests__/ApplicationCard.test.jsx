import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApplicationCard from "../ApplicationCard";

const JOB = {
  id: "5",
  company: "Acme",
  position: "Backend Engineer",
  location: "Haifa",
  workplace_model: "Hybrid",
  status: "Interview",
  applied_at: "2026-10-01",
  job_url: "https://example.com/job",
  notes: "Call back",
  steps: [
    { id: "1", status: "Applied", date: "2026-10-01" },
    { id: "2", status: "Interview", date: "2026-10-08" }
  ]
};
const UPCOMING_JOB = { ...JOB, steps: [JOB.steps[0], { id: "2", status: "Interview", date: "2099-01-01" }] };

// Renders a card inside a list, with spies for its callbacks
function renderCard(props = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onCardClick: vi.fn(),
    onDownloadCv: vi.fn(),
    onFoldChange: vi.fn(),
    onAddStep: vi.fn(),
    onChangeStep: vi.fn(),
    onRemoveStep: vi.fn(),
    onDelete: vi.fn()
  };
  const view = render(<ul><ApplicationCard job={JOB} {...handlers} {...props} /></ul>);

  return { ...view, ...handlers };
}

describe("ApplicationCard", () => {
  // jsdom doesn't lay text out, so the info row's fitting gets stand-ins that measure nothing
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

  it("shows the application's details, note and status area, colored by its status", () => {
    const { container } = renderCard();

    expect(screen.getByRole("heading", { name: "Backend Engineer" })).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Haifa")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View posting" })).toHaveAttribute("href", "https://example.com/job");
    expect(screen.getByText("Call back")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Status history: Interview, step 2 of 2" })).toBeInTheDocument();
    expect(container.querySelector(".app-card")).toHaveClass("status-interview");
  });

  it("opens the editor from its edit button, and reports clicks with the card's fold", () => {
    const { container, onEdit, onCardClick } = renderCard({ folded: true });

    fireEvent.click(screen.getByRole("button", { name: "Edit Acme application" }));
    fireEvent.click(container.querySelector(".app-main"));

    expect(onEdit).toHaveBeenCalledWith(JOB);
    expect(onCardClick).toHaveBeenLastCalledWith(expect.anything(), JOB, true);
    expect(container.querySelector(".app-card")).toHaveClass("folded");
  });

  it("hides the date when the list groups by day", () => {
    const { container } = renderCard({ hideCardDate: true });

    expect(container.querySelector(".app-date-item")).toBeNull();
  });

  it("shows an email update's panel and mail line in place of the status area, with the date and no editing", () => {
    const { container, onCardClick } = renderCard({
      hideCardDate: true,
      review: <div className="app-suggestion">Suggests Offer</div>,
      footer: <p>From Acme</p>
    });

    fireEvent.click(container.querySelector(".app-main"));

    expect(screen.getByText("Suggests Offer")).toBeInTheDocument();
    expect(screen.getByText("From Acme")).toBeInTheDocument();
    expect(container.querySelector(".zone")).toBeNull();
    expect(container.querySelector(".app-date-item")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Acme application" })).toBeNull();
    expect(container.querySelector(".app-card")).toHaveClass("needs-review");
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("glows and names the upcoming interview for screen readers when the interview is ahead", () => {
    const { container } = renderCard({ job: UPCOMING_JOB });

    expect(container.querySelector(".app-card")).toHaveClass("upcoming");
    expect(screen.getByRole("heading", { name: "Backend Engineer, upcoming interview" })).toBeInTheDocument();
  });

  it.each([
    ["an interview that already happened", { job: JOB }],
    ["the Upcoming filter", { job: UPCOMING_JOB, markUpcoming: false }],
    ["an email update's panel", { job: UPCOMING_JOB, review: <div>Suggests Offer</div> }]
  ])("doesn't glow for %s", (_title, props) => {
    const { container } = renderCard(props);

    expect(container.querySelector(".app-card")).not.toHaveClass("upcoming");
  });

  it("shows the status as the only step when the server sends no steps", () => {
    renderCard({ job: { ...JOB, steps: undefined } });

    expect(screen.getByRole("group", { name: "Status history: Interview, step 1 of 1" })).toBeInTheDocument();
  });
});
