import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FitMeta from "../FitMeta";

describe("FitMeta", () => {
  // jsdom doesn't lay text out: text ranges measure nothing, and every measurement is counted
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}

      disconnect() {}
    });
    Range.prototype.getBoundingClientRect = vi.fn(() => ({ width: 0 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete Range.prototype.getBoundingClientRect;
  });

  it("fits the row at the first step when nothing is cut off", () => {
    const { container } = render(<FitMeta><span className="app-company">Acme</span></FitMeta>);

    expect(container.querySelector(".app-meta")).toHaveAttribute("data-fit", "0");
  });

  it("measures again when the text changes, but not when the row re-renders with the same text", () => {
    const { rerender } = render(<FitMeta><span className="app-company">Acme</span></FitMeta>);
    const afterFirst = Range.prototype.getBoundingClientRect.mock.calls.length;

    rerender(<FitMeta><span className="app-company">Acme</span></FitMeta>);
    const afterSame = Range.prototype.getBoundingClientRect.mock.calls.length;
    rerender(<FitMeta><span className="app-company">Globex</span></FitMeta>);

    expect(afterSame).toBe(afterFirst);
    expect(Range.prototype.getBoundingClientRect.mock.calls.length).toBeGreaterThan(afterSame);
  });
});
