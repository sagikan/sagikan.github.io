import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StepDateBox from "../StepDateBox";

const STEPS = [
  { id: "1", status: "Applied", date: "2026-10-01" },
  { id: "2", status: "Interview", date: "2026-10-08" },
  { id: "3", status: "Offer", date: "2026-10-20" }
];

// Renders the date box for a step, anchored to a button on the page
function renderBox(index, props = {}) {
  const anchor = document.createElement("button");
  const onSave = vi.fn();
  const onClose = vi.fn();

  document.body.append(anchor);
  render(<StepDateBox anchor={anchor} steps={STEPS} index={index} today="2026-11-11" onSave={onSave} onClose={onClose} {...props} />);

  return { onSave, onClose, input: screen.getByLabelText(`${STEPS[index].status} date`) };
}

describe("StepDateBox", () => {
  it("starts on the step's date, kept between the steps on either side, with Save off", () => {
    const { input } = renderBox(1);

    expect(screen.getByRole("dialog", { name: "Change the Interview date" })).toBeInTheDocument();
    expect(input).toHaveValue("2026-10-08");
    expect(input).toHaveAttribute("min", "2026-10-01");
    expect(input).toHaveAttribute("max", "2026-10-20");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(input).toHaveFocus();
  });

  it("marks a date outside the bounds and keeps Save off", () => {
    const { input } = renderBox(1);

    fireEvent.change(input, { target: { value: "2026-10-25" } });

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves a new date with Save or Enter", () => {
    const { input, onSave } = renderBox(2);

    fireEvent.change(input, { target: { value: "2026-11-11" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSave).toHaveBeenCalledWith("2026-11-11");
  });

  it("closes on Escape or a click outside", () => {
    const { onClose } = renderBox(0);

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it.each(["scroll", "resize"])("closes when the window fires %s", (type) => {
    const { onClose } = renderBox(0);

    fireEvent(window, new Event(type));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
