const SIZE = 16;
const INSET = 2;
const MIN_ALPHA = 200;
const MIN_SOLID = 0.6;
const MIN_CLOSE = 0.8;
const MAX_SPREAD = 24;
const NEAR_WHITE = 235;

// Returns the typical color of a ring inside the image's border, or null when it is mostly see-through, white or mixed
export function colorFromEdges(pixels, size = SIZE) {
  const last = size - 1 - INSET;
  const ring = [];

  for (let y = INSET; y <= last; y++) {
    for (let x = INSET; x <= last; x++) {
      if (x === INSET || y === INSET || x === last || y === last) {
        const at = (y * size + x) * 4;

        ring.push(Array.from(pixels.slice(at, at + 4)));
      }
    }
  }

  const solid = ring.filter(([, , , alpha]) => alpha >= MIN_ALPHA);

  if (solid.length < ring.length * MIN_SOLID) {
    return null;
  }

  const median = [0, 1, 2].map((index) => solid.map((color) => color[index]).sort((a, b) => a - b)[Math.floor(solid.length / 2)]);
  const close = solid.filter((color) => median.every((value, index) => Math.abs(color[index] - value) <= MAX_SPREAD));

  if (close.length < solid.length * MIN_CLOSE || Math.min(...median) >= NEAR_WHITE) {
    return null;
  }

  return `rgb(${median.join(", ")})`;
}

// Reads the edge color of a loaded image, or null when it can't be read
export function edgeColor(image) {
  try {
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

    if (!context) {
      return null;
    }

    context.canvas.width = SIZE;
    context.canvas.height = SIZE;
    context.drawImage(image, 0, 0, SIZE, SIZE);

    return colorFromEdges(context.getImageData(0, 0, SIZE, SIZE).data);
  } catch {
    return null;
  }
}
