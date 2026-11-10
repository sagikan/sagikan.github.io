import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ApplicationForm from "../ApplicationForm";

const THIS_YEAR = new Date().getFullYear();
const OLD = { id: 1, position: "Backend Engineer", company: "Orbit", location: "Haifa", status: "Applied", job_url: "https://orbit.example/jobs/1", applied_at: `${THIS_YEAR - 2}-03-05`, created_at: `${THIS_YEAR - 2}-03-05T08:00:00Z` };
const NEWER = { id: 2, position: "Backend Engineer", company: "Orbit", location: "Haifa", status: "Rejected", job_url: "https://orbit.example/jobs/2", applied_at: `${THIS_YEAR - 1}-06-21`, created_at: `${THIS_YEAR - 1}-06-21T08:00:00Z` };
const OTHER = { id: 3, position: "Data Engineer", company: "Globex", location: "Tel Aviv", status: "Applied", job_url: null, applied_at: `${THIS_YEAR - 1}-01-02`, created_at: `${THIS_YEAR - 1}-01-02T08:00:00Z` };

// Renders the form with the given props
function renderForm(props = {}) {
  return render(<ApplicationForm job={null} applications={[OLD, NEWER, OTHER]} onSubmit={vi.fn()} {...props} />);
}

// Types a position and company into the form
async function fill(user, position, company) {
  await user.clear(screen.getByPlaceholderText("Software Engineer"));
  await user.type(screen.getByPlaceholderText("Software Engineer"), position);
  await user.clear(screen.getByPlaceholderText("ABC Inc."));
  await user.type(screen.getByPlaceholderText("ABC Inc."), company);
}

// Returns the notes box
const notes = () => screen.getByPlaceholderText("Recruiter name, salary range, next steps, etc.");

describe("ApplicationForm duplicates", () => {
  it("warns about the most recent application for the same position and company, with its date", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Orbit");

    expect(screen.getByRole("status")).toHaveTextContent(/You were rejected for this position after applying on .*21/);
    expect(screen.getByRole("status")).toHaveTextContent(String(THIS_YEAR - 1));
  });

  it("words the warning for an application that was not rejected", async () => {
    const user = userEvent.setup();

    renderForm({ applications: [OLD] });
    await fill(user, "Backend Engineer", "Orbit");

    expect(screen.getByRole("status")).toHaveTextContent(/^You applied to this position on /);
  });

  it("saves the note as automatic only while it is the generated one", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = renderForm({ onSubmit });

    await fill(user, "Backend Engineer", "Orbit");
    await user.type(screen.getByPlaceholderText("Tel Aviv-Yafo"), "Haifa");
    fireEvent.submit(container.querySelector("form"));
    await user.type(notes(), "!");
    fireEvent.submit(container.querySelector("form"));

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ notes_auto: true });
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ notes_auto: false });
  });

  it("refreshes a saved automatic note and the warning when the earlier application changed since", () => {
    const saved = `Applied on Jun 21st, ${THIS_YEAR - 1}: https://orbit.example/jobs/2`;

    renderForm({
      applications: [NEWER],
      job: { id: 99, position: "Backend Engineer", company: "Orbit", status: "Applied", applied_at: `${THIS_YEAR}-01-01`, notes: saved, notes_auto: true }
    });

    expect(notes()).toHaveValue(`Rejected on Jun 21st, ${THIS_YEAR - 1}: https://orbit.example/jobs/2`);
    expect(screen.getByRole("status")).toHaveTextContent(/^You were rejected for this position/);
  });

  it("keeps a saved note that is not marked automatic when an application is edited", () => {
    renderForm({
      applications: [NEWER],
      job: { id: 99, position: "Backend Engineer", company: "Orbit", status: "Applied", applied_at: `${THIS_YEAR}-01-01`, notes: "Applied on Jun 21st", notes_auto: false }
    });

    expect(notes()).toHaveValue("Applied on Jun 21st");
  });

  it("counts an application made today, and shows its date, not an older one", async () => {
    const user = userEvent.setup();
    const today = new Date().toLocaleDateString("en-CA");

    renderForm({ applications: [OLD, NEWER, { ...OLD, id: 8, status: "Applied", job_url: "https://orbit.example/jobs/8", applied_at: today, created_at: `${today}T08:00:00` }] });
    await fill(user, "Backend Engineer", "Orbit");

    expect(screen.getByRole("status")).toHaveTextContent(new Date(`${today}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
    expect(notes().value).toContain("https://orbit.example/jobs/8");
  });

  it("shows no warning for a different position or company", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Globex");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("fills the note from the most recent application: its result, its date and its link", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Orbit");

    expect(notes()).toHaveValue(`Rejected on Jun 21st, ${THIS_YEAR - 1}: https://orbit.example/jobs/2`);
  });

  it("follows a change of company, and clears the note when no application matches", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Orbit");
    await user.clear(screen.getByPlaceholderText("ABC Inc."));
    await user.type(screen.getByPlaceholderText("ABC Inc."), "Orbit Labs");

    expect(notes()).toHaveValue("");
  });

  it("uses an older application when the date applied is moved back", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();

    await fill(user, "Backend Engineer", "Orbit");
    await user.clear(container.querySelector('input[type="date"]'));
    await user.type(container.querySelector('input[type="date"]'), `${THIS_YEAR - 1}-01-01`);

    expect(notes()).toHaveValue(`Applied on Mar 5th, ${THIS_YEAR - 2}: https://orbit.example/jobs/1`);
  });

  it("keeps a note the user typed", async () => {
    const user = userEvent.setup();

    renderForm();
    await user.type(notes(), "Referred by Dana");
    await fill(user, "Backend Engineer", "Orbit");

    expect(notes()).toHaveValue("Referred by Dana");
  });

  it("keeps editing a filled note, and does not fill it again", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Orbit");
    await user.type(notes(), " (second try)");
    await user.clear(screen.getByPlaceholderText("ABC Inc."));
    await user.type(screen.getByPlaceholderText("ABC Inc."), "Orbit");

    expect(notes().value).toMatch(/\(second try\)$/);
  });

  it("does not bring a note back once the user has cleared it", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Orbit");
    await user.clear(notes());
    await user.clear(screen.getByPlaceholderText("ABC Inc."));
    await user.type(screen.getByPlaceholderText("ABC Inc."), "Orbit");

    expect(notes()).toHaveValue("");
  });

  it("fills the note at once when the form opens with a position and company, as from an email update", () => {
    renderForm({ job: { company: "Orbit", position: "Backend Engineer", status: "Interview" } });

    expect(notes()).toHaveValue(`Rejected on Jun 21st, ${THIS_YEAR - 1}: https://orbit.example/jobs/2`);
  });

  it("does not touch the note of an application being edited, and does not warn about itself", () => {
    renderForm({ job: { ...NEWER, notes: "My own note" }, applications: [NEWER] });

    expect(notes()).toHaveValue("My own note");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not change the note of an edited application when its position is changed", async () => {
    const user = userEvent.setup();

    renderForm({ job: { ...NEWER, notes: "My own note" } });
    await user.clear(screen.getByPlaceholderText("Software Engineer"));
    await user.type(screen.getByPlaceholderText("Software Engineer"), "Backend Engineer");

    expect(notes()).toHaveValue("My own note");
  });

  it("fills an empty note of an edited application from an earlier one, never from itself", () => {
    renderForm({ job: NEWER });

    expect(notes()).toHaveValue(`Applied on Mar 5th, ${THIS_YEAR - 2}: https://orbit.example/jobs/1`);
  });

  it("closes the warning and removes its note when Revert is pressed", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Orbit");
    await user.click(screen.getByRole("button", { name: /revert/i }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(notes()).toHaveValue("");
  });

  it("keeps a note the user edited when Revert is pressed", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Orbit");
    await user.type(notes(), " (second try)");
    await user.click(screen.getByRole("button", { name: /revert/i }));

    expect(notes().value).toMatch(/\(second try\)$/);
  });

  it("removes a saved note identical to the automatic one when Revert is pressed on an edited application", async () => {
    const user = userEvent.setup();

    renderForm({ job: { id: 99, position: "Backend Engineer", company: "Orbit", status: "Applied", applied_at: new Date().toLocaleDateString("en-CA"), notes: `Rejected on Jun 21st, ${THIS_YEAR - 1}: https://orbit.example/jobs/2` } });
    await user.click(screen.getByRole("button", { name: /revert/i }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(notes()).toHaveValue("");
  });

  it("keeps a saved note whose link was changed when Revert is pressed on an edited application", async () => {
    const user = userEvent.setup();

    renderForm({ job: { id: 99, position: "Backend Engineer", company: "Orbit", status: "Applied", applied_at: new Date().toLocaleDateString("en-CA"), notes: `Rejected on Jun 21st, ${THIS_YEAR - 1}: https://orbit.example/other` } });
    await user.click(screen.getByRole("button", { name: /revert/i }));

    expect(notes()).toHaveValue(`Rejected on Jun 21st, ${THIS_YEAR - 1}: https://orbit.example/other`);
  });

  it("does not bring the warning or note back after Revert when the date changes", async () => {
    const user = userEvent.setup();
    const { container } = renderForm();

    await fill(user, "Backend Engineer", "Orbit");
    await user.click(screen.getByRole("button", { name: /revert/i }));
    await user.clear(container.querySelector('input[type="date"]'));
    await user.type(container.querySelector('input[type="date"]'), `${THIS_YEAR - 1}-01-01`);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(notes()).toHaveValue("");
  });

  it("warns again after Revert when the position or company changes to another duplicate", async () => {
    const user = userEvent.setup();

    renderForm({ applications: [OLD, NEWER, OTHER, { ...OTHER, id: 4, company: "Initech" }] });
    await fill(user, "Backend Engineer", "Orbit");
    await user.click(screen.getByRole("button", { name: /revert/i }));
    await fill(user, "Data Engineer", "Globex");

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(notes().value).toContain("Applied on");
  });

  it("refills the note of an edited application when its company is changed", async () => {
    const user = userEvent.setup();

    renderForm({ job: { ...OTHER, notes: "", applied_at: new Date().toLocaleDateString("en-CA") } });
    await fill(user, "Backend Engineer", "Orbit");

    expect(notes()).toHaveValue(`Rejected on Jun 21st, ${THIS_YEAR - 1}: https://orbit.example/jobs/2`);
  });
});
