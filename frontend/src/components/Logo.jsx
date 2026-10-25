import { useLayoutEffect, useRef, useState } from "react";

const ZERO = [
  ".#####.",
  "#######",
  "##...##",
  "##..###",
  "##.####",
  "####.##",
  "###..##",
  "##...##",
  "#######",
  ".#####."
];
const DIGITS = {
  0: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"]
};
const MIN_SNAP_ROW = 1.2;

function pixelsOf(grid) {
  return grid.flatMap((row, y) => [...row].map((cell, x) => (cell === "#" ? [x, y] : null)).filter(Boolean));
}

function useSnapToPixels(enabled, rows) {
  const ref = useRef(null);
  const [snap, setSnap] = useState(enabled);

  useLayoutEffect(() => {
    if (!enabled) return undefined;

    const check = () => {
      const height = ref.current?.getBoundingClientRect().height || 0;
      setSnap((height * window.devicePixelRatio) / rows >= MIN_SNAP_ROW);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [enabled, rows]);

  return [ref, enabled && snap];
}

function PixelGrid({ grid, color = "currentColor", gap = 0, crisp = false, height, className, style }) {
  const width = grid[0].length;
  const rows = grid.length;
  const pixels = pixelsOf(grid);
  const size = height ? { height, width: `calc(${height} * ${width} / ${rows})` } : null;
  const [ref, snap] = useSnapToPixels(crisp, rows);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${width} ${rows}`}
      aria-hidden="true"
      className={className}
      style={{ ...size, ...style }}
      fill={color}
      shapeRendering={snap ? "crispEdges" : undefined}
    >
      {gap > 0 ? (
        pixels.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x + gap / 2} y={y + gap / 2} width={1 - gap} height={1 - gap} rx="0.14" />
        ))
      ) : (
        <path d={pixels.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("")} />
      )}
    </svg>
  );
}

export function PixelZero(props) {
  return <PixelGrid grid={ZERO} {...props} />;
}

export function PixelDigit({ digit, ...props }) {
  return <PixelGrid grid={DIGITS[digit]} {...props} />;
}

function Logo({ size = 28 }) {
  return <PixelZero className="logo" gap={0.15} height={`${size}px`} />;
}

export default Logo;
