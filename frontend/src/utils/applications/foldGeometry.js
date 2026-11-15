import { MAX_STEPS } from "./applicationMachines";

// Where the first slanted edge meets the bottom of the status area, in pixels from its left
export const FIRST_EDGE = 4;
// The most strips the status area shows; deeper folds share the last one
export const MAX_STRIPS = MAX_STEPS - 2;
// How far the back of a folding page is held short of lying flat, as if lifted
const LIFT = 0.93;

/* Fold geometry for a card's status area, a stack of pages from the oldest step (0) to the current one. A zone
   describes the area: { w, h, slant, strip, ear, count }, with the width and height in pixels, the slanted edge's
   horizontal offset, the width each fold leaves, the folded corner's size and the number of pages */

// Keeps the part of a polygon where a linear function is zero or more
export function clip(points, side) {
  const out = [];

  points.forEach((point, i) => {
    const prev = points[(i + points.length - 1) % points.length];
    const a = side(prev);
    const b = side(point);

    if ((a >= 0) !== (b >= 0)) {
      const t = a / (a - b);

      out.push([prev[0] + (point[0] - prev[0]) * t, prev[1] + (point[1] - prev[1]) * t]);
    }

    if (b >= 0) {
      out.push(point);
    }
  });

  return out;
}

// Keeps the part of a polygon inside a convex outline listed clockwise
export function clipTo(points, outline) {
  let out = points;

  outline.forEach(([ax, ay], i) => {
    const [bx, by] = outline[(i + 1) % outline.length];

    out = clip(out, ([x, y]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax));
  });

  return out;
}

// Turns a list of points into a CSS polygon, or an empty one
export function polygon(points) {
  if (points.length < 3) {
    return "polygon(0 0, 0 0, 0 0)";
  }

  return `polygon(${points.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ")})`;
}

// Returns a smooth 0 to 1 curve
export function smooth(t) {
  return t * t * (3 - 2 * t);
}

// Returns where a slanted edge meets the bottom, counting folds from the top; each sits one strip right of the last
export function edgeX(zone, j) {
  return FIRST_EDGE + Math.min(j, MAX_STRIPS) * zone.strip;
}

// Returns a slashed panel's outline, as on the email review cards
export function slashedAt(zone, x) {
  return [[x + zone.slant, 0], [zone.w, 0], [zone.w, zone.h], [x, zone.h]];
}

// Returns a page's outline: the current page fills the area, earlier pages are slashed panels
export function outlineOf(zone, i) {
  if (i === zone.count - 1) {
    return [[0, 0], [zone.w, 0], [zone.w, zone.h], [0, zone.h]];
  }

  return slashedAt(zone, edgeX(zone, zone.count - 2 - i));
}

/* Returns the shapes of a page folded back from its bottom-right corner by an amount from 0 to 1. It starts as a 45°
   dog-ear; as it grows, the crease swings to the slant of the panel beneath and at 1 lies on that panel's slanted
   edge. What stays of the page left of the crease is the narrow slash; the part past the crease leaves the front, and
   its mirror image, held a little short as if lifted, is the back of the page, which tucks under the panel's edge.
   Gives the clip-path of the front, the crease shade and the flap, and the CSS variables of their gradients */
export function foldShapes(zone, i, q) {
  const { w, h } = zone;
  const edge = edgeX(zone, zone.count - 1 - i);
  const endDegrees = (Math.atan2(zone.slant, h) * 180) / Math.PI;
  const degrees = 45 + (endDegrees - 45) * smooth(q);
  const angle = (degrees * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const travel = q * dx * (w - edge);
  const k = dx * w + dy * h - travel;
  // Returns how far a point lies past the crease, negative on the side that stays
  const past = ([x, y]) => dx * x + dy * y - k;
  const shape = outlineOf(zone, i);
  const beneath = i > 0 ? outlineOf(zone, i - 1) : slashedAt(zone, edge);
  const folded = clip(shape, past);
  const span = w * dx + h * dy;
  const crease = travel / span;
  const flap = folded.map(([x, y]) => {
    const push = 2 * past([x, y]) * LIFT;

    return [x - push * dx, y - push * dy];
  });

  return {
    vars: {
      "--a": `${270 + degrees}deg`,
      "--c": `${(crease * 100).toFixed(2)}%`,
      "--cs": `${((crease - 18 / span) * 100).toFixed(2)}%`,
      "--cf": `${((crease + 60 / span) * 100).toFixed(2)}%`
    },
    front: polygon(clip(shape, (point) => -past(point))),
    shade: polygon(clipTo(folded, beneath)),
    flap: polygon(clipTo(flap, beneath))
  };
}

// Returns the index of the page on top: the newest page that isn't folded back
export function topIndex(turned) {
  for (let i = turned.length - 1; i >= 0; i--) {
    if (!turned[i]) {
      return i;
    }
  }

  return 0;
}

// Returns how far a page rests: the top page shows a folded corner when there's a page beneath, others lie flat or fully folded
export function restAmount(zone, i, turned) {
  if (turned[i]) {
    return 1;
  }

  const shows = i === topIndex(turned) && i > 0;

  return shows ? zone.ear / (zone.w - edgeX(zone, zone.count - 1 - i)) : 0;
}

// Returns an eased amount for a moment of an animation, from 0 to 1 (ease in and out)
export function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

// Returns an eased amount that moves at once, without a jump, and slows gently into place, for folds that answer a pick
export function easeOut(t) {
  return Math.sin((t * Math.PI) / 2);
}
