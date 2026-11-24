import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import JobDescription from "../JobDescription";

const DESCRIPTION = [
  "Requirements",
  "- Go",
  "- SQL",
  "Responsibilities",
  "Own the ledger.",
  "Acme is an equal opportunity employer."
].join("\n");

describe("JobDescription", () => {
  it("offers a tab per section, in their fixed order", () => {
    render(<JobDescription description={DESCRIPTION} position="Engineer" />);

    const tabs = within(screen.getByRole("tablist", { name: "Description sections" })).getAllByRole("tab");

    expect(tabs.map((tab) => tab.textContent)).toEqual(["Duties", "Requirements", "More"]);
  });

  it("opens on the requirements, showing only that section", () => {
    render(<JobDescription description={DESCRIPTION} position="Engineer" />);

    const panel = screen.getByRole("tabpanel");

    expect(screen.getByRole("tab", { name: "Requirements" })).toHaveAttribute("aria-selected", "true");
    expect(panel).toHaveAccessibleName("What you'll need");
    expect(within(panel).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Go", "SQL"]);
    expect(screen.queryByText("Own the ledger.")).not.toBeInTheDocument();
  });

  it("opens on the first section when there are no requirements", () => {
    render(<JobDescription description={"Responsibilities\n- Ship\nBenefits\n- Gym"} position="Engineer" />);

    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("What you'll do");
  });

  it("switches to the section of the picked tab", async () => {
    render(<JobDescription description={DESCRIPTION} position="Engineer" />);

    fireEvent.click(screen.getByRole("tab", { name: "Duties" }));

    await waitFor(() => expect(screen.getByRole("tabpanel")).toHaveAccessibleName("What you'll do"));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Own the ledger.");
  });

  it("leaves the tabs out when there is only one section", () => {
    render(<JobDescription description="Build robots." position="Engineer" />);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "About the role" })).toBeInTheDocument();
  });

  it("lays a Hebrew description out right to left, keeping the title left to right", () => {
    const { container } = render(<JobDescription description={"דרישות:\n- ניסיון בפיתוח – חובה"} position="מפתח" />);

    expect(container.querySelector(".job-desc-body")).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { name: "What you'll need" }).closest("[dir]")).toBeNull();
  });

  it("says no description was saved when there is none", () => {
    render(<JobDescription description="" position="Engineer" />);

    expect(screen.getByText(/No description was saved/)).toBeInTheDocument();
  });
});
