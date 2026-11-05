import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PillGroup from "../PillGroup";

const OPTIONS = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" }
];

describe("PillGroup", () => {
  it.each([
    ["toggle", "group", "button", "aria-pressed"],
    ["tab", "tablist", "tab", "aria-selected"],
    ["radio", "radiogroup", "radio", "aria-checked"]
  ])("uses the %s roles and marks the active option", (mode, groupRole, itemRole, attribute) => {
    render(<PillGroup mode={mode} options={OPTIONS} value="month" onChange={() => {}} aria-label="Range" />);

    expect(screen.getByRole(groupRole, { name: "Range" })).toBeTruthy();
    expect(screen.getByRole(itemRole, { name: "Month" }).getAttribute(attribute)).toBe("true");
    expect(screen.getByRole(itemRole, { name: "Week" }).getAttribute(attribute)).toBe("false");
  });

  it("reports the clicked option", () => {
    const onChange = vi.fn();

    render(<PillGroup options={OPTIONS} value="week" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Year" }));

    expect(onChange).toHaveBeenCalledWith("year");
  });

  it("lights the hovered option and returns to the active one on leave", () => {
    const { container } = render(<PillGroup options={OPTIONS} value="week" onChange={() => {}} />);
    // Lists the text of the lit options
    const lit = () => [...container.querySelectorAll(".is-lit")].map((node) => node.textContent);

    expect(lit()).toEqual(["Week"]);

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Year" }));

    expect(lit()).toEqual(["Year"]);

    fireEvent.pointerLeave(container.firstChild);

    expect(lit()).toEqual(["Week"]);
  });

  it("keeps every active option lit in a multiple group", async () => {
    const { container } = render(<PillGroup multiple options={OPTIONS} value={["week", "year"]} onChange={() => {}} />);

    expect([...container.querySelectorAll(".is-lit")].map((node) => node.textContent)).toEqual(["Week", "Year"]);
    await waitFor(() => expect(container.querySelectorAll(".pill-marker.is-shown")).toHaveLength(2));

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Month" }));

    await waitFor(() => expect(container.querySelectorAll(".pill-marker.is-shown")).toHaveLength(3));
  });

  it("slides the hover marker between active and inactive options but jumps between active ones", () => {
    const { container } = render(<PillGroup multiple options={OPTIONS} value={["week", "year"]} onChange={() => {}} />);
    // Finds the hover marker
    const hover = () => container.querySelector(".pill-marker-hover");

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Week" }));

    expect(hover().classList.contains("jump")).toBe(true);

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Month" }));

    expect(hover().classList.contains("jump")).toBe(false);

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Year" }));

    expect(hover().classList.contains("jump")).toBe(false);

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Week" }));

    expect(hover().classList.contains("jump")).toBe(true);
  });

  it("keeps the hover when the focused option loses focus to a press", () => {
    const { container } = render(<PillGroup options={OPTIONS} value="week" onChange={() => {}} />);
    const week = screen.getByRole("button", { name: "Week" });

    week.focus();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Year" }));
    fireEvent.blur(week);

    expect(container.querySelector(".is-lit").textContent).toBe("Year");
  });
});
