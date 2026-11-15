import { describe, expect, it } from "vitest";
import {
  FIRST_EDGE,
  MAX_STRIPS,
  clip,
  clipTo,
  easeInOut,
  easeOut,
  edgeX,
  foldShapes,
  outlineOf,
  polygon,
  restAmount,
  slashedAt,
  smooth,
  topIndex
} from "../foldGeometry";

const ZONE = { w: 212, h: 64, slant: 18, strip: 6, ear: 25, count: 3 };
const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];

// Reads the points of a CSS polygon as numbers
function pointsOf(css) {
  return css.slice("polygon(".length, -1).split(", ").map((pair) => pair.split(" ").map((value) => parseFloat(value)));
}

describe("clip", () => {
  it("keeps the side of a polygon where the function is zero or more, adding the crossing points", () => {
    expect(clip(SQUARE, ([x]) => 5 - x)).toEqual([[0, 0], [5, 0], [5, 10], [0, 10]]);
  });

  it("keeps everything or nothing when the line misses the polygon", () => {
    expect(clip(SQUARE, () => 1)).toEqual(SQUARE);
    expect(clip(SQUARE, () => -1)).toEqual([]);
  });
});

describe("clipTo", () => {
  it("keeps the overlap with a convex outline", () => {
    const inner = [[5, 5], [20, 5], [20, 20], [5, 20]];

    const corners = [...new Set(clipTo(inner, SQUARE).map((point) => point.join(",")))].sort();

    expect(corners).toEqual(["10,10", "10,5", "5,10", "5,5"]);
  });
});

describe("polygon", () => {
  it("writes points as a CSS polygon in pixels", () => {
    expect(polygon([[0, 0], [1.25, 0], [1, 2]])).toBe("polygon(0.0px 0.0px, 1.3px 0.0px, 1.0px 2.0px)");
  });

  it("writes an empty polygon for fewer than three points", () => {
    expect(polygon([[0, 0], [1, 1]])).toBe("polygon(0 0, 0 0, 0 0)");
  });
});

describe("smooth", () => {
  it.each([[0, 0], [0.5, 0.5], [1, 1]])("maps %s to %s", (t, expected) => {
    expect(smooth(t)).toBe(expected);
  });
});

describe("easeInOut", () => {
  it.each([[0, 0], [0.5, 0.5], [1, 1]])("maps %s to %s", (t, expected) => {
    expect(easeInOut(t)).toBe(expected);
  });
});

describe("easeOut", () => {
  it.each([[0, 0], [0.5, Math.SQRT1_2], [1, 1]])("maps %s to %s", (t, expected) => {
    expect(easeOut(t)).toBeCloseTo(expected, 10);
  });
});

describe("edgeX", () => {
  it("moves each fold's edge one strip right, up to the last strip", () => {
    expect(edgeX(ZONE, 0)).toBe(FIRST_EDGE);
    expect(edgeX(ZONE, 2)).toBe(FIRST_EDGE + 12);
    expect(edgeX(ZONE, MAX_STRIPS + 3)).toBe(FIRST_EDGE + MAX_STRIPS * 6);
  });
});

describe("slashedAt", () => {
  it("slants the left edge by the zone's slant", () => {
    expect(slashedAt(ZONE, 4)).toEqual([[22, 0], [212, 0], [212, 64], [4, 64]]);
  });
});

describe("outlineOf", () => {
  it("fills the area for the current page and slashes earlier ones, older further left", () => {
    expect(outlineOf(ZONE, 2)).toEqual([[0, 0], [212, 0], [212, 64], [0, 64]]);
    expect(outlineOf(ZONE, 1)).toEqual(slashedAt(ZONE, 4));
    expect(outlineOf(ZONE, 0)).toEqual(slashedAt(ZONE, 10));
  });
});

describe("foldShapes", () => {
  it("leaves the front whole and shrinks the flap to the corner when not folded", () => {
    const shapes = foldShapes(ZONE, 2, 0);

    expect(pointsOf(shapes.front)).toEqual([[0, 0], [212, 0], [212, 64], [0, 64]]);
    expect(new Set(pointsOf(shapes.flap).map((point) => point.join(",")))).toEqual(new Set(["212,64"]));
    expect(shapes.vars["--a"]).toBe("315deg");
  });

  it("cuts a 45° corner off the front for a dog-ear", () => {
    const front = pointsOf(foldShapes(ZONE, 2, 0.15).front);

    expect(front.length).toBe(5);
    expect(front.every(([x, y]) => x <= 212 && y <= 64)).toBe(true);
  });

  it("leaves only the narrow slash in front of the panel beneath when fully folded", () => {
    const front = pointsOf(foldShapes(ZONE, 2, 1).front);
    const widest = Math.max(...front.map(([x]) => x));

    expect(widest).toBeCloseTo(FIRST_EDGE + ZONE.slant, 0);
    expect(foldShapes(ZONE, 2, 1).vars["--a"]).toBe(`${270 + (Math.atan2(18, 64) * 180) / Math.PI}deg`);
  });
});

describe("topIndex", () => {
  it("returns the newest page that isn't folded back", () => {
    expect(topIndex([false, false, false])).toBe(2);
    expect(topIndex([false, false, true])).toBe(1);
    expect(topIndex([false, true, true])).toBe(0);
  });
});

describe("restAmount", () => {
  it("shows a folded corner on the top page when a page lies beneath", () => {
    expect(restAmount(ZONE, 2, [false, false, false])).toBeCloseTo(25 / (212 - FIRST_EDGE));
  });

  it("lies flat on the first page and pages under the top one, and stays folded when turned", () => {
    expect(restAmount(ZONE, 0, [false, true, true])).toBe(0);
    expect(restAmount(ZONE, 1, [false, false, false])).toBe(0);
    expect(restAmount(ZONE, 2, [false, false, true])).toBe(1);
  });
});
