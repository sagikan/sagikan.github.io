import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import JobPostForm from "../JobPostForm";

const THIS_YEAR = new Date().getFullYear();
const OLD = { id: 1, position: "Backend Engineer", company: "Orbit", status: "Applied", job_url: null, applied_at: `${THIS_YEAR - 2}-03-05`, created_at: `${THIS_YEAR - 2}-03-05T08:00:00Z` };
const NEWER = { id: 2, position: "Backend Engineer", company: "Orbit", status: "Rejected", job_url: null, applied_at: `${THIS_YEAR - 1}-06-21`, created_at: `${THIS_YEAR - 1}-06-21T08:00:00Z` };
const MANUAL_JOB = { id: 9, position: "Data Engineer", company: "Globex", source: "manual", created_at: `${THIS_YEAR}-01-01T08:00:00Z` };

// Renders the form with the given props
function renderForm(props = {}) {
  return render(<JobPostForm csrfToken="token" pastEntries={[OLD, NEWER, MANUAL_JOB]} applications={[OLD, NEWER]} onAdded={() => {}} onUnauthorized={() => {}} {...props} />);
}

// Types a position and company into the form
async function fill(user, position, company) {
  await user.type(screen.getByPlaceholderText("Software Engineer"), position);
  await user.type(screen.getByPlaceholderText("ABC Inc."), company);
}

describe("JobPostForm duplicates", () => {
  it("warns about the most recent application for the same position and company, with its date", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Orbit");

    expect(screen.getByRole("status")).toHaveTextContent(/You were rejected for this position after applying on .*21/);
    expect(screen.getByRole("status")).toHaveTextContent(String(THIS_YEAR - 1));
  });

  it("offers no revert button, since the form has no note to withdraw", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Orbit");

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revert/i })).not.toBeInTheDocument();
  });

  it("shows no warning before both fields are filled", async () => {
    const user = userEvent.setup();

    renderForm();
    await user.type(screen.getByPlaceholderText("Software Engineer"), "Backend Engineer");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows no warning for a position and company that was not applied to", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Globex");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not count a job post that was only added, not applied to", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Data Engineer", "Globex");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("counts an application from today, since a new job post has no date of its own", async () => {
    const user = userEvent.setup();
    const today = new Date().toLocaleDateString("en-CA");

    renderForm({ applications: [{ ...OLD, applied_at: today }] });
    await fill(user, "Backend Engineer", "Orbit");

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("stops warning when the company is changed to one with no application", async () => {
    const user = userEvent.setup();

    renderForm();
    await fill(user, "Backend Engineer", "Orbit");
    await user.type(screen.getByPlaceholderText("ABC Inc."), " Labs");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
