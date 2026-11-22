import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Footer from "../Footer";

// Finds the credits panel, whether it is open or not
function panel() {
  return document.getElementById(screen.getByRole("button", { name: "Credits" }).getAttribute("aria-controls"));
}

describe("Footer", () => {
  it("shows the copyright with the current year", () => {
    render(<Footer apiStatus="online" />);

    expect(screen.getByText(`© ${new Date().getFullYear()} Applicant Zero`)).toBeInTheDocument();
  });

  it("links to the privacy policy", () => {
    render(<Footer apiStatus="online" />);

    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "#/privacy");
  });

  it("shows Credits last, after the privacy link, with the credits closed", () => {
    render(<Footer apiStatus="online" />);

    const nav = screen.getByRole("navigation", { name: "Footer" });
    const toggle = screen.getByRole("button", { name: "Credits" });

    expect(nav.lastElementChild).toContainElement(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel()).not.toBeVisible();
  });

  it("opens the credits on click", () => {
    render(<Footer apiStatus="online" />);
    fireEvent.click(screen.getByRole("button", { name: "Credits" }));

    expect(screen.getByRole("button", { name: "Credits" })).toHaveAttribute("aria-expanded", "true");
    expect(panel()).toBeVisible();
  });

  it.each([
    ["a second click", () => fireEvent.click(screen.getByRole("button", { name: "Credits" }))],
    ["a click outside them", () => fireEvent.pointerDown(document.body)],
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })]
  ])("closes the credits on %s", (_title, dismiss) => {
    render(<Footer apiStatus="online" />);
    fireEvent.click(screen.getByRole("button", { name: "Credits" }));
    dismiss();

    expect(panel()).not.toBeVisible();
  });

  it("keeps the credits open when clicking inside them", () => {
    render(<Footer apiStatus="online" />);
    fireEvent.click(screen.getByRole("button", { name: "Credits" }));
    fireEvent.pointerDown(panel());

    expect(panel()).toBeVisible();
  });

  it("lists Logo.dev and the Israeli Tech Map by Michael Lugassy under the ODbL, with links that open in a new tab", () => {
    render(<Footer apiStatus="online" />);
    fireEvent.click(screen.getByRole("button", { name: "Credits" }));

    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    const links = [
      [screen.getByRole("link", { name: "Logo.dev" }), "https://logo.dev"],
      [screen.getByRole("link", { name: "Israeli Tech Map" }), "https://github.com/mluggy/techmap"],
      [screen.getByRole("link", { name: "ODbL" }), "https://opendatacommons.org/licenses/odbl/1-0/"]
    ];

    expect(items).toEqual(["Logos: Logo.dev", "Company data: Israeli Tech Map by Michael Lugassy (ODbL)"]);
    links.forEach(([link, href]) => {
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  it("keeps the credit links in the page while the credits are closed", () => {
    const { container } = render(<Footer apiStatus="online" />);

    expect(container.querySelector("a[href='https://logo.dev']")).toBeInTheDocument();
    expect(container.querySelector("a[href='https://github.com/mluggy/techmap']")).toBeInTheDocument();
  });

  it.each([
    ["checking", "Connecting…"],
    ["online", "API online"],
    ["offline", "API offline"]
  ])("shows the server as %s", (apiStatus, label) => {
    const { container } = render(<Footer apiStatus={apiStatus} />);

    expect(container.querySelector(".api-pill")).toHaveAttribute("title", label);
    expect(container.querySelector(".api-pill")).toHaveClass(`api-${apiStatus}`);
  });
});
