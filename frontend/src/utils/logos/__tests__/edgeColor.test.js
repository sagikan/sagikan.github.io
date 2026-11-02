import { describe, expect, it } from "vitest";
import { colorFromEdges } from "../edgeColor";

const SIZE = 8;
const BLUE = [30, 60, 200, 255];

// Builds pixels of one color, with an optional override per pixel index
function pixelsOf(color, overrides = {}) {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);

  for (let index = 0; index < SIZE * SIZE; index++) {
    pixels.set(overrides[index] || color, index * 4);
  }

  return pixels;
}

// Lists the pixel indexes of the row at the given y
function rowIndexes(y) {
  return Array.from({ length: SIZE }, (_, x) => y * SIZE + x);
}

describe("colorFromEdges", () => {
  it("returns the shared color of the ring inside the border", () => {
    expect(colorFromEdges(pixelsOf(BLUE), SIZE)).toBe("rgb(30, 60, 200)");
  });

  it("ignores a lighter rim on the outermost pixels", () => {
    const rim = Object.fromEntries([...rowIndexes(0), ...rowIndexes(7)].map((index) => [index, [200, 205, 215, 255]]));

    expect(colorFromEdges(pixelsOf(BLUE, rim), SIZE)).toBe("rgb(30, 60, 200)");
  });

  it("returns null when the edges are see-through", () => {
    expect(colorFromEdges(pixelsOf([30, 60, 200, 0]), SIZE)).toBeNull();
  });

  it("returns null when the edges are white", () => {
    expect(colorFromEdges(pixelsOf([255, 255, 255, 255]), SIZE)).toBeNull();
  });

  it("returns null when the edges are mixed colors", () => {
    const half = Object.fromEntries(Array.from({ length: SIZE * 4 }, (_, index) => [index, [250, 20, 20, 255]]));

    expect(colorFromEdges(pixelsOf(BLUE, half), SIZE)).toBeNull();
  });
});
