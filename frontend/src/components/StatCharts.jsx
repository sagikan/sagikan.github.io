import { Fragment, useMemo, useState } from "react";
import { WORKPLACE_MODELS, jobDay, localISO } from "../api";

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
  [0xef, 0x64, 0x61], // coral, none
  [0xf0, 0xb4, 0x29], // gold, halfway
  [0x4a, 0xc2, 0x6b] // fresh green, the most
];
const GRADIENT_STOPS = [0, 0.5, 1];
const PULSE_FILL_OPACITY = 0.3;
const FILL_STOPS = [0, 0.25, 0.5, 0.75, 1];
const TIP_EDGE = 0.15;
const MIX_MIN_SHARE = 5;
const MIX_GAP = 1.6;

function pulseColor(fraction, alpha = 1) {
  const position = Math.min(Math.max(fraction, 0), 1) * (PULSE_COLORS.length - 1);
  const from = Math.min(Math.floor(position), PULSE_COLORS.length - 2);
  const mix = position - from;

  return `rgb(${PULSE_COLORS[from].map((channel, i) => Math.round(channel + (PULSE_COLORS[from + 1][i] - channel) * mix)).join(" ")} / ${alpha})`;
}

function leadFill(fraction, y) {
  const strength = PULSE_FILL_OPACITY * (1 - y / PULSE_BASELINE);
  const stops = FILL_STOPS.map((stop) => `${pulseColor(fraction * (1 - stop), strength * (1 - stop))} ${stop * 100}%`);

  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

const shortDate = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

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

export function PulseChart({ applications }) {
  const [rangeKey, setRangeKey] = useState("month");
  const range = PULSE_RANGES.find(({ key }) => key === rangeKey);

  const { points, line, total, greenY } = useMemo(() => {
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
    const line = [[0, first.y], ...points.map(({ x, y }) => [x, y]), [PULSE_WIDTH, last.y]];

    return {
      points,
      greenY: PULSE_BASELINE - (range.greenAt / most) * (PULSE_BASELINE - PULSE_TOP),
      line: line.map((point) => point.join(",")).join(" "),
      total: perPoint.reduce((sum, { count }) => sum + count, 0)
    };
  }, [applications, range]);

  return (
    <div className="stat-card stat-card-wide">
      <span className="stat-label">
        Pulse
        <span className="info">
          <button type="button" className="info-button" aria-label="About this graph" aria-describedby="pulse-help">?</button>
          <span id="pulse-help" role="tooltip" className="info-tip">
            How many applications you sent over time?
          </span>
        </span>
      </span>
      <div className="range-tabs" role="group" aria-label="Pulse time range">
        {PULSE_RANGES.map(({ key, label }) => (
          <button key={key} type="button" aria-pressed={key === rangeKey} onClick={() => setRangeKey(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="pulse-wrap">
        <svg
          className="pulse"
          viewBox={`0 0 ${PULSE_WIDTH} ${PULSE_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Applications per ${range.bucket === 1 ? "day" : "week"} over the last ${range.days} days, ${total} in total`}
        >
          <defs>
            <linearGradient id="pulse-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={PULSE_BASELINE}>
              <stop offset="0" stopColor="#fff" stopOpacity={PULSE_FILL_OPACITY} />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="pulse-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={PULSE_WIDTH} height={PULSE_HEIGHT}>
              <rect width={PULSE_WIDTH} height={PULSE_HEIGHT} fill="url(#pulse-fade)" />
            </mask>
            <linearGradient id="pulse-gradient" gradientUnits="userSpaceOnUse" x1="0" y1={PULSE_BASELINE} x2="0" y2={greenY}>
              {GRADIENT_STOPS.map((stop) => (
                <stop key={stop} offset={stop} stopColor={pulseColor(stop)} />
              ))}
            </linearGradient>
          </defs>
          <polygon className="pulse-area" points={`${line} ${PULSE_WIDTH},${PULSE_BASELINE} 0,${PULSE_BASELINE}`} mask="url(#pulse-mask)" />
          <polyline points={line} />
        </svg>

        {[
          ["start", points[0]],
          ["end", points[points.length - 1]]
        ].map(([side, { y, count }]) => (
          <Fragment key={side}>
            <span
              className={`pulse-fill pulse-fill-${side}`}
              style={{
                top: `${(y / PULSE_HEIGHT) * 100}%`,
                height: `${((PULSE_BASELINE - y) / PULSE_HEIGHT) * 100}%`,
                background: leadFill(count / range.greenAt, y)
              }}
              aria-hidden="true"
            />
            <span
              className={`pulse-lead pulse-lead-${side}`}
              style={{ top: `${(y / PULSE_HEIGHT) * 100}%`, "--lead": pulseColor(count / range.greenAt) }}
              aria-hidden="true"
            />
          </Fragment>
        ))}

        {points
          .filter(({ count }) => count > 0)
          .map(({ x, y, count, label }) => {
            const side = x < PULSE_WIDTH * TIP_EDGE ? " tip-left" : x > PULSE_WIDTH * (1 - TIP_EDGE) ? " tip-right" : "";
            const text = `${label} · ${count} ${count === 1 ? "app" : "apps"}`;

            return (
              <span
                key={label}
                className={`pulse-point${side}`}
                style={{
                  left: `${(x / PULSE_WIDTH) * 100}%`,
                  top: `${(y / PULSE_HEIGHT) * 100}%`,
                  "--point": pulseColor(count / range.greenAt)
                }}
                tabIndex={0}
                role="img"
                aria-label={text}
              >
                <span className="pulse-tip" aria-hidden="true">{text}</span>
              </span>
            );
          })}
      </div>
    </div>
  );
}

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
    <div className="stat-card stat-card-wide">
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
