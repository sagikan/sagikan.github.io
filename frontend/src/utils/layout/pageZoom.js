/* The page is scaled with CSS zoom on <html> (the --zoom variable in index.css, a number or, on narrow screens, a
   calc() expression). Browsers report element rectangles either scaled by it (screen pixels) or not (the page's own
   lengths), and window sizes such as innerHeight are always in screen pixels. A fixed-position popup is placed in the
   page's own lengths, so everything is measured against one hidden element filling the window: its own size is the
   window in the page's lengths, and its rectangle over that size is the scale the browser reports rectangles in */

const EDGE_GAP = 8;

// Measures the window with a hidden element filling it: its size in the page's lengths and the rectangles' scale
export function measureWindow() {
  const probe = document.createElement("div");

  probe.dataset.windowProbe = "";
  probe.style.cssText = "position: fixed; inset: 0; visibility: hidden; pointer-events: none;";
  document.body.append(probe);

  const rect = probe.getBoundingClientRect();
  const width = probe.offsetWidth;
  const height = probe.offsetHeight;

  probe.remove();

  const scale = rect.width / width;

  return { width, height, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
}

// Returns an element's rectangle in the page's own lengths, for placing a fixed-position popup by it
export function unzoomedRect(element, scale = measureWindow().scale) {
  const rect = element.getBoundingClientRect();

  return { top: rect.top / scale, right: rect.right / scale, bottom: rect.bottom / scale, left: rect.left / scale, width: rect.width / scale };
}

/* Returns where a fixed-position popup goes, in the page's own lengths: under its anchor, gap below it, right edges
   lined up; above the anchor when it doesn't fit below but does above; and never past the sides of the window */
export function popupPlace(anchor, popup, gap) {
  const view = measureWindow();
  const rect = unzoomedRect(anchor, view.scale);
  const height = popup.offsetHeight;
  const width = popup.offsetWidth;
  const fitsBelow = rect.bottom + gap + height <= view.height - EDGE_GAP;
  const fitsAbove = rect.top - gap - height >= EDGE_GAP;
  const above = !fitsBelow && fitsAbove;
  const left = Math.min(Math.max(EDGE_GAP, rect.right - width), view.width - width - EDGE_GAP);

  return { top: above ? rect.top - gap - height : rect.bottom + gap, left, above };
}
