import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { WORKPLACE_MODELS, jobDay, localISO } from "../../lib/api";
import PillGroup from "../ui/PillGroup";

const PULSE_RANGES = [
  { key: "week", label: "Week", days: 7, bucket: 1, greenAt: 12 },
  { key: "month", label: "Month", days: 30, bucket: 1, greenAt: 12 },
  { key: "year", label: "Year", days: 364, bucket: 7, greenAt: 48 }
];
const PULSE_WIDTH = 300;
const PULSE_HEIGHT = 56;
const PULSE_BASELINE = 50;
const PULSE_TOP = 4;
const PULSE_COLORS = [
  [0xef, 0x64, 0x61],
  [0xf0, 0xb4, 0x29],
  [0x4a, 0xc2, 0x6b]
];
const GRADIENT_STOPS = [0, 0.5, 1];
const PULSE_PAD = 8;
const PULSE_SAMPLES = 150;
const PULSE_XS = Array.from({ length: PULSE_SAMPLES + 1 }, (_, i) => (i / PULSE_SAMPLES) * PULSE_WIDTH);
const MIX_MIN_SHARE = 5;
const MIX_GAP = 1.6;
const PULSE_MORPH_MS = 450;
const TIP_EDGE = 0.15;

// Picks the pulse chart color for a point along the gradient
function pulseColor(fraction, alpha = 1) {
  const position = Math.min(Math.max(fraction, 0), 1) * (PULSE_COLORS.length - 1);
  const from = Math.min(Math.floor(position), PULSE_COLORS.length - 2);
  const mix = position - from;

  return `rgb(${PULSE_COLORS[from].map((channel, i) => Math.round(channel + (PULSE_COLORS[from + 1][i] - channel) * mix)).join(" ")} / ${alpha})`;
}

// Draws a smooth line through the points that never overshoots them
function smoothLine(xs, ys) {
  const last = xs.length - 1;
  const slopes = xs.slice(0, last).map((x, i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - x));
  const tangents = xs.map((_, i) => {
    if (i === 0 || i === last) {
      return 0;
    }

    return slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
  });

  // Keeps each tangent within the range that stops a bump past its neighbours
  slopes.forEach((slope, i) => {
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;

      return;
    }

    const a = tangents[i] / slope;
    const b = tangents[i + 1] / slope;
    const size = Math.hypot(a, b);

    if (size > 3) {
      tangents[i] = (3 * a * slope) / size;
      tangents[i + 1] = (3 * b * slope) / size;
    }
  });

  let segment = 0;

  return PULSE_XS.map((x) => {
    while (segment < last - 1 && x > xs[segment + 1]) {
      segment += 1;
    }

    const width = xs[segment + 1] - xs[segment];
    const t = (x - xs[segment]) / width;
    const t2 = t * t;
    const t3 = t2 * t;

    return (
      (2 * t3 - 3 * t2 + 1) * ys[segment] +
      (t3 - 2 * t2 + t) * width * tangents[segment] +
      (-2 * t3 + 3 * t2) * ys[segment + 1] +
      (t3 - t2) * width * tangents[segment + 1]
    );
  });
}

// Joins heights into the points of a line
const linePoints = (ys) => ys.map((y, i) => `${PULSE_XS[i]},${y}`).join(" ");

// Joins a drawing's line, with the fading run-ins at both ends, into the outline of the area under it
function areaPoints(ys) {
  const line = linePoints(ys);

  return `${-PULSE_PAD},${ys[0]} ${line} ${PULSE_WIDTH + PULSE_PAD},${ys[ys.length - 1]} ${PULSE_WIDTH + PULSE_PAD},${PULSE_BASELINE} ${-PULSE_PAD},${PULSE_BASELINE}`;
}

// Formats a date as a short month and day
const shortDate = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Groups applications into chart points by day or week
function pulsePoints(applications, { days, bucket }) {
  const perDay = new Map();

  applications.forEach((job) => {
    const day = jobDay(job);
    perDay.set(day, (perDay.get(day) || 0) + 1);
  });

  const today = new Date();
  const dates = Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - index));

    return date;
  });

  return Array.from({ length: days / bucket }, (_, index) => {
    const covered = dates.slice(index * bucket, (index + 1) * bucket);
    const first = covered[0];
    const last = covered[covered.length - 1];

    return {
      count: covered.reduce((sum, date) => sum + (perDay.get(localISO(date)) || 0), 0),
      label:
        bucket === 1
          ? first.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
          : `${shortDate(first)} – ${shortDate(last)}`
    };
  });
}

// Builds the drawing of one range: its smooth line, how far it reaches and what colors its ends take
function pulseShape(applications, range) {
  const perPoint = pulsePoints(applications, range);
  const most = Math.max(...perPoint.map(({ count }) => count), 1);
  const step = PULSE_WIDTH / perPoint.length;
  const points = perPoint.map(({ count, label }, index) => ({
    count,
    label,
    x: step * index + step / 2,
    y: PULSE_BASELINE - (count / most) * (PULSE_BASELINE - PULSE_TOP)
  }));
  const first = points[0];
  const last = points[points.length - 1];
  const ys = smoothLine([0, ...points.map(({ x }) => x), PULSE_WIDTH], [first.y, ...points.map(({ y }) => y), last.y]);

  return {
    range,
    points,
    ys,
    greenY: PULSE_BASELINE - (range.greenAt / most) * (PULSE_BASELINE - PULSE_TOP),
    total: perPoint.reduce((sum, { count }) => sum + count, 0)
  };
}

// Returns a function that gives the drawing part way between two drawings
function morph(from, to) {
  // Gives the value part way between two values
  const mix = (a, b, t) => a + (b - a) * t;

  return (t) => ({
    ys: from.ys.map((y, i) => mix(y, to.ys[i], t)),
    greenY: mix(from.greenY, to.greenY, t)
  });
}

/* Chart of applications over time
   Hovering a range button previews that range, and the line glides between ranges
   `bare`: picture only (no title, range buttons or hover guide), always the month view */
export function PulseChart({ applications, bare = false }) {
  const [rangeKey, setRangeKey] = useState("month");
  const [hoverKey, setHoverKey] = useState(null);
  const [cursor, setCursor] = useState(null);
  const shownKey = hoverKey ?? rangeKey;
  const shapes = useMemo(
    () => Object.fromEntries(PULSE_RANGES.map((range) => [range.key, pulseShape(applications, range)])),
    [applications]
  );
  const shown = shapes[shownKey];
  const settled = useRef({ source: shown, current: shown });
  const frame = useRef(0);
  const wrap = useRef(null);
  const lineNode = useRef(null);
  const areaNode = useRef(null);
  const gradientNode = useRef(null);
  const startRunIn = useRef(null);
  const endRunIn = useRef(null);
  const { total, range } = shapes[rangeKey];
  const line = linePoints(shown.ys);
  const point = cursor === null ? null : shown.points[Math.min(cursor, shown.points.length - 1)];
  const text = point && `${point.label} · ${point.count} ${point.count === 1 ? "app" : "apps"}`;
  const tipSide = point && (point.x < PULSE_WIDTH * TIP_EDGE ? " tip-left" : point.x > PULSE_WIDTH * (1 - TIP_EDGE) ? " tip-right" : "");

  /* The glide writes straight to the drawing instead of going through React, so each frame costs
     a few attribute changes rather than a re-render of the whole chart */
  useLayoutEffect(() => {
    if (settled.current.source === shown) {
      return undefined;
    }

    const from = settled.current.current;
    const blend = morph(from, shown);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();

    // Draws a drawing onto the chart
    const draw = (shape) => {
      const last = shape.ys.length - 1;

      lineNode.current.setAttribute("points", linePoints(shape.ys));
      areaNode.current.setAttribute("points", areaPoints(shape.ys));
      startRunIn.current.setAttribute("points", `0,${shape.ys[0]} ${-PULSE_PAD},${shape.ys[0]}`);
      endRunIn.current.setAttribute("points", `${PULSE_WIDTH},${shape.ys[last]} ${PULSE_WIDTH + PULSE_PAD},${shape.ys[last]}`);
      gradientNode.current.setAttribute("y2", shape.greenY);
    };

    // Draws one step of the glide
    const tick = (now) => {
      const progress = reduce ? 1 : Math.min((now - start) / PULSE_MORPH_MS, 1);

      if (progress < 1) {
        settled.current.current = blend(1 - (1 - progress) ** 4);
        draw(settled.current.current);
        frame.current = requestAnimationFrame(tick);
      } else {
        settled.current.current = shown;
        draw(shown);
        wrap.current.classList.remove("is-morphing");
      }
    };

    settled.current.source = shown;
    wrap.current.classList.add("is-morphing");
    draw(from);
    frame.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame.current);
  }, [shown]);

  // Moves the cursor along the points with the arrow keys
  function steer(event) {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];

    if (step) {
      event.preventDefault();
      setCursor((current) => Math.min(Math.max((current ?? shown.points.length) + step, 0), shown.points.length - 1));
    }
  }

  return (
    <div className={`stat-card stat-card-pulse${bare ? " is-bare" : ""}`}>
      {!bare && (
        <span className="stat-label">
          Pulse
          <span className="info">
            <button type="button" className="info-button" aria-label="About this graph" aria-describedby="pulse-help">?</button>
            <span id="pulse-help" role="tooltip" className="info-tip">
              How many applications have you sent over time?
            </span>
          </span>
        </span>
      )}
      {!bare && (
        <PillGroup
          className="range-tabs"
          aria-label="Pulse time range"
          options={PULSE_RANGES}
          value={rangeKey}
          onChange={setRangeKey}
          onHoverChange={setHoverKey}
        />
      )}
      <div
        className="pulse-wrap"
        ref={wrap}
        {...(bare ? {} : {
          tabIndex: 0,
          onPointerLeave: () => setCursor(null),
          onKeyDown: steer,
          onBlur: () => setCursor(null),
          role: "group",
          "aria-label": `Applications per ${range.bucket === 1 ? "day" : "week"}, use the arrow keys to read each one`
        })}
      >
        <svg
          className="pulse"
          viewBox={`${-PULSE_PAD} 0 ${PULSE_WIDTH + 2 * PULSE_PAD} ${PULSE_HEIGHT}`}
          preserveAspectRatio="none"
          style={{ left: `${(-PULSE_PAD / PULSE_WIDTH) * 100}%`, width: `${(1 + (2 * PULSE_PAD) / PULSE_WIDTH) * 100}%` }}
          role="img"
          aria-label={`Applications per ${range.bucket === 1 ? "day" : "week"} over the last ${range.days} days, ${total} in total`}
        >
          <defs>
            <linearGradient id="pulse-fade" x1="0" y1="0" x2="0" y2="1">
              <stop className="pulse-fade-top" offset="0" stopColor="#fff" />
              <stop className="pulse-fade-mid" offset="0.5" stopColor="#fff" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="pulse-mask" maskContentUnits="objectBoundingBox">
              <rect width="1" height="1" fill="url(#pulse-fade)" />
            </mask>
            <linearGradient id="pulse-edge-fade" gradientUnits="userSpaceOnUse" x1={-PULSE_PAD} y1="0" x2={PULSE_WIDTH + PULSE_PAD} y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
              <stop offset={PULSE_PAD / (PULSE_WIDTH + 2 * PULSE_PAD)} stopColor="#fff" />
              <stop offset={1 - PULSE_PAD / (PULSE_WIDTH + 2 * PULSE_PAD)} stopColor="#fff" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
            </linearGradient>
            <mask id="pulse-edge" maskUnits="userSpaceOnUse" x={-PULSE_PAD} y="-20" width={PULSE_WIDTH + 2 * PULSE_PAD} height={PULSE_HEIGHT + 40}>
              <rect x={-PULSE_PAD} y="-20" width={PULSE_WIDTH + 2 * PULSE_PAD} height={PULSE_HEIGHT + 40} fill="url(#pulse-edge-fade)" />
            </mask>
            <linearGradient id="pulse-gradient" ref={gradientNode} gradientUnits="userSpaceOnUse" x1="0" y1={PULSE_BASELINE} x2="0" y2={shown.greenY}>
              {GRADIENT_STOPS.map((stop) => (
                <stop key={stop} offset={stop} stopColor={pulseColor(stop)} />
              ))}
            </linearGradient>
          </defs>
          <g mask="url(#pulse-edge)">
            <polygon className="pulse-area" ref={areaNode} points={areaPoints(shown.ys)} mask="url(#pulse-mask)" />
            <polyline
              className="pulse-run-in"
              ref={startRunIn}
              points={`0,${shown.ys[0]} ${-PULSE_PAD},${shown.ys[0]}`}
            />
            <polyline
              className="pulse-run-in"
              ref={endRunIn}
              points={`${PULSE_WIDTH},${shown.ys[shown.ys.length - 1]} ${PULSE_WIDTH + PULSE_PAD},${shown.ys[shown.ys.length - 1]}`}
            />
          </g>
          <polyline ref={lineNode} points={line} />
        </svg>

        {!bare && (
          <div className="pulse-hit" aria-hidden="true">
            {shown.points.map(({ label }, index) => (
              <span key={label} onPointerEnter={() => setCursor(index)} />
            ))}
          </div>
        )}

        {point && (
          <div className="pulse-cursor" style={{ left: `${(point.x / PULSE_WIDTH) * 100}%` }} aria-hidden="true">
            <span className="pulse-guide" style={{ top: `${(PULSE_TOP / PULSE_HEIGHT) * 100}%`, height: `${((PULSE_BASELINE - PULSE_TOP) / PULSE_HEIGHT) * 100}%` }} />
            <span
              className="pulse-dot"
              style={{ top: `${(point.y / PULSE_HEIGHT) * 100}%`, "--point": pulseColor(point.count / shown.range.greenAt) }}
            />
            <span className={`pulse-tip${tipSide}`} style={{ top: `${(point.y / PULSE_HEIGHT) * 100}%` }}>{text}</span>
          </div>
        )}
        <span className="visually-hidden" aria-live="polite">{text}</span>
      </div>
    </div>
  );
}

// Shows how applications split between workplace models
export function WorkMix({ applications }) {
  const { models, slices } = useMemo(() => {
    const models = WORKPLACE_MODELS.map((model) => ({
      model,
      count: applications.filter((job) => job.workplace_model === model).length
    }));
    const used = models.filter(({ count }) => count > 0);
    const sum = used.reduce((acc, { count }) => acc + count, 0);
    const wanted = used.map(({ model, count }) => ({ model, share: Math.max((count / sum) * 100, MIX_MIN_SHARE) }));
    const wantedSum = wanted.reduce((acc, { share }) => acc + share, 0);
    const gap = used.length > 1 ? MIX_GAP : 0;
    const arcs = wanted.map(({ share }) => (share / wantedSum) * 100);
    const slices = wanted.map(({ model }, index) => ({
      model,
      length: arcs[index] - gap,
      offset: arcs.slice(0, index).reduce((acc, arc) => acc + arc, 0) + gap / 2
    }));

    return { models, slices };
  }, [applications]);

  return (
    <div className="stat-card stat-card-mix">
      <span className="stat-label">Model Mix</span>
      <div className="mix">
        <svg className="mix-ring" viewBox="0 0 36 36" role="img" aria-label="Share of on-site, hybrid and remote applications">
          <g transform="rotate(-90 18 18)" fill="none" strokeWidth="5">
            <circle className="mix-track" cx="18" cy="18" r="15" />
            {slices.map(({ model, length, offset }) => (
              <circle
                key={model}
                className={`mix-slice mix-${model.toLowerCase()}`}
                cx="18"
                cy="18"
                r="15"
                pathLength="100"
                strokeDasharray={`${length} ${100 - length}`}
                strokeDashoffset={-offset}
              />
            ))}
          </g>
        </svg>
        <ul className="mix-legend">
          {models.map(({ model, count }) => (
            <li key={model} className={`mix-${model.toLowerCase()}`}>
              <span className="mix-dot" aria-hidden="true" />
              {model}
              <strong>{count}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
