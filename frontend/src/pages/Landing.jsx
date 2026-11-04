import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import CompanyAvatar from "../components/ui/CompanyAvatar";
import { PixelDigit, PixelZero } from "../components/layout/Logo";
import { PulseChart, WorkMix } from "../components/applications/StatCharts";
import FitMeta from "../components/applications/FitMeta";
import ChipRow from "../components/ui/ChipRow";
import { FreshnessCalendar, PinIcon } from "../components/jobs/JobIcons";
import { postingAge, scoreLevel } from "../components/jobs/jobInfo";
import { localISO } from "../lib/api";

const REDUCED_MOTION = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const CHECK = (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
    <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const REFRESH = (
  <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
    <path d="M16 10a6 6 0 1 1-1.76-4.24M16 4v3.5h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ARROW_UP = (
  <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
    <path d="M10 15V5M5.5 9.5L10 5l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ARROW_DOWN = (
  <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
    <path d="M10 5v10M5.5 10.5L10 15l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const APPLICATIONS = [
  { company: "Northwind", position: "Frontend Engineer", status: "Interview", location: "Tel Aviv", workplace: "Hybrid" },
  { company: "Globex", position: "Full-stack Developer", status: "Applied", location: "Remote", workplace: "Remote" },
  { company: "Initech", position: "Software Engineer II", status: "Offer", location: "Haifa", workplace: "On-site" },
  { company: "Umbrella", position: "React Developer", status: "Rejected", location: "Remote", workplace: "Remote" }
];
const STATUS_FILTERS = ["All", "Applied", "Interview", "Offer", "Rejected"];
const PIPELINE = STATUS_FILTERS.slice(1);
// Applications per day over the last month, oldest first: bursts and quiet days, a few reaching green
const PULSE_DAILY = [1, 0, 3, 1, 0, 5, 2, 0, 1, 7, 4, 1, 0, 2, 9, 3, 1, 0, 4, 12, 6, 2, 1, 5, 8, 3, 0, 6, 13, 7];
const MIX_SAMPLE = APPLICATIONS.map((item) => ({ workplace_model: item.workplace }));
const PULSE_SAMPLE = PULSE_DAILY.flatMap((count, index) => {
  const day = new Date();
  day.setDate(day.getDate() - (PULSE_DAILY.length - 1 - index));

  return Array.from({ length: count }, () => ({ created_at: day.toISOString() }));
});
const JOBS = [
  { company: "Northwind", position: "Backend Engineer", location: "Tel Aviv", workplace: "Hybrid", score: 86, days: 1, have: ["Node.js", "REST APIs"], missing: ["Kubernetes"] },
  { company: "Initech", position: "Software Engineer", location: "Haifa", workplace: "On-site", score: 58, days: 21, have: ["Python"], missing: ["Go", "AWS"] }
];
const NEW_JOB = { company: "Hooli", position: "Platform Engineer", location: "Tel Aviv", workplace: "Hybrid", score: 91, days: 0, have: ["Docker", "TypeScript"], missing: ["Terraform"], fresh: true };
const PROJECTS = {
  email: (
    <>
      <p className="preview-doc-title">
        <span className="preview-doc-moved" title="Moved up">{ARROW_UP}</span>
        Email Service <small>| Node.js, MongoDB</small>
      </p>
      <ul className="preview-doc-bullets">
        <li>Built a JWT-secured REST API with search and pagination</li>
        <li className="preview-doc-cut">Designed the inbox UI across web and Android</li>
      </ul>
    </>
  ),
  weather: (
    <>
      <p className="preview-doc-title">
        <span className="preview-doc-moved" title="Moved down">{ARROW_DOWN}</span>
        Weather Bot <small>| Python</small>
      </p>
      <ul className="preview-doc-bullets">
        <li>Built a Telegram bot that sends personalized daily forecasts</li>
      </ul>
    </>
  )
};
const ORIGINAL_HOLD_MS = 2200;
const TAILORED_HOLD_MS = 4800;
const ORDER_BEFORE = ["weather", "email"];
const ORDER_AFTER = ["email", "weather"];
const FEATURE_TABS = [
  { id: "story-track", label: "Applications" },
  { id: "story-find", label: "Job Posts" },
  { id: "story-tailor", label: "Tailored Resumes" }
];

// Reports once the element scrolls into view
function useInView(ref, threshold = 0.2) {
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (inView || !ref.current) return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold, rootMargin: "0px 0px -8% 0px" });

    observer.observe(ref.current);

    return () => observer.disconnect();
  }, [inView, ref, threshold]);

  return inView;
}

// Counts up to a number when shown
function CountUp({ value, run }) {
  const [shown, setShown] = useState(REDUCED_MOTION ? value : 0);

  useEffect(() => {
    if (!run || REDUCED_MOTION) return undefined;

    const start = performance.now();
    let frame;

    // Moves the count forward each frame
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / 900);
      setShown(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [run, value]);

  return shown;
}

// Preview window title bar
function WindowBar({ step }) {
  return (
    <div className="preview-bar">
      {[1, 2, 3].map((dot) => <span key={dot} className={dot === step ? "is-on" : undefined} />)}
    </div>
  );
}

// Renders an application card in the preview
function applicationRow(item) {
  return (
    <li key={item.company} className={`app-card status-${item.status.toLowerCase()} preview-pop`}>
      <CompanyAvatar company={item.company} logo={false} />
      <div className="app-main">
        <div className="app-title"><h3>{item.position}</h3></div>
        <FitMeta>
          <span className="app-company">{item.company}</span>
          {item.workplace !== "Remote" && (
            <span className="app-meta-item app-location-item"><PinIcon /><span className="app-location">{item.location}</span></span>
          )}
          <span className={`app-tag workplace-tag mix-${item.workplace.toLowerCase()}`} title={item.workplace}>{item.workplace}</span>
        </FitMeta>
      </div>
      <span className="status-select preview-status" aria-hidden="true">{item.status}</span>
    </li>
  );
}

// Stacks a faded copy behind the preview
function Stack({ ghost, children }) {
  return (
    <div className="preview-stack">
      <div className="preview-ghost" aria-hidden="true">{ghost}</div>
      {children}
    </div>
  );
}

// Applications page preview
function ApplicationsPreview({ active }) {
  const [filter, setFilter] = useState("All");
  const shown = APPLICATIONS.filter((item) => filter === "All" || item.status === filter);
  const total = APPLICATIONS.length;

  // Counts preview applications with a status
  const count = (status) => APPLICATIONS.filter((item) => item.status === status).length;

  const inProgress = count("Applied") + count("Interview");

  return (
    <div className="preview-window showcase-window">
      <WindowBar step={1} />
      <div className="preview-stats">
        <div className="stat-card">
          <span className="stat-label">Total</span>
          <strong className="stat-value"><CountUp value={total} run={active} /></strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">In Progress</span>
          <strong className="stat-value"><CountUp value={inProgress} run={active} /></strong>
        </div>
        <div className="stat-card preview-pulse">
          <PulseChart applications={PULSE_SAMPLE} bare />
        </div>
        <WorkMix applications={MIX_SAMPLE} />
      </div>
      <div className="pipeline preview-pipeline" aria-hidden="true">
        {PIPELINE.map((status) => (
          <span key={status} className={`pipeline-segment seg-${status.toLowerCase()}`} style={{ flexGrow: count(status) }} />
        ))}
      </div>
      <ChipRow
        role="group"
        aria-label="Filter the example applications"
        items={STATUS_FILTERS.map((status) => {
          const number = status === "All" ? total : count(status);

          return {
            key: status,
            active: filter === status,
            onSelect: () => setFilter(status),
            menuLabel: <>{status}<span className="chip-count">{number}</span></>,
            node: (
              <button
                key={status}
                type="button"
                className={`chip${filter === status ? " active" : ""}`}
                aria-pressed={filter === status}
                onClick={() => setFilter(status)}
              >
                {status}
                <span className="chip-count">{number}</span>
              </button>
            )
          };
        })}
      />
      <Stack ghost={<ul className="app-list">{APPLICATIONS.map(applicationRow)}</ul>}>
        <ul className="app-list">{shown.map(applicationRow)}</ul>
      </Stack>
    </div>
  );
}

// Returns the date a number of days ago
function daysAgoISO(days) {
  return localISO(new Date(Date.now() - days * 86_400_000));
}

// Formats a date as a short month and day
function shortDate(day) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Renders a job card in the preview
function jobRow(job, active) {
  const level = scoreLevel(job.score);
  const postedAt = daysAgoISO(job.days);
  const age = postingAge(postedAt).level;

  return (
    <li key={job.company} className={`job-card match-${level} preview-pop${job.fresh ? " is-new" : ""}`}>
      <div className="job-card-top">
        {job.fresh && <span className="job-new-tag">New!</span>}
        <CompanyAvatar company={job.company} logo={false} />
        <div className="job-heading">
          <h3 className="job-title">{job.position}</h3>
          <FitMeta as="p" className="job-meta">
            <span className="job-company">{job.company}</span>
            {job.workplace !== "Remote" && (
              <span className="app-meta-item job-location"><PinIcon /><span className="job-location-text">{job.location}</span></span>
            )}
            <span className={`app-tag workplace-tag mix-${job.workplace.toLowerCase()}`} title={job.workplace}>{job.workplace}</span>
            <span className={`app-meta-item app-date-item posted-${age}`}><FreshnessCalendar level={age} />{shortDate(postedAt)}</span>
          </FitMeta>
        </div>
        <div className="job-card-side">
          <span className={`score-ring preview-ring match-${level}`} style={{ "--score": active ? job.score : 0 }}>
            <span>{job.score}</span>
          </span>
        </div>
      </div>
      <div className="preview-job-foot">
        <ul className="job-skills">
          {job.have.map((skill) => <li key={skill} className="skill skill-have">{skill}</li>)}
          {job.missing.map((skill) => <li key={skill} className="skill skill-missing">{skill}</li>)}
        </ul>
        <div className="job-actions" aria-hidden="true">
          <span className="btn btn-primary btn-sm">Tailor resume</span>
        </div>
      </div>
    </li>
  );
}

// Jobs page preview
function JobsPreview({ active }) {
  const [jobs, setJobs] = useState(JOBS);
  const [syncing, setSyncing] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Plays the sync animation
  function sync() {
    if (syncing) return;
    setSyncing(true);
    timer.current = setTimeout(() => {
      setSyncing(false);
      setJobs((current) => (current.includes(NEW_JOB) ? current : [NEW_JOB, ...current]));
    }, 1100);
  }

  return (
    <div className="preview-window showcase-window">
      <WindowBar step={2} />
      <div className="jobs-section-head preview-section-head">
        <div className="jobs-section-title">
          <div className="day-toggle">
            <span>Found</span>
            <span className="day-count">{jobs.length}</span>
            <span className="day-line section-line">
              {["high", "mid", "low"].map((level) => {
                const value = jobs.filter((job) => scoreLevel(job.score) === level).length;

                return value > 0 && <span key={level} className={`pipeline-segment match-seg-${level}`} style={{ flexGrow: value }} />;
              })}
            </span>
          </div>
        </div>
        <div className="btn-group">
          <button
            type="button"
            className={`sync-btn${syncing ? " is-running" : ""}`}
            aria-label={syncing ? "Searching for new jobs" : "Search for new jobs"}
            onClick={sync}
          >
            {REFRESH}
          </button>
        </div>
      </div>
      <Stack ghost={<ul className="job-list">{[NEW_JOB, ...JOBS].map((job) => jobRow(job, false))}</ul>}>
        <ul className="job-list">
          {jobs.map((job) => jobRow(job, active))}
        </ul>
      </Stack>
    </div>
  );
}

// Animates rows sliding to their new places when the order changes
function useGlide(order, delay) {
  const nodes = useRef({});
  const tops = useRef({});
  const orderKey = order.join();

  useLayoutEffect(() => {
    const moved = [];

    orderKey.split(",").forEach((key) => {
      const node = nodes.current[key];
      if (!node) return;
      const before = tops.current[key];
      const now = node.offsetTop;
      tops.current[key] = now;
      if (before !== undefined && before !== now && !REDUCED_MOTION) moved.push([node, before - now]);
    });

    if (moved.length === 0) return undefined;

    moved.forEach(([node, by]) => {
      node.style.transition = "none";
      node.style.transform = `translateY(${by}px)`;
    });
    moved[0][0].getBoundingClientRect();

    const frame = requestAnimationFrame(() => {
      moved.forEach(([node]) => {
        node.style.transition = `transform 0.8s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`;
        node.style.transform = "";
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [orderKey, delay]);

  return (key) => (node) => {
    nodes.current[key] = node;
  };
}

// Preview resume body
function DocBody({ tailored, order = tailored ? ORDER_AFTER : ORDER_BEFORE, delay = 0 }) {
  const glide = useGlide(order, delay);

  return (
    <div className={`preview-doc-body${tailored ? " show-changes" : ""}`}>
      <p className="preview-doc-heading">Summary</p>
      <div className="preview-doc-summary">
        <p className="preview-doc-text is-before" aria-hidden={tailored}>
          CS graduate with hands-on experience building end-to-end web apps in Node.js and Python.
        </p>
        <p className="preview-doc-text is-after" aria-hidden={!tailored}>
          CS graduate with hands-on experience building end-to-end <del>web apps</del>{" "}
          <ins>scalable backend services and REST APIs</ins> in Node.js and Python.
        </p>
      </div>

      <p className="preview-doc-heading">Projects</p>
      {order.map((key) => (
        <div key={key} ref={glide(key)} className="preview-doc-project">
          {PROJECTS[key]}
        </div>
      ))}

      <p className="preview-doc-heading">Skills</p>
      <div className="preview-doc-skills">
        <span>Node.js</span><span>Python</span><span>PostgreSQL</span>
        <span className="preview-doc-skill-new">+ Docker</span>
      </div>
    </div>
  );
}

// Tailored resume preview that flips between the original and the tailored resume on its own
function TailorPreview({ active }) {
  const [tailored, setTailored] = useState(REDUCED_MOTION);
  const [paused, setPaused] = useState(false);

  // Flips between the two versions while the preview is on screen and not being looked at closely
  useEffect(() => {
    if (!active || paused || REDUCED_MOTION) {
      return undefined;
    }

    const flip = setTimeout(() => setTailored((value) => !value), tailored ? TAILORED_HOLD_MS : ORIGINAL_HOLD_MS);

    return () => clearTimeout(flip);
  }, [active, paused, tailored]);

  return (
    <div
      className="preview-window showcase-window preview-doc"
      onPointerEnter={(event) => event.pointerType === "mouse" && setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <WindowBar step={3} />

      <Stack ghost={<DocBody tailored />}>
        <DocBody tailored={tailored} />
      </Stack>
    </div>
  );
}

// Checklist point
function Point({ children }) {
  return (
    <li>
      <span className="showcase-check" aria-hidden="true">{CHECK}</span>
      <span>{children}</span>
    </li>
  );
}

// Feature section with its points and preview
function Story({ id, flip = false, title, points, link, preview }) {
  const ref = useRef(null);
  const inView = useInView(ref);

  return (
    <section
      id={id}
      ref={ref}
      className={`showcase-row${flip ? " showcase-row-flip" : ""} reveal${inView ? " is-visible" : ""}`}
    >
      <div className="showcase-copy">
        <h2>{title}</h2>
        <ul className="showcase-points">
          {points.map((point) => <Point key={point}>{point}</Point>)}
        </ul>
        {link && (
          <a href={link.href} className="showcase-link">
            {link.label}
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M4 10h12m-5-5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        )}
      </div>
      <div className="showcase-preview">{preview(inView)}</div>
    </section>
  );
}

// Fades content in when it scrolls into view
function Reveal({ className = "", children }) {
  const ref = useRef(null);
  const inView = useInView(ref, 0.15);

  return <div ref={ref} className={`${className} reveal${inView ? " is-visible" : ""}`}>{children}</div>;
}

// Scrolls to a feature section
function scrollToStory(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" });
}

/* Checks whether any tab label is too wide for its tab
   Tabs share the bar equally, so their width (and this check) doesn't change when labels hide */
function labelsOverflow(tabs, labels) {
  return FEATURE_TABS.some(({ id }) => {
    const tab = tabs[id];
    const label = labels[id];
    if (!tab || !label) return false;

    const style = getComputedStyle(tab);
    const number = tab.querySelector(".feature-tab-num")?.offsetWidth || 0;
    const room = tab.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - number - parseFloat(style.columnGap);

    return label.scrollWidth > room;
  });
}

// Sticky tabs that follow and jump between feature sections
function FeatureTabs() {
  const [active, setActive] = useState(null);
  const [pill, setPill] = useState(null);
  const [compact, setCompact] = useState(false);
  const dock = useRef(null);
  const bar = useRef(null);
  const labels = useRef({});
  const tabs = useRef({});
  const heading = useRef(null);
  const release = useRef(null);

  // Stops following a tab click's scroll
  const stopHeading = useCallback(() => {
    heading.current = null;
    clearTimeout(release.current);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (heading.current) {
          if (entry.isIntersecting && entry.target.id === heading.current) stopHeading();

          return;
        }

        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    const first = document.getElementById(FEATURE_TABS[0].id);
    let frame = 0;

    // Clears the active tab when scrolled above the features
    const checkAbove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!heading.current && first && first.getBoundingClientRect().top > window.innerHeight * 0.5) {
          setActive(null);
        }
      });
    };

    window.addEventListener("scroll", checkAbove, { passive: true });

    FEATURE_TABS.forEach(({ id }) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });

    // Hands control back to the user's scrolling
    const takeOver = () => stopHeading();

    const events = ["wheel", "touchstart", "keydown"];
    events.forEach((name) => window.addEventListener(name, takeOver, { passive: true }));

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", checkAbove);
      cancelAnimationFrame(frame);
      events.forEach((name) => window.removeEventListener(name, takeOver));
      clearTimeout(release.current);
    };
  }, [stopHeading]);

  // Moves the highlight under the active tab
  const place = useCallback(() => {
    const tab = active && tabs.current[active];
    setPill(tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : null);
  }, [active]);

  useLayoutEffect(place, [place]);

  useLayoutEffect(() => {
    // Hides the tab labels when they don't fit
    const fit = () => setCompact(labelsOverflow(tabs.current, labels.current));

    fit();
    document.fonts?.ready.then(fit);

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(bar.current);

    return () => observer.disconnect();
  }, []);

  // Tells the hero how much room the pinned tabs take, so they detach the moment the page scrolls
  useLayoutEffect(() => {
    const node = dock.current;
    const zone = node?.parentElement;
    if (!node || !zone || typeof ResizeObserver === "undefined") return undefined;

    const measure = () => {
      const style = getComputedStyle(node);
      const space = node.offsetHeight + parseFloat(style.marginTop);
      zone.style.setProperty("--dock-space", `${space}px`);
    };
    const observer = new ResizeObserver(measure);

    measure();
    observer.observe(node);

    return () => {
      observer.disconnect();
      zone.style.removeProperty("--dock-space");
    };
  }, []);

  useEffect(() => {
    window.addEventListener("resize", place);

    return () => window.removeEventListener("resize", place);
  }, [place]);

  return (
    <div ref={dock} className="feature-tabs-dock">
      <nav ref={bar} className={`feature-tabs hero-rise${compact ? " is-compact" : ""}`} aria-label="Features">
        <span
          className={`feature-tabs-pill${pill ? " is-shown" : ""}`}
          style={pill ? { transform: `translateX(${pill.left}px)`, width: pill.width } : undefined}
          aria-hidden="true"
        />
        {FEATURE_TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => { tabs.current[tab.id] = node; }}
            type="button"
            className="feature-tab"
            aria-current={active === tab.id ? "true" : undefined}
            title={compact ? tab.label : undefined}
            onClick={() => {
              setActive(tab.id);
              heading.current = tab.id;
              clearTimeout(release.current);
              release.current = setTimeout(stopHeading, 1500);
              scrollToStory(tab.id);
            }}
          >
            <span className="feature-tab-num" aria-hidden="true">
              <PixelDigit digit={index} crisp height="0.73em" />
            </span>
            {/* Visually hidden, not removed, so it can still be measured and read by screen readers */}
            <span ref={(node) => { labels.current[tab.id] = node; }} className={compact ? "visually-hidden" : undefined}>
              {tab.label}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/* Pixel zero that stands in for the letter "o"
   Gradient text has no color of its own, so `start` gives the gradient's mix (% of its start color) at
   that spot. The hidden "o" keeps the word whole for screen readers and copy-paste */
function O({ start }) {
  const color = start === undefined
    ? undefined
    : `color-mix(in srgb, var(--gradient-start) ${start}%, var(--gradient-end))`;

  return (
    <span className="pixel-o">
      <PixelZero color={color} />
      <span className="visually-hidden">o</span>
    </span>
  );
}

// Landing page
function Landing({ authenticated }) {
  const ctaHref = authenticated ? "#/applications" : "#/signup";

  return (
    <main className="landing">
      {/* The hero is inside the zone so the sticky tabs can also rest at the screen's bottom */}
      <div className="feature-zone">
        <section className="hero">
          <h1 className="hero-rise">
            {/* Words with a pixel zero are kept whole, or the line could break inside them */}
            Keep track <span className="nowrap"><O />f</span> <i>every</i> <span className="nowrap">applicati<O />n</span>{" "}
            <span className="gradient-text">
              until <span className="nowrap">y<O start={75} />u</span> get the <span className="nowrap"><O start={30} />ffer.</span>
            </span>
          </h1>
          <div className="hero-actions hero-rise">
            <a href={ctaHref} className="btn btn-glass btn-lg">
              {authenticated ? "My Applications" : "Start Now"}
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path d="M4 10h12m-5-5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            {authenticated ? (
              <a href="#/jobs" className="btn btn-ghost btn-lg">Browse Job Posts</a>
            ) : (
              <a href="#/login" className="btn btn-ghost btn-lg">I already have an account</a>
            )}
          </div>
          <p className="lede hero-rise">
            Everything you need to land your next role, in one place and with total control.
          </p>
        </section>

        <FeatureTabs />

        <div className="showcase">
          <Story
            id="story-track"
            title={<><span className="title-mark">Every</span> application, <span className="title-mark">one</span> place</>}
            points={[
              "See where your search stands with advanced stats",
              "Filter your applications and search across everything",
              "Track the resume you sent with each application"
            ]}
            link={{ href: "#/applications", label: "Track Applications" }}
            preview={(inView) => <ApplicationsPreview active={inView} />}
          />

          <Story
            id="story-find"
            flip
            title={<>Openings picked <span className="title-mark">for you</span></>}
            points={[
              "Automated search across the most popular job boards",
              "AI-powered, profile-based score and analysis for each post",
              "Add any job you found yourself"
            ]}
            link={{ href: "#/jobs", label: "Browse Job Posts" }}
            preview={(inView) => <JobsPreview active={inView} />}
          />

          <Story
            id="story-tailor"
            title={<>Resume tailored <span className="title-mark">for each</span> opening</>}
            points={[
              "Observe changes: rewording, reordering, additions, removals",
              "Attach any additional PDF document (e.g. Gradesheet)",
              "Download the final ATS-approved PDF version"
            ]}
            preview={(inView) => <TailorPreview active={inView} />}
          />
        </div>
      </div>

      <Reveal className="cta-band">
        <h2>Ready to take control of your search?</h2>
        <p>
          {authenticated
            ? "Find your next job posts and tailor your resume to them."
            : "Create a free account, upload your resume and get your first matches in minutes."}
        </p>
        <a href={authenticated ? "#/jobs" : ctaHref} className="btn btn-glass btn-lg">
          {authenticated ? "Browse Job Posts" : "Sign Up"}
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M4 10h12m-5-5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </Reveal>
    </main>
  );
}

export default Landing;
