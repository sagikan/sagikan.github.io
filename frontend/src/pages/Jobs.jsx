import { useCallback, useEffect, useRef, useState } from "react";
import CompanyAvatar from "../components/CompanyAvatar";
import AddJobModal from "../components/jobs/AddJobModal";
import ProfileModal from "../components/jobs/ProfileModal";
import TailorModal from "../components/jobs/TailorModal";
import JobDetails, { MatchSkills, PostedDate, ScoreRing } from "../components/jobs/JobDetails";
import { CALENDAR_ICON, EXTERNAL_ICON, PIN_ICON, postingAge } from "../components/jobs/jobInfo";
import { apiRequest, localISO, toDateInput } from "../api";
import { downloadSavedCv } from "../utils/resume/cvPdf";
import Alert from "../components/Alert";

const POLL_MS = 5000;
const DATE_RANGES = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today", days: 1 },
  { key: "week", label: "Last Week", days: 7 },
  { key: "month", label: "Last Month", days: 30 }
];

function timeAgo(value, now) {
  const minutes = Math.floor((now - new Date(value).getTime()) / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

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
      <span aria-live="polite">{search.running ? "Searching…" : last ? timeAgo(last, now) : "Search now"}</span>
    </button>
  );
}

function SectionToggle({ title, count, open, onToggle, children }) {
  return (
    <div className="jobs-section-head">
      <h2 className="jobs-section-title">
        <button type="button" className="day-toggle" aria-expanded={open} onClick={onToggle}>
          <span>{title}</span>
          <span className="day-count">{count}</span>
          <span className="day-line" />
          <svg className="day-chevron" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      {children}
    </div>
  );
}

function storage(action) {
  try {
    return action(localStorage);
  } catch {
    return null;
  }
}

function useRememberedOpen(key) {
  const [open, setOpen] = useState(() => storage((store) => store.getItem(key)) !== "closed");

  const toggle = () => setOpen((value) => {
    storage((store) => store.setItem(key, value ? "closed" : "open"));
    return !value;
  });

  return [open, toggle];
}

function jobPostedDay(job) {
  return toDateInput(job.posted_at) || (job.created_at ? localISO(new Date(job.created_at)) : "");
}

function daysAgoISO(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localISO(date);
}

function inDateRange(job, rangeKey) {
  const range = DATE_RANGES.find((option) => option.key === rangeKey);

  if (!range?.days) {
    return true;
  }

  const day = jobPostedDay(job);
  return day >= daysAgoISO(range.days - 1) && day <= daysAgoISO(0);
}

function JobCard({ job, onTailor, onApply, onDismiss, onDownload }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const applied = job.state === "applied";

  return (
    <li className={`job-card${applied ? " job-applied" : ""}`}>
      <div className="job-card-top">
        <CompanyAvatar company={job.company} />

        <div className="job-heading">
          <h3 className="job-title">{job.position}</h3>
          <p className="job-meta">
            <span className="job-company">{job.company}</span>
            {job.location && (
              <span className="app-meta-item">
                {PIN_ICON}
                {job.location}
              </span>
            )}
            {job.workplace_model && (
              <span className={`app-tag workplace-tag mix-${job.workplace_model.toLowerCase()}`}>{job.workplace_model}</span>
            )}
            {job.posted_at && (
              <span className={`app-meta-item${applied ? "" : ` posted-${postingAge(job.posted_at).level}`}`}>
                {CALENDAR_ICON}
                <PostedDate postedAt={job.posted_at} />
              </span>
            )}
            {job.url && (
              <a className="job-posting-link" href={job.url} target="_blank" rel="noreferrer">
                View posting {EXTERNAL_ICON}
              </a>
            )}
          </p>

          <MatchSkills job={job} />
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
      </div>

      <div className="job-card-footer">
        {job.description && (
          <button type="button" className="job-details-btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>
            Details
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
              <path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        <div className="job-actions">
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

function Jobs({ csrfToken, onApplied, onUnauthorized }) {
  const [profile, setProfile] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const autoSearched = useRef(false);

  const request = useCallback(async (path, options = {}) => {
    const result = await apiRequest(path, { ...options, csrfToken });

    if (result.response.status === 401) {
      onUnauthorized();
    }

    return result;
  }, [csrfToken, onUnauthorized]);

  const loadJobs = useCallback(async () => {
    const { response, data } = await request("/api/jobs");

    if (response.ok) {
      setJobs(data.jobs);
      setSearch(data.search);
    }

    return response.ok;
  }, [request]);

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

  function updateJob(id, patch) {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
    setModal((current) => (current?.job?.id === id ? { ...current, job: { ...current.job, ...patch } } : current));
  }

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
      onApplied(data.application);
    } catch (err) {
      setError(err.message || "Could not add the application.");
      throw err;
    }
  }

  async function downloadCv(job) {
    try {
      await downloadSavedCv(job.id);
    } catch (err) {
      setError(err.message);
    }
  }

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
  const [foundOpen, toggleFound] = useRememberedOpen("jobs.found");
  const [dateRange, setDateRange] = useState("all");
  const [appliedOpen, toggleApplied] = useRememberedOpen("jobs.applied");
  const openJobs = jobs.filter((job) => job.state !== "applied");
  const shownJobs = openJobs.filter((job) => inDateRange(job, dateRange));
  const appliedJobs = jobs.filter((job) => job.state === "applied");
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
            <SectionToggle title="Found" count={openJobs.length} open={foundOpen} onToggle={toggleFound}>
              {search && <SyncButton search={search} onSearch={() => startSearch(false)} />}
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
              <SectionToggle title="Applied" count={appliedJobs.length} open={appliedOpen} onToggle={toggleApplied} />
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
