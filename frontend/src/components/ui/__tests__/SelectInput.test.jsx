import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SelectInput from "../SelectInput";

const OPTIONS = [
  { value: "Applied", label: "Applied", disabled: true },
  { value: "Interview", label: "Interview" },
  { value: "again:Interview", label: "Another interview", repeat: true },
  { value: "undo", label: "Undo Interview", action: "undo" }
];

// Renders the select with its trigger labelled "Status"
function renderSelect(props = {}) {
  const onChange = vi.fn();

  render(<SelectInput value="Interview" onChange={onChange} options={OPTIONS} aria-label="Status" {...props} />);

  return { onChange, trigger: screen.getByRole("combobox", { name: "Status" }) };
}

describe("SelectInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("picks an option and passes its value and the option itself", () => {
    const { onChange, trigger } = renderSelect();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Another interview" }));

    expect(onChange).toHaveBeenCalledWith("again:Interview", OPTIONS[2]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("greys out a disabled option and never picks it, by click or keyboard", () => {
    const { onChange, trigger } = renderSelect({ value: "Applied" });

    fireEvent.click(trigger);
    const option = screen.getByRole("option", { name: "Applied" });
    fireEvent.click(option);
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(option).toHaveClass("is-disabled");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sets an action apart from the options", () => {
    const { trigger } = renderSelect();

    fireEvent.click(trigger);

    expect(screen.getByRole("option", { name: "Undo Interview" })).toHaveClass("dropdown-action");
  });

  it("sizes the trigger by the options only, leaving out repeats and actions", () => {
    const { trigger } = renderSelect({ fitWidest: true });

    expect([...trigger.querySelectorAll(".select-sizer")].map((sizer) => sizer.textContent)).toEqual(["Applied", "Interview"]);
  });

  it("draws a floating list on the page body under the trigger, in a 1000 by 800 window, and closes it on scroll", () => {
    const { trigger } = renderSelect({ floating: true });

    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function windowWidth() {
      return this.dataset.windowProbe === undefined ? 0 : 1000;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function windowHeight() {
      return this.dataset.windowProbe === undefined ? 0 : 800;
    });

    trigger.getBoundingClientRect = () => ({ top: 10, right: 300, bottom: 40, left: 200, width: 100 });
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox");
    const parent = list.parentElement;
    fireEvent.scroll(window);

    expect(parent).toBe(document.body);
    expect(list).toHaveClass("dropdown-list-floating");
    expect(list).toHaveStyle({ top: "44px", left: "300px", minWidth: "100px" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
