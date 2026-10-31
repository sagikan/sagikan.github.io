import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Footer from "../Footer";

describe("Footer", () => {
  it("shows the copyright with the current year", () => {
    render(<Footer apiStatus="online" />);

    expect(screen.getByText(`© ${new Date().getFullYear()} Applicant Zero`)).toBeInTheDocument();
  });

  it("credits Logo.dev when asked to, with a link that opens in a new tab without passing on the page", () => {
    render(<Footer apiStatus="online" showCredit />);

    const link = screen.getByRole("link", { name: "Logos provided by Logo.dev" });

    expect(link).toHaveAttribute("href", "https://logo.dev");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it.each([
    ["by default", {}],
    ["when switched off", { showCredit: false }]
  ])("leaves out the Logo.dev credit %s", (_title, props) => {
    render(<Footer apiStatus="online" {...props} />);

    expect(screen.queryByRole("link", { name: /Logo\.dev/ })).not.toBeInTheDocument();
  });

  it("links to the privacy policy", () => {
    render(<Footer apiStatus="online" />);

    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "#/privacy");
  });

  it("shows the Logo.dev credit in place of the privacy link when asked to", () => {
    render(<Footer apiStatus="online" showCredit />);

    expect(screen.queryByRole("link", { name: "Privacy" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
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
