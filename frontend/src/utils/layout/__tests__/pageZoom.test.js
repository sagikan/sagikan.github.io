import { afterEach, describe, expect, it, vi } from "vitest";
import { measureWindow, popupPlace, unzoomedRect } from "../pageZoom";

// Builds an element that measures as the given rectangle
function measured(rect) {
  const element = document.createElement("div");

  element.getBoundingClientRect = () => rect;

  return element;
}

// Builds a popup of the given size
function popup(width, height) {
  const element = document.createElement("div");

  vi.spyOn(element, "offsetWidth", "get").mockReturnValue(width);
  vi.spyOn(element, "offsetHeight", "get").mockReturnValue(height);

  return element;
}

/* Makes the window measure as the given size in the page's own lengths, with rectangles reported at a scale: the
   zoom in browsers that report screen pixels, 1 in those that report the page's lengths */
function windowOf(width, height, scale = 1) {
  // Tells whether an element is the hidden one measuring the window
  const isProbe = (element) => element.dataset.windowProbe !== undefined;
  const ownWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth").get;
  const ownHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight").get;
  const rect = Element.prototype.getBoundingClientRect;

  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function probeWidth() {
    return isProbe(this) ? width : ownWidth.call(this);
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function probeHeight() {
    return isProbe(this) ? height : ownHeight.call(this);
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function probeRect() {
    return isProbe(this) ? { width: width * scale, height: height * scale } : rect.call(this);
  });
}

describe("measureWindow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives the window's size in the page's own lengths and the scale rectangles come back in", () => {
    windowOf(1200, 666, 1.35);

    const view = measureWindow();

    expect(view).toMatchObject({ width: 1200, height: 666 });
    expect(view.scale).toBeCloseTo(1.35);
  });

  it("uses a scale of 1 when the window can't be measured, and leaves nothing behind on the page", () => {
    const view = measureWindow();

    expect(view.scale).toBe(1);
    expect(document.querySelector("[data-window-probe]")).toBeNull();
  });
});

describe("unzoomedRect", () => {
  it("divides a measured rectangle by the scale", () => {
    expect(unzoomedRect(measured({ top: 20, right: 300, bottom: 60, left: 100, width: 200 }), 2)).toEqual({ top: 10, right: 150, bottom: 30, left: 50, width: 100 });
  });
});

describe("popupPlace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens under the anchor, the gap below it, with the right edges lined up", () => {
    const list = popup(150, 200);

    windowOf(1000, 800);

    expect(popupPlace(measured({ top: 100, right: 600, bottom: 130, left: 500, width: 100 }), list, 12)).toEqual({ top: 142, left: 450, above: false });
  });

  it("opens above the anchor when there's no room below but there is above", () => {
    const list = popup(150, 200);

    windowOf(1000, 800);

    expect(popupPlace(measured({ top: 700, right: 600, bottom: 730, left: 500, width: 100 }), list, 12)).toEqual({ top: 488, left: 450, above: true });
  });

  it("stays under the anchor when there's no room either way, and keeps inside the window's sides", () => {
    const list = popup(300, 400);

    windowOf(400, 300);

    expect(popupPlace(measured({ top: 100, right: 120, bottom: 130, left: 20, width: 100 }), list, 4)).toEqual({ top: 134, left: 8, above: false });
  });

  it.each([
    ["screen pixels", 1.35, { top: 945, right: 810, bottom: 985.5, left: 675, width: 135 }],
    ["the page's own lengths", 1, { top: 700, right: 600, bottom: 730, left: 500, width: 100 }]
  ])("opens above a low anchor whether the browser reports rectangles in %s", (_title, scale, anchorRect) => {
    const list = popup(150, 200);

    windowOf(1000, 800, scale);

    expect(popupPlace(measured(anchorRect), list, 12)).toEqual({ top: 488, left: 450, above: true });
  });
});
