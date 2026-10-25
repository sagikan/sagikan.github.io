import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import CompanyAvatar from "../components/CompanyAvatar";
import { PixelDigit, PixelZero } from "../components/Logo";
import { PulseChart } from "../components/StatCharts";
import StatusBadge from "../components/StatusBadge";

const REDUCED_MOTION = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const CHECK = (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
    <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CROSS = (
  <svg viewBox="0 0 20 20" width="11" height="11" aria-hidden="true">
    <path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
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
const DOWNLOAD = (
  <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
    <path d="M10 3.5v9M6 8.75l4 4 4-4M4 15.5h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const APPLICATIONS = [
  { company: "Northwind", position: "Frontend Engineer", status: "Interview", date: "Oct 12" },
  { company: "Globex", position: "Full-stack Developer", status: "Applied", date: "Oct 9" },
  { company: "Initech", position: "Software Engineer II", status: "Offer", date: "Sep 28" },
  { company: "Hooli", position: "Backend Engineer", status: "Interview", date: "Sep 24" },
  { company: "Umbrella", position: "React Developer", status: "Rejected", date: "Sep 20" },
  { company: "Stark", position: "Platform Engineer", status: "Applied", date: "Sep 18" }
];
const STATUS_FILTERS = ["All", "Applied", "Interview", "Offer", "Rejected"];
const PULSE_SAMPLE = Array.from({ length: 364 }, (_, daysAgo) => {
  const daily = Math.sin(daysAgo * 1.9) * 1.6 + Math.sin(daysAgo * 0.77 + 1) * 1.1;
  const waves = Math.sin(daysAgo / 17) * 0.9;
  const recent = Math.max(0, 1 - daysAgo / 120);
  const count = Math.max(0, Math.round(3 + daily + waves + recent * 2.5));
  const day = new Date();
  day.setDate(day.getDate() - daysAgo);
  return Array.from({ length: count }, () => ({ created_at: day.toISOString() }));
}).flat();
const JOBS = [
  { company: "Northwind", position: "Backend Engineer", place: "Tel Aviv · Hybrid", score: 86, days: 1, have: ["Node.js", "REST APIs"], missing: ["Kubernetes"] },
  { company: "Globex", position: "Full-stack Developer", place: "Remote", score: 72, days: 5, have: ["React", "PostgreSQL"], missing: ["GraphQL"] },
  { company: "Initech", position: "Software Engineer", place: "Haifa · On-site", score: 58, days: 21, have: ["Python"], missing: ["Go", "AWS"] }
];
const NEW_JOB = { company: "Hooli", position: "Platform Engineer", place: "Tel Aviv · Hybrid", score: 91, days: 0, have: ["Docker", "TypeScript"], missing: ["Terraform"], fresh: true };
const DATE_FILTERS = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today", days: 0 },
  { key: "week", label: "Last Week", days: 7 }
];
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
const ORDER_BEFORE = ["weather", "email"];
const ORDER_AFTER = ["email", "weather"];
const SCISSORS = (
  <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
    <path d="M7.1 13.1 14.75 3.25M12.9 13.1 5.25 3.25M5.5 17a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5zM14.5 17a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const UNDO = (
  <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
    <path d="M4.5 9.5a5.75 5.75 0 1 1 1.7 4.1M4.5 4.75V9.5h4.75" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const DONE = (
  <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
    <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const FEATURE_TABS = [
  { id: "story-track", label: "Applications" },
  { id: "story-find", label: "Job Posts" },
  { id: "story-tailor", label: "Tailored Resumes" }
];

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

function CountUp({ value, run }) {
  const [shown, setShown] = useState(REDUCED_MOTION ? value : 0);

  useEffect(() => {
    if (!run || REDUCED_MOTION) return undefined;

    const start = performance.now();
    let frame;
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

function WindowBar({ step, children }) {
  return (
    <div className="preview-bar">
      {[1, 2, 3].map((dot) => <span key={dot} className={dot === step ? "is-on" : undefined} />)}
      {children && <div className="preview-bar-tools">{children}</div>}
    </div>
  );
}

function applicationRow(item) {
  return (
    <li key={item.company} className="preview-pop">
      <CompanyAvatar company={item.company} />
      <span className="preview-text">
        <strong>{item.company}</strong>
        <small>{item.position}</small>
      </span>
      <StatusBadge status={item.status} />
      <small className="preview-date">{item.date}</small>
    </li>
  );
}

function Stack({ ghost, children }) {
  return (
    <div className="preview-stack">
      <div className="preview-ghost" aria-hidden="true">{ghost}</div>
      {children}
    </div>
  );
}

function ApplicationsPreview({ active }) {
  const [filter, setFilter] = useState("All");
  const shown = APPLICATIONS.filter((item) => filter === "All" || item.status === filter);
  const count = (status) => APPLICATIONS.filter((item) => item.status === status).length;

  return (
    <div className="preview-window showcase-window">
      <WindowBar step={1} />
      <div className="preview-stats">
        <div><strong><CountUp value={APPLICATIONS.length} run={active} /></strong><small>Total</small></div>
        <div><strong><CountUp value={count("Interview")} run={active} /></strong><small>Interviews</small></div>
        <div><strong><CountUp value={count("Offer")} run={active} /></strong><small>Offers</small></div>
        <div className="preview-pulse">
          <PulseChart applications={PULSE_SAMPLE} bare />
        </div>
      </div>
      <div className="preview-chips" role="group" aria-label="Filter the example applications">
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            className={`preview-chip${filter === status ? " is-active" : ""}`}
            aria-pressed={filter === status}
            onClick={() => setFilter(status)}
          >
            {status}
            {status !== "All" && <span>{count(status)}</span>}
          </button>
        ))}
      </div>
      <Stack ghost={<ul className="preview-list">{APPLICATIONS.map(applicationRow)}</ul>}>
        <ul className="preview-list">{shown.map(applicationRow)}</ul>
      </Stack>
    </div>
  );
}

function ageClass(days) {
  return days <= 7 ? "posted-fresh" : days <= 30 ? "posted-aging" : "posted-stale";
}

function jobRow(job, active) {
  return (
    <li key={job.company} className={`preview-pop${job.fresh ? " is-new" : ""}`}>
      <div className="preview-job-top">
        <CompanyAvatar company={job.company} />
        <span className="preview-text">
          <strong>{job.position}</strong>
          <small>
            {job.company} · {job.place} ·{" "}
            <span className={`preview-age ${ageClass(job.days)}`}>
              <svg viewBox="0 0 20 20" width="11" height="11" aria-hidden="true">
                <rect x="3.5" y="4.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M3.5 8.5h13M7 2.75v3.5M13 2.75v3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              {job.days === 0 ? "Today" : `${job.days}d`}
            </span>
          </small>
        </span>
        <span
          className={`score-ring preview-ring match-${job.score >= 70 ? "high" : job.score >= 45 ? "mid" : "low"}`}
          style={{ "--score": active ? job.score : 0 }}
        >
          <span>{job.score}</span>
        </span>
      </div>
      <ul className="job-skills preview-skills">
        {job.have.map((skill) => <li key={skill} className="skill skill-have">{CHECK}{skill}</li>)}
        {job.missing.map((skill) => <li key={skill} className="skill skill-missing">{CROSS}{skill}</li>)}
      </ul>
    </li>
  );
}

function JobsPreview({ active }) {
  const [jobs, setJobs] = useState(JOBS);
  const [range, setRange] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  function sync() {
    if (syncing) return;
    setSyncing(true);
    timer.current = setTimeout(() => {
      setSyncing(false);
      setSynced(true);
      setJobs((current) => (current.includes(NEW_JOB) ? current : [NEW_JOB, ...current]));
    }, 1100);
  }

  const limit = DATE_FILTERS.find((option) => option.key === range).days;
  const shown = jobs.filter((job) => limit === undefined || job.days <= limit);

  return (
    <div className="preview-window showcase-window">
      <WindowBar step={2} />
      <div className="preview-section-head">
        <span>Found</span>
        <span className="preview-muted">{jobs.length}</span>
        <span className="preview-line" />
        <button type="button" className={`sync-btn${syncing ? " is-running" : ""}`} onClick={sync}>
          {REFRESH}
          {syncing ? "Searching…" : synced ? "Just now" : "5 min ago"}
        </button>
      </div>
      <div className="preview-chips" role="group" aria-label="Filter the example job posts by date">
        {DATE_FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`preview-chip${range === option.key ? " is-active" : ""}`}
            aria-pressed={range === option.key}
            onClick={() => setRange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <Stack ghost={<ul className="preview-jobs">{[NEW_JOB, ...JOBS].map((job) => jobRow(job, false))}</ul>}>
        <ul className="preview-jobs">
          {shown.map((job) => jobRow(job, active))}
          {shown.length === 0 && <li className="preview-empty">No posts from today yet. Try refreshing.</li>}
        </ul>
      </Stack>
    </div>
  );
}

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
        node.style.transition = `transform 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) ${delay}ms`;
        node.style.transform = "";
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [orderKey, delay]);

  return (key) => (node) => {
    nodes.current[key] = node;
  };
}

function DocBody({ tailored, order = tailored ? ORDER_AFTER : ORDER_BEFORE, delay = 0 }) {
  const glide = useGlide(order, delay);

  return (
    <div className={`preview-doc-body${tailored ? " show-changes" : ""}`}>
      <p className="preview-doc-heading">Summary</p>
      <p className="preview-doc-text">
        CS graduate with hands-on experience building <del>web apps</del>
        <ins>scalable backend services and REST APIs</ins> in Node.js and Python.
      </p>

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

function TailorPreview() {
  const [tailored, setTailored] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="preview-window showcase-window preview-doc">
      <WindowBar step={3}>
        <button
          type="button"
          className="preview-tailor"
          aria-pressed={tailored}
          aria-label={tailored ? "Undo tailoring" : "Tailor the resume"}
          onClick={() => setTailored((value) => !value)}
        >
          <span className="preview-tailor-face is-tailor">{SCISSORS}Tailor</span>
          <span className="preview-tailor-face is-undo">{UNDO}Undo</span>
        </button>
      </WindowBar>

      <Stack ghost={<DocBody tailored />}>
        <DocBody tailored={tailored} />
      </Stack>

      <div className="preview-doc-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm preview-doc-download"
          onClick={() => {
            setDownloaded(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setDownloaded(false), 1600);
          }}
        >
          {downloaded ? DONE : DOWNLOAD}
          {downloaded ? "Downloaded" : "Resume.pdf"}
        </button>
      </div>
    </div>
  );
}

function Point({ children }) {
  return (
    <li>
      <span className="showcase-check" aria-hidden="true">{CHECK}</span>
      <span>{children}</span>
    </li>
  );
}

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

function Reveal({ className = "", children }) {
  const ref = useRef(null);
  const inView = useInView(ref, 0.15);
  return <div ref={ref} className={`${className} reveal${inView ? " is-visible" : ""}`}>{children}</div>;
}

function scrollToStory(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
}

// Tabs share the bar equally, so their width (and this check) doesn't change when labels hide.
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

function FeatureTabs() {
  const [active, setActive] = useState(null);
  const [pill, setPill] = useState(null);
  const [compact, setCompact] = useState(false);
  const bar = useRef(null);
  const labels = useRef({});
  const tabs = useRef({});
  const heading = useRef(null);
  const release = useRef(null);

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

  const place = useCallback(() => {
    const tab = active && tabs.current[active];
    setPill(tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : null);
  }, [active]);

  useLayoutEffect(place, [place]);

  useLayoutEffect(() => {
    const fit = () => setCompact(labelsOverflow(tabs.current, labels.current));
    fit();
    document.fonts?.ready.then(fit);

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(bar.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [place]);

  return (
    <div className="feature-tabs-dock">
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
            {/* Visually hidden, not removed, so it can still be measured and read by screen readers. */}
            <span ref={(node) => { labels.current[tab.id] = node; }} className={compact ? "visually-hidden" : undefined}>
              {tab.label}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// Gradient text has no color of its own, so `accent` gives the gradient's mix (% of --accent) at
// that spot. The hidden "o" keeps the word whole for screen readers and copy-paste.
function O({ accent }) {
  const color = accent === undefined
    ? undefined
    : `color-mix(in srgb, var(--accent) ${accent}%, var(--accent-2))`;
  return (
    <span className="pixel-o">
      <PixelZero color={color} />
      <span className="visually-hidden">o</span>
    </span>
  );
}

function Landing({ authenticated }) {
  const ctaHref = authenticated ? "#/applications" : "#/signup";

  return (
    <main className="landing">
      {/* The hero is inside the zone so the sticky tabs can also rest at the screen's bottom. */}
      <div className="feature-zone">
        <section className="hero">
          <h1 className="hero-rise">
            {/* Words with a pixel zero are kept whole, or the line could break inside them. */}
            Keep track <span className="nowrap"><O />f</span> <i>every</i> <span className="nowrap">applicati<O />n</span>{" "}
            <span className="gradient-text">
              until <span className="nowrap">y<O accent={75} />u</span> get the <span className="nowrap"><O accent={30} />ffer.</span>
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
            title="Every application, one place"
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
            title="Openings picked for you"
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
            title="Resume tailored for each opening"
            points={[
              "Observe changes: rewording, reordering, additions, removals",
              "Attach any additional PDF document (e.g. Gradesheet)",
              "Download the final ATS-approved PDF version"
            ]}
            preview={() => <TailorPreview />}
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
        <a href={authenticated ? "#/jobs" : ctaHref} className="btn btn-light btn-lg">
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
