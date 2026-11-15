import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDismiss } from "../useDismiss";

// Adds an element to the page and returns a ref to it
function placed() {
  const element = document.createElement("div");

  document.body.append(element);

  return { current: element };
}

describe("useDismiss", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("closes on a click outside, but not on one inside", () => {
    const close = vi.fn();
    const ref = placed();

    renderHook(() => useDismiss(true, close, ref));
    fireEvent.pointerDown(ref.current);
    const afterInside = close.mock.calls.length;
    fireEvent.pointerDown(document.body);

    expect(afterInside).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("counts a click in any of several elements as inside, such as a menu drawn elsewhere on the page", () => {
    const close = vi.fn();
    const trigger = placed();
    const list = placed();

    renderHook(() => useDismiss(true, close, [trigger, list]));
    fireEvent.pointerDown(trigger.current);
    fireEvent.pointerDown(list.current);

    expect(close).not.toHaveBeenCalled();
  });

  it("closes on Escape and stops it there", () => {
    const close = vi.fn();
    const outer = vi.fn();

    document.addEventListener("keydown", outer);
    renderHook(() => useDismiss(true, close, placed()));
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", outer);

    expect(close).toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });

  it("does nothing while closed", () => {
    const close = vi.fn();

    renderHook(() => useDismiss(false, close, placed()));
    fireEvent.pointerDown(document.body);

    expect(close).not.toHaveBeenCalled();
  });
});
