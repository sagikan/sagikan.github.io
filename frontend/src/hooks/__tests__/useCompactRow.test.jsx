import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompactRow } from "../useCompactRow";

const LABEL_WIDTH = 100;
const BUTTON_WIDTH = 40;
const OTHER_WIDTH = 200;
const FULL_WIDTH = BUTTON_WIDTH + LABEL_WIDTH + OTHER_WIDTH;

// A row with a button whose label drops when the row is compact, as display: none would
function Row({ room, layoutKey = "", extra = false }) {
  const ref = useRef(null);
  const compact = useCompactRow(ref, layoutKey);

  return (
    <div ref={ref} data-room={room} data-testid="row" data-compact={compact}>
      <button type="button" data-w={compact ? BUTTON_WIDTH : BUTTON_WIDTH + LABEL_WIDTH}>
        {!compact && <span data-drop-label data-w={LABEL_WIDTH}>Download PDF</span>}
      </button>
      <button type="button" data-w={OTHER_WIDTH}>Other</button>
      {extra && <button type="button" data-w={OTHER_WIDTH}>Extra</button>}
    </div>
  );
}

// Lays the elements out by their data attributes, since jsdom doesn't lay anything out
function fakeLayout() {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function widthOf() {
    return Number(this.dataset.w || 0);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function roomOf() {
    return Number(this.dataset.room || 0);
  });
}

// Tells whether the row has dropped its labels
function isCompact() {
  return screen.getByTestId("row").dataset.compact === "true";
}

describe("useCompactRow", () => {
  let resized;

  beforeEach(() => {
    resized = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback) {
        resized.push(callback);
      }

      observe() {}

      disconnect() {}
    });
    fakeLayout();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Redraws the row with new room and tells the hook it resized
  function resizeTo(view, room) {
    view.rerender(<Row room={room} />);
    act(() => resized.forEach((callback) => callback()));
  }

  it("keeps the labels when the row fits on one line", () => {
    render(<Row room={FULL_WIDTH + 50} />);

    expect(isCompact()).toBe(false);
  });

  it("drops the labels when the buttons wouldn't fit on one line", () => {
    render(<Row room={FULL_WIDTH - 1} />);

    expect(isCompact()).toBe(true);
  });

  it("brings the labels back once there's room for them again", () => {
    const view = render(<Row room={FULL_WIDTH - 1} />);

    resizeTo(view, FULL_WIDTH + 50);

    expect(isCompact()).toBe(false);
  });

  it("stays compact while the room is only enough without the labels, so it doesn't flicker", () => {
    const view = render(<Row room={FULL_WIDTH - 1} />);

    resizeTo(view, FULL_WIDTH - 20);
    resizeTo(view, FULL_WIDTH);

    expect(isCompact()).toBe(true);
  });

  it("checks again when the layout key says buttons came or went", () => {
    const view = render(<Row room={FULL_WIDTH + 50} />);

    view.rerender(<Row room={FULL_WIDTH + 50} extra layoutKey="with extra" />);

    expect(isCompact()).toBe(true);
  });
});
