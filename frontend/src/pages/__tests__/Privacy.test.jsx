import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Privacy from "../Privacy";

describe("Privacy", () => {
  it("shows a title, a summary and the date it was last updated", () => {
    render(<Privacy />);

    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(screen.getByText("In short:")).toBeInTheDocument();
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });

  it.each([
    "1. Who we are",
    "2. The data we handle",
    "3. Email sync",
    "4. How we use your data",
    "5. AI processing",
    "6. Who else receives data",
    "7. Cookies",
    "8. How long we keep data",
    "9. Your rights and choices",
    "10. Security",
    "11. Where data is processed",
    "12. Children",
    "13. Changes to this policy",
    "14. Contact"
  ])("has the section %s", (title) => {
    render(<Privacy />);

    expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
  });

  it("tells users that emails judged unrelated are still recorded", () => {
    render(<Privacy />);

    expect(screen.getByText(/includes emails the AI decides are not about your applications/)).toBeInTheDocument();
  });

  it.each(["Render", "GitHub", "Anthropic", "JSearch (through RapidAPI)", "Logo.dev", "Google"])("names %s among the services that receive data", (provider) => {
    render(<Privacy />);

    const table = screen.getByRole("heading", { level: 2, name: "6. Who else receives data" }).nextElementSibling.nextElementSibling;

    expect(within(table).getByRole("rowheader", { name: provider })).toBeInTheDocument();
  });

  it("says it uses no advertising or analytics cookies", () => {
    render(<Privacy />);

    expect(screen.getByText(/no advertising or analytics cookies/)).toBeInTheDocument();
  });

  it("lists how long data is kept, including backups", () => {
    render(<Privacy />);

    expect(screen.getByRole("rowheader", { name: "Backups" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Email sync records" })).toBeInTheDocument();
  });

  it.each([
    "bcrypt",
    "hash",
    "encrypt",
    "private repository",
    "token",
    "pending_auth",
    "HTTP-only",
    "SameSite",
    "rate limit",
    "60 minutes",
    "15 minutes",
    "4,000",
    "300 emails",
    "Apps Script",
    "ignored",
    "daily limit",
    "two-factor authentication is required"
  ])("does not describe internal mechanics such as %s", (detail) => {
    const { container } = render(<Privacy />);

    expect(container.textContent.toLowerCase()).not.toContain(detail.toLowerCase());
  });
});
