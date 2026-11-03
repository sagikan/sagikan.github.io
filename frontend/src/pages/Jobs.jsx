import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CompanyAvatar from "../components/ui/CompanyAvatar";
import AddJobModal from "../components/jobs/AddJobModal";
import ProfileModal from "../components/jobs/ProfileModal";
import TailorModal from "../components/jobs/TailorModal";
import JobDetails, { MatchSkills, PostedDate, ScoreRing } from "../components/jobs/JobDetails";
import { isFreshJob, postingAge, scoreLevel } from "../components/jobs/jobInfo";
import { CalendarIcon, ExternalIcon, FreshnessCalendar, PinIcon } from "../components/jobs/JobIcons";
import { apiRequest, localISO, toDateInput } from "../lib/api";
import { downloadSavedCv } from "../utils/resume/cvPdf";
import Alert from "../components/ui/Alert";
import FitMeta from "../components/applications/FitMeta";

const POLL_MS = 5000;
const DATE_RANGES = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today", days: 1 },
  { key: "week", label: "Last Week", days: 7 },
  { key: "month", label: "Last Month", days: 30 }
];
const openSections = {};

// Orders jobs the way the server lists them: unscored first, then best match, then newest
function byListOrder(a, b) {
  if (a.match_score !== b.match_score) {
    if (a.match_score === null) return -1;
    if (b.match_score === null) return 1;

    return b.match_score - a.match_score;
  }

  return new Date(b.created_at) - new Date(a.created_at);
}

// Describes how long ago a time was
function timeAgo(value, now) {
  const minutes = Math.floor((now - new Date(value).getTime()) / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);

  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// Button that starts a search and shows when the last one ran
function SyncButton({ search, onSearch }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);

    return () => clearInterval(timer);
  }, []);

  const last = search.lastSearchedAt;
  const title = search.running
    ? "Searching for new jobs"
    : !search.canRefresh
      ? "You've searched a lot this hour. Please try again later."
      : `${last ? `Updated ${new Date(last).toLocaleString()}. ` : ""}Click to search for new jobs now.`;

  return (
    <button
      type="button"
      className={`sync-btn${search.running ? " is-running" : ""}`}
      disabled={search.running || !search.canRefresh}
      title={title}
      aria-label={search.running ? "Searching for new jobs" : "Search for new jobs"}
      onClick={onSearch}
    >
      <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
        <path d="M16 10a6 6 0 1 1-1.76-4.24M16 4v3.5h-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="btn-flex-label" aria-live="polite">{search.running ? "Searching…" : last ? timeAgo(last, now) : "Search now"}</span>
    </button>
  );
}

// Button that clears a section after a second click to confirm
function ClearAllButton({ section, count, disabled, onClear }) {
  const [confirming, setConfirming] = useState(false);
  const armed = confirming && !disabled;

  useEffect(() => {
    if (!armed) {
      return;
    }

    const timer = setTimeout(() => setConfirming(false), 4000);

    return () => clearTimeout(timer);
  }, [armed]);

  // Clears the section on the second click
  function click() {
    if (!armed) {
      setConfirming(true);

      return;
    }

    setConfirming(false);
    onClear();
  }

  return (
    <button
      type="button"
      className={`clear-btn${armed ? " is-confirming" : ""}`}
      disabled={disabled}
      title={disabled ? "Wait for the search to finish before clearing" : `Remove all ${count} cards from the ${section} section`}
      aria-label={armed ? `Confirm clearing ${count} cards from ${section}` : `Clear all ${section} cards`}
      onClick={click}
      onBlur={() => setConfirming(false)}
    >
      <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
        <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="btn-flex-label">{armed ? `Clear ${count}?` : "Clear all"}</span>
    </button>
  );
}

// Bar split by how well the section's jobs match
function ScoreLine({ jobs }) {
  const counts = { high: 0, mid: 0, low: 0, none: 0 };

  jobs.forEach((job) => {
    counts[job.match_score === null ? "none" : scoreLevel(job.match_score)] += 1;
  });

  return (
    <span className="day-line section-line">
      {Object.entries(counts).filter(([, value]) => value > 0).map(([level, value]) => (
        <span key={level} className={`pipeline-segment match-seg-${level}`} style={{ flexGrow: value }} />
      ))}
    </span>
  );
}

// Section heading that collapses its content
function SectionToggle({ title, jobs, count, open, onToggle, children }) {
  return (
    <div className="jobs-section-head">
      <h2 className="jobs-section-title">
        <button type="button" className="day-toggle" aria-expanded={open} onClick={onToggle}>
          <span>{title}</span>
          <span className="day-count">{count}</span>
          <ScoreLine jobs={jobs} />
          <svg className="day-chevron" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      {children}
    </div>
  );
}

// Remembers whether a section is open until the page is reloaded
function useRememberedOpen(key, initial) {
  const [open, setOpen] = useState(() => (key in openSections ? openSections[key] : initial));

  // Toggles the section and saves its state
  const toggle = () => setOpen((value) => {
    openSections[key] = !value;

    return !value;
  });

  return [open, toggle];
}

// Returns the day a job was posted
function jobPostedDay(job) {
  return toDateInput(job.posted_at) || (job.created_at ? localISO(new Date(job.created_at)) : "");
}

// Returns the date a number of days ago
function daysAgoISO(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);

  return localISO(date);
}

// Checks whether a job was posted within a date range
function inDateRange(job, rangeKey) {
  const range = DATE_RANGES.find((option) => option.key === rangeKey);

  if (!range?.days) {
    return true;
  }

  const day = jobPostedDay(job);

  return day >= daysAgoISO(range.days - 1) && day <= daysAgoISO(0);
}

// Card for a job with its actions
function JobCard({ job, onTailor, onApply, onDismiss, onDownload }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const applied = job.state === "applied";
  const isNew = isFreshJob(job);

  return (
    <li className={`job-card${applied ? " job-applied" : ""}${job.match_score !== null ? ` match-${scoreLevel(job.match_score)}` : ""}`}>
      <div className="job-card-top job-card-grid">
        {isNew && <span className="job-new-tag">New!</span>}
        <CompanyAvatar company={job.company} />

        <div className="job-heading">
          <h3 className="job-title">
            {job.description ? (
              <button type="button" className="job-details-btn" aria-haspopup="dialog" title={job.position} onClick={() => setOpen(true)}>
                <span className="job-title-text">{job.position}</span>
                <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                  <path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <span className="job-title-text">{job.position}</span>
            )}
          </h3>
          <FitMeta as="p" className="job-meta">
            <span className="job-company">{job.company}</span>
            {job.location && (
              <span className="app-meta-item job-location">
                <PinIcon />
                <span className="job-location-text">{job.location}</span>
              </span>
            )}
            {job.workplace_model && (
              <span className={`app-tag workplace-tag mix-${job.workplace_model.toLowerCase()}`}>{job.workplace_model}</span>
            )}
            {job.posted_at && (
              <span className={`app-meta-item app-date-item${applied ? "" : ` posted-${postingAge(job.posted_at).level}`}`}>
                {applied ? <CalendarIcon /> : <FreshnessCalendar level={postingAge(job.posted_at).level} />}
                <PostedDate postedAt={job.posted_at} />
              </span>
            )}
            {job.url && (
              <a className="job-posting-link" href={job.url} target="_blank" rel="noreferrer" aria-label="View posting">
                <span className="view-posting-text">View posting</span> <ExternalIcon />
              </a>
            )}
          </FitMeta>
        </div>

        <div className="job-card-side">
          <button
            type="button"
            className="icon-btn job-dismiss"
            onClick={() => onDismiss(job)}
            aria-label={applied ? `Remove ${job.position} at ${job.company} from this list` : `Dismiss ${job.position} at ${job.company}`}
            title={applied ? "Remove from this list (it stays in Applications)" : "Not interested"}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {job.match_score !== null
            ? <ScoreRing score={job.match_score} />
            : job.source === "manual" && <span className="job-source">Added by you</span>}
        </div>

        <MatchSkills job={job} />

        <div className={`job-actions${applied && !job.has_tailoring ? " job-actions-none" : ""}`}>
          {applied ? (
            <>
              {job.has_tailoring && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  title="Download the resume you sent"
                  onClick={async () => {
                    setBusy(true);
                    await onDownload(job);
                    setBusy(false);
                  }}
                >
                  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                    <path d="M10 3.5v9M6 8.75l4 4 4-4M4 15.5h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {busy ? "Preparing…" : "Download resume"}
                </button>
              )}

              {!job.has_tailoring && (
                <button type="button" className="btn btn-ghost btn-sm job-actions-spacer" tabIndex={-1} aria-hidden="true" disabled>
                  &nbsp;
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onApply(job).catch(() => {});
                  setBusy(false);
                }}
              >
                Mark as applied
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onTailor(job)}>
                {job.has_tailoring ? "Open resume" : "Tailor resume"}
              </button>
            </>
          )}
        </div>
      </div>

      {open && <JobDetails job={job} onClose={() => setOpen(false)} />}
    </li>
  );
}

// Jobs page with the profile, search and job list
function Jobs({ csrfToken, applications, onApplied, onUnauthorized }) {
  const [profile, setProfile] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const autoSearched = useRef(false);

  // Sends a request, handling an expired session
  const request = useCallback(async (path, options = {}) => {
    const result = await apiRequest(path, { ...options, csrfToken });

    if (result.response.status === 401) {
      onUnauthorized();
    }

    return result;
  }, [csrfToken, onUnauthorized]);

  // Loads the jobs and search status
  const loadJobs = useCallback(async () => {
    const { response, data } = await request("/api/jobs");

    if (response.ok) {
      setJobs(data.jobs);
      setSearch(data.search);
    }

    return response.ok;
  }, [request]);

  // Starts a search
  const startSearch = useCallback(async (auto) => {
    setError("");

    try {
      const { response, data } = await request("/api/jobs/search", { method: "POST", body: { auto } });

      if (!response.ok) {
        setError(data.error || "Could not start a search.");

        return;
      }

      setSearch(data.search);
    } catch {
      setError("Could not reach the server. Please try again.");
    }
  }, [request]);

  useEffect(() => {
    (async () => {
      try {
        const [profileResult] = await Promise.all([request("/api/jobs/profile"), loadJobs()]);

        if (!profileResult.response.ok) {
          setError(profileResult.data.error || "Could not load your profile.");

          return;
        }

        setProfile(profileResult.data);

        if (profileResult.data.cv && !autoSearched.current) {
          autoSearched.current = true;
          startSearch(true);
        }
      } catch {
        setError("Could not reach the server. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [request, loadJobs, startSearch]);

  useEffect(() => {
    if (!search?.running) {
      return;
    }

    const timer = setInterval(() => {
      if (!document.hidden) {
        loadJobs().catch(() => {});
      }
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [search?.running, loadJobs]);

  // Updates a job in the list and the open modal
  function updateJob(id, patch) {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
    setModal((current) => (current?.job?.id === id ? { ...current, job: { ...current.job, ...patch } } : current));
  }

  // Dismisses a job
  async function dismiss(job) {
    setJobs((current) => current.filter((other) => other.id !== job.id));

    try {
      const { response, data } = await request(`/api/jobs/${job.id}/dismiss`, { method: "POST" });

      if (!response.ok) {
        throw new Error(data.error);
      }
    } catch (err) {
      setError(err.message || "Could not dismiss the job.");
      loadJobs().catch(() => {});
    }
  }

  // Clears the given jobs from a section
  async function clearAll(section, cleared) {
    const ids = new Set(cleared.map((job) => job.id));
    setJobs((current) => current.filter((job) => !ids.has(job.id)));

    try {
      const { response, data } = await request("/api/jobs/dismiss-all", {
        method: "POST",
        body: { section, ids: [...ids] }
      });

      if (!response.ok) {
        throw new Error(data.error);
      }
    } catch (err) {
      setError(err.message || "Could not clear the jobs.");
      loadJobs().catch(() => {});
    }
  }

  // Marks a job as applied
  async function apply(job) {
    setError("");

    try {
      const { response, data } = await request(`/api/jobs/${job.id}/apply`, {
        method: "POST",
        body: { applied_at: localISO(new Date()) }
      });

      if (!response.ok) {
        throw new Error(data.error || "Could not add the application.");
      }

      updateJob(job.id, data.job);

      if (data.hidden_job_ids?.length) {
        setJobs((current) => current.filter((other) => !data.hidden_job_ids.includes(other.id)));
      }

      onApplied(data.application);
    } catch (err) {
      setError(err.message || "Could not add the application.");
      throw err;
    }
  }

  // Downloads the saved resume for a job
  async function downloadCv(job) {
    try {
      await downloadSavedCv(job.id);
    } catch (err) {
      setError(err.message);
    }
  }

  // Saves the profile, closes its modal and starts the first search
  function profileSaved(next, { keepOpen = false } = {}) {
    const firstProfile = !profile?.cv && next.cv;
    setProfile(next);

    if (!keepOpen) {
      setModal(null);
    }

    if (firstProfile) {
      startSearch(true);
    }
  }

  const hasProfile = Boolean(profile?.cv);
  const pastEntries = useMemo(
    () => [...applications, ...jobs.filter((job) => job.source === "manual")],
    [applications, jobs]
  );
  const [foundOpen, toggleFound] = useRememberedOpen("found", true);
  const [dateRange, setDateRange] = useState("all");
  const [appliedOpen, toggleApplied] = useRememberedOpen("applied", false);
  const openJobs = jobs.filter((job) => job.state !== "applied");
  const shownJobs = openJobs.filter((job) => inDateRange(job, dateRange));
  const appliedJobs = jobs.filter((job) => job.state === "applied").sort(byListOrder);
  const cardProps = {
    onTailor: (job) => setModal({ type: "tailor", job }),
    onApply: apply,
    onDismiss: dismiss,
    onDownload: downloadCv
  };

  return (
    <main className="dashboard">
      <div className="dashboard-header jobs-header">
        <div>
          <h1>Your Job Posts</h1>
        </div>
        <div className="dashboard-actions">
          {hasProfile && (
            <button
              type="button"
              className="btn btn-ghost profile-btn"
              aria-label="Your profile"
              title="Your profile"
              onClick={() => setModal({ type: "profile" })}
            >
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                <circle cx="10" cy="7" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M3.8 16.5c1.2-2.9 3.5-4.3 6.2-4.3s5 1.4 6.2 4.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span className="btn-label">Your Profile</span>
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => setModal({ type: "add" })}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New
          </button>
        </div>
      </div>

      {error && (
        <Alert type="error" onDismiss={() => setError("")}>{error}</Alert>
      )}

      {search?.lastError && !search.running && (
        <Alert type="warning">{`Last search failed: ${search.lastError}`}</Alert>
      )}


      {loading ? (
        <div className="page-loader" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          Loading…
        </div>
      ) : !hasProfile ? (
        <div className="empty-state">
          <h2>Start with your resume</h2>
          <p className="muted">
            Upload your resume as a PDF. We'll read it, search the web for jobs that fit, and tailor your resume to each one.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setModal({ type: "profile" })}>
            Upload your resume
          </button>
        </div>
      ) : (
        <>
          <section className="jobs-section">
            <SectionToggle title="Found" jobs={openJobs} count={openJobs.length} open={foundOpen} onToggle={toggleFound}>
              {(shownJobs.length > 0 || search) && (
                <div className="btn-group">
                  {shownJobs.length > 0 && (
                    <ClearAllButton section="found" count={shownJobs.length} disabled={Boolean(search?.running)} onClear={() => clearAll("found", shownJobs)} />
                  )}
                  {search && <SyncButton search={search} onSearch={() => startSearch(false)} />}
                </div>
              )}
            </SectionToggle>

            {foundOpen && (openJobs.length === 0 ? (
              <div className="empty-state compact">
                <h2>{search?.running ? "Looking for jobs…" : "No jobs yet"}</h2>
                <p className="muted">
                  {search?.running
                    ? "New matches will show here."
                    : "Search again later, or add a job you found yourself."}
                </p>
              </div>
            ) : (
              <>
                <div className="chips" role="tablist" aria-label="Filter by date posted">
                  {DATE_RANGES.map((range) => (
                    <button
                      key={range.key}
                      type="button"
                      role="tab"
                      aria-selected={dateRange === range.key}
                      className={`chip ${dateRange === range.key ? "active" : ""}`}
                      onClick={() => setDateRange(range.key)}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>

                {shownJobs.length === 0 ? (
                  <p className="muted jobs-filter-empty">
                    No job posts from {DATE_RANGES.find((range) => range.key === dateRange).label.toLowerCase()}.
                  </p>
                ) : (
                  <ul className="job-list">
                    {shownJobs.map((job) => <JobCard key={job.id} job={job} {...cardProps} />)}
                  </ul>
                )}
              </>
            ))}
          </section>

          {appliedJobs.length > 0 && (
            <section className="jobs-section">
              <SectionToggle title="Applied" jobs={appliedJobs} count={appliedJobs.length} open={appliedOpen} onToggle={toggleApplied}>
                <div className="btn-group">
                  <ClearAllButton section="applied" count={appliedJobs.length} onClear={() => clearAll("applied", appliedJobs)} />
                </div>
              </SectionToggle>
              {appliedOpen && (
                <ul className="job-list">
                  {appliedJobs.map((job) => <JobCard key={job.id} job={job} {...cardProps} />)}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {modal?.type === "profile" && (
        <ProfileModal
          profile={profile}
          csrfToken={csrfToken}
          onClose={() => setModal(null)}
          onSaved={profileSaved}
          onUnauthorized={onUnauthorized}
        />
      )}

      {modal?.type === "add" && (
        <AddJobModal
          csrfToken={csrfToken}
          pastEntries={pastEntries}
          applications={applications}
          onClose={() => setModal(null)}
          onUnauthorized={onUnauthorized}
          onAdded={(job) => {
            setJobs((current) => [job, ...current.filter((other) => other.id !== job.id)]);
            setModal(null);
          }}
        />
      )}

      {modal?.type === "tailor" && (
        <TailorModal
          job={modal.job}
          csrfToken={csrfToken}
          baseCv={profile?.cv}
          gradeSheet={profile?.gradeSheet ?? null}
          onGradeSheetChange={setProfile}
          onClose={() => setModal(null)}
          onTailored={(id, description) => updateJob(id, { has_tailoring: true, ...(description ? { description } : {}) })}
          onApply={apply}
          onUnauthorized={onUnauthorized}
        />
      )}
    </main>
  );
}

export default Jobs;
