import { Fragment, useMemo, useRef, useState } from "react";
import { downloadApplicationsCsv } from "../utils/exportCsv";
import { STATUSES, formatDate, jobDay, localISO, toDateInput } from "../api";
import ApplicationForm from "../components/ApplicationForm";
import CompanyAvatar from "../components/CompanyAvatar";
import Modal from "../components/Modal";
import ApplicationStats from "../components/ApplicationStats";

const STATUS_ORDER = ["Offer", "Interview", "Applied", "Rejected", "Withdrawn"];

const byNewest = (a, b) => sortDate(b).localeCompare(sortDate(a));
const byStatus = (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);

const SORTS = {
  newestStatus: {
    label: "Newest First + Status",
    compare: (a, b) => byNewest(a, b) || byStatus(a, b)
  },
  newest: { label: "Newest First", compare: byNewest },
  oldest: { label: "Oldest First", compare: (a, b) => sortDate(a).localeCompare(sortDate(b)) },
  status: { label: "Status", compare: (a, b) => byStatus(a, b) || byNewest(a, b) },
  company: { label: "Company A–Z", compare: (a, b) => a.company.localeCompare(b.company) }
};

const DEFAULT_SORT = Object.keys(SORTS)[0];

const GROUPED_SORTS = ["newestStatus", "newest", "oldest"];

const DATE_RANGES = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today", days: 1 },
  { key: "week", label: "Last Week", days: 7 },
  { key: "month", label: "Last Month", days: 30 }
];

function sortDate(job) {
  return toDateInput(job.applied_at) || String(job.created_at || "");
}

function daysAgoISO(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localISO(date);
}

function hoursAgo(timestamp) {
  const hours = Math.floor((Date.now() - new Date(timestamp).getTime()) / 3600000);
  return hours < 1 ? "<1h" : `${hours}h`;
}

function dayLabel(day) {
  if (day === daysAgoISO(0)) return "Today";
  if (day === daysAgoISO(1)) return "Yesterday";

  const date = new Date(`${day}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric"
  });
}

function MailIcon() {
  return (
    <svg className="mail-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <rect x="2.75" y="4.5" width="14.5" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 6l6.5 5 6.5-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MailHint({ update }) {
  return (
    <span className="mail-hint" tabIndex={0}>
      <MailIcon />
      <span className="mail-popover" role="tooltip">
        <strong>{update.subject}</strong>
        <span>{update.sender}</span>
        <span>{formatDate(localISO(new Date(update.received_at)))}</span>
      </span>
    </span>
  );
}

function Chevron() {
  return (
    <svg className="day-chevron" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusPill({ status }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}>{status}</span>;
}



function Applications({
  applications, emailUpdates, onResolveEmailUpdate, email, error, onDismissError, onSave, onDelete, onQuickStatus
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dateRange, setDateRange] = useState("all");
  const [pickedDate, setPickedDate] = useState("");
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [editing, setEditing] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [collapsedDays, setCollapsedDays] = useState([]);
  const [resolvingId, setResolvingId] = useState(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [moreOpenId, setMoreOpenId] = useState(null);
  const dateInput = useRef(null);

  function toggleDay(day) {
    setCollapsedDays((current) =>
      current.includes(day) ? current.filter((other) => other !== day) : [...current, day]
    );
  }

  const pendingByApp = useMemo(() => {
    const result = new Map();

    emailUpdates.pending.forEach((update) => {
      if (update.application_id && !result.has(update.application_id)) {
        result.set(update.application_id, update);
      }
    });

    return result;
  }, [emailUpdates.pending]);

  const unmatched = useMemo(
    () => emailUpdates.pending.filter((update) => !update.application_id),
    [emailUpdates.pending]
  );

  const flagged = useMemo(() => {
    const byId = new Map(applications.map((job) => [job.id, job]));
    return [...pendingByApp.keys()].map((id) => byId.get(id)).filter(Boolean);
  }, [applications, pendingByApp]);

  const listed = useMemo(
    () => applications.filter((job) => !pendingByApp.has(job.id)),
    [applications, pendingByApp]
  );

  const dateScoped = useMemo(() => {
    if (dateRange === "date") {
      return listed.filter((job) => jobDay(job) === pickedDate);
    }

    const range = DATE_RANGES.find((option) => option.key === dateRange);
    if (!range.days) {
      return listed;
    }

    const from = daysAgoISO(range.days - 1);
    const to = daysAgoISO(0);
    return listed.filter((job) => {
      const day = jobDay(job);
      return day >= from && day <= to;
    });
  }, [listed, dateRange, pickedDate]);

  const searched = useMemo(() => {
    const search = query.trim().toLowerCase();

    return dateScoped.filter((job) =>
      !search ||
      job.company.toLowerCase().includes(search) ||
      job.position.toLowerCase().includes(search) ||
      (job.location || "").toLowerCase().includes(search) ||
      (job.notes || "").toLowerCase().includes(search)
    );
  }, [dateScoped, query]);

  const counts = useMemo(() => {
    const result = Object.fromEntries(STATUSES.map((status) => [status, 0]));
    searched.forEach((job) => {
      result[job.status] = (result[job.status] || 0) + 1;
    });
    return result;
  }, [searched]);

  const visible = useMemo(
    () => searched
      .filter((job) => statusFilter === "All" || job.status === statusFilter)
      .sort(SORTS[sort].compare),
    [searched, statusFilter, sort]
  );

  const showDayHeaders = GROUPED_SORTS.includes(sort) && (dateRange === "week" || dateRange === "month" || dateRange === "all");
  const hideCardDate = GROUPED_SORTS.includes(sort) || dateRange === "today";
  const dayCounts = useMemo(() => {
    const result = {};
    visible.forEach((job) => {
      result[jobDay(job)] = (result[jobDay(job)] || 0) + 1;
    });
    return result;
  }, [visible]);

  function openDatePicker() {
    const input = dateInput.current;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  }

  const total = applications.length;

  async function resolveUpdate(id, action, body) {
    setResolvingId(id);
    setReviewError("");

    const message = await onResolveEmailUpdate(id, action, body);

    setResolvingId(null);
    setReviewError(message);
  }

  function addFromUpdate(update) {
    setEditing({
      eventId: update.id,
      company: update.company || "",
      position: update.position || "",
      status: update.suggested_status
    });
  }

  async function handleSubmit(fields) {
    const message = await onSave(editing === "new" ? null : editing.id, fields);

    if (!message) {
      if (editing.eventId) {
        onResolveEmailUpdate(editing.eventId, "dismiss");
      }

      setEditing(null);
    }

    return message;
  }

  function renderDecision(update, { primary = "accept" } = {}) {
    const busy = resolvingId === update.id;

    return (
      <div className="decision">
        {primary === "accept" && (
          <button
            type="button"
            className="decision-btn accept"
            disabled={busy}
            onClick={() => resolveUpdate(update.id, "accept")}
            aria-label="Accept"
            title="Accept"
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {primary === "add" && (
          <button
            type="button"
            className="decision-btn accept"
            disabled={busy}
            onClick={() => addFromUpdate(update)}
            aria-label="Add as a new application"
            title="Add as a new application"
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="decision-btn dismiss"
          disabled={busy}
          onClick={() => resolveUpdate(update.id, "dismiss")}
          aria-label="Dismiss"
          title="Dismiss"
        >
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M4.75 4.75l10.5 10.5M15.25 4.75L4.75 15.25" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  }

  function renderChoices(update) {
    const options = update.candidate_ids
      .map((id) => applications.find((job) => job.id === id))
      .filter(Boolean);
    const busy = resolvingId === update.id;

    function choose(job) {
      setMoreOpenId(null);
      resolveUpdate(update.id, "accept", { applicationId: job.id });
    }

    return (
      <div
        className="choices-more"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setMoreOpenId(null);
          }
        }}
      >
        <button
          type="button"
          className="decision-btn accept"
          disabled={busy}
          aria-expanded={moreOpenId === update.id}
          aria-haspopup="menu"
          aria-label={`Choose the application (${options.length})`}
          title={`Choose the application (${options.length})`}
          onClick={() => setMoreOpenId((open) => (open === update.id ? null : update.id))}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle cx="10" cy="4" r="1.8" fill="currentColor" />
            <circle cx="10" cy="10" r="1.8" fill="currentColor" />
            <circle cx="10" cy="16" r="1.8" fill="currentColor" />
          </svg>
        </button>

        {moreOpenId === update.id && (
          <div className="choices-menu" role="menu">
            {options.map((job) => (
              <button
                key={job.id}
                type="button"
                role="menuitem"
                className="choices-menu-item"
                disabled={busy}
                onClick={() => choose(job)}
                title={`${job.position}`}
              >
                {job.position}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderCard(job, hidden = false) {
    const update = pendingByApp.get(job.id);

    return (
        <li
          key={job.id}
          className={`app-card status-${job.status.toLowerCase()}${update ? " needs-review" : ""}`}
          hidden={hidden}
        >
          <CompanyAvatar company={job.company} />

          <div className="app-main">
            <div className="app-title">
              <h3>{job.position}</h3>
            </div>
            <div className="app-meta">
              <span className="app-company">{job.company}</span>
              {job.location && (
                <span className="app-meta-item">
                  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                    <path d="M10 17.5s5.5-4.9 5.5-9.25a5.5 5.5 0 0 0-11 0C4.5 12.6 10 17.5 10 17.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                    <circle cx="10" cy="8.25" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                  </svg>
                  {job.location}
                </span>
              )}
              {job.workplace_model && (
                <span className={`app-tag workplace-tag mix-${job.workplace_model.toLowerCase()}`}>{job.workplace_model}</span>
              )}
              {job.applied_at && (!hideCardDate || update) && (
                <span className="app-meta-item">
                  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                    <rect x="3.5" y="4.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M3.5 8.5h13M7 2.75v3.5M13 2.75v3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                  {formatDate(job.applied_at)}
                </span>
              )}
              {job.job_url && (
                <a href={job.job_url} target="_blank" rel="noreferrer">
                  View posting ↗
                </a>
              )}
            </div>
            {job.notes && <p className="app-notes">{job.notes}</p>}
          </div>

          {update && <StatusPill status={job.status} />}

          {update ? (
            <div
              className={`app-suggestion status-${update.suggested_status.toLowerCase()}`}
              role="group"
              aria-label={`${job.status} to ${update.suggested_status}`}
            >
              <StatusPill status={update.suggested_status} />
              <MailHint update={update} />
              {renderDecision(update)}
            </div>
          ) : (
          <div className="app-actions">
            {confirmDeleteId === job.id ? (
              <div className="confirm">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    setConfirmDeleteId(null);
                    onDelete(job.id);
                  }}
                >
                  Delete
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)}>
                  Keep
                </button>
              </div>
            ) : (
              <>
                <select
                  className="status-select"
                  value={job.status}
                  onChange={(event) => onQuickStatus(job.id, event.target.value)}
                  aria-label={`Change status for ${job.company}`}
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setEditing(job)}
                  aria-label={`Edit ${job.company} application`}
                  title="Edit"
                >
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                    <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  onClick={() => setConfirmDeleteId(job.id)}
                  aria-label={`Delete ${job.company} application`}
                  title="Delete"
                >
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                    <path d="M4 6h12M8 6V4h4v2m-6 0l1 10h6l1-10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </>
            )}
          </div>
          )}
        </li>
    );
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Your Applications</h1>
        </div>
        <div className="dashboard-actions">
          <button type="button" className="btn btn-ghost export-btn" disabled={applications.length === 0} onClick={() => downloadApplicationsCsv(applications)}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 14v1.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Export
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error alert-dismissible" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-btn" onClick={onDismissError} aria-label="Dismiss">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      <ApplicationStats applications={applications} />

      {(flagged.length > 0 || unmatched.length > 0) && (
        <section className="review" aria-label="Emails to review">
          <h2 className="review-header">
            <button
              type="button"
              className="day-toggle"
              aria-expanded={reviewOpen}
              onClick={() => setReviewOpen((open) => !open)}
            >
              <MailIcon />
              <span>Needs your review</span>
              <span className="day-count">{flagged.length + unmatched.length}</span>
              <span className="day-line" />
              <Chevron />
            </button>
          </h2>

          {reviewOpen && (
            <>
              {reviewError && <div className="alert alert-error" role="alert">{reviewError}</div>}

              {flagged.length > 0 && (
                <ul className="app-list">
                  {flagged.map((job) => renderCard(job))}
                </ul>
              )}

              {unmatched.length > 0 && (
                <ul className="app-list">
                  {unmatched.map((update) => (
                    <li key={update.id} className="unmatched-card">
                      <CompanyAvatar company={update.company || "?"} />

                      <div className="app-main">
                        <div className="app-title">
                          <h3>{update.position || update.company || "Unknown role"}</h3>
                        </div>
                        {update.position && update.company && (
                          <div className="app-meta">
                            <span className="app-company">{update.company}</span>
                          </div>
                        )}

                      </div>

                      <div
                        className={`app-suggestion status-${update.suggested_status.toLowerCase()}`}
                        role="group"
                        aria-label={`${update.suggested_status}`}
                      >
                        <StatusPill status={update.suggested_status} />
                        <MailHint update={update} />
                        {update.candidate_ids.length > 0 && renderChoices(update)}
                        {renderDecision(update, { primary: update.candidate_ids.length > 0 ? null : "add" })}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {emailUpdates.recent.length > 0 && (
        <section className="review review-muted" aria-label="Recent email updates">
          <h2 className="review-header">
            <button
              type="button"
              className="day-toggle"
              aria-expanded={activityOpen}
              onClick={() => setActivityOpen((open) => !open)}
            >
              <MailIcon />
              <span>Approved in past day</span>
              <span className="day-count">{emailUpdates.recent.length}</span>
              <span className="day-line" />
              <Chevron />
            </button>
          </h2>

          {activityOpen && (
            <ul className="app-list">
              {emailUpdates.recent.map((update) => {
                const automatic = update.state === "auto_applied";
                const how = automatic ? "Applied automatically" : "Accepted by you";

                return (
                  <li key={update.id} className={`app-card activity-card status-${(update.previous_status || update.suggested_status).toLowerCase()}`}>
                    <CompanyAvatar company={update.application_company} />

                    <div className="app-main">
                      <div className="app-title">
                        <h3>{update.application_position}</h3>
                      </div>
                      <div className="app-meta">
                        <span className="app-company">{update.application_company}</span>
                        <span className="app-tag" title={how}>{automatic ? "Automatic" : "Manual"}</span>
                        <span className="app-meta-item">
                          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.7" />
                            <path d="M10 6v4l2.75 1.75" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {hoursAgo(update.resolved_at)}
                        </span>
                      </div>
                    </div>

                    {update.previous_status && <StatusPill status={update.previous_status} />}

                    <div className={`app-suggestion status-${update.suggested_status.toLowerCase()}`} role="group" aria-label={`${update.previous_status ? `${update.previous_status} to ` : ""}${update.suggested_status}. ${how}`}>
                      <StatusPill status={update.suggested_status} />
                      <MailHint update={update} />
                      {update.undoable ? (
                        <button
                          type="button"
                          className="decision-btn dismiss"
                          disabled={resolvingId === update.id}
                          onClick={() => resolveUpdate(update.id, "undo")}
                          aria-label="Undo"
                          title="Undo"
                        >
                          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                            <path d="M7.5 4.5L3.5 8.5l4 4M3.5 8.5h8a4.5 4.5 0 0 1 0 9H8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section className="toolbar">
        <div className="search">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M14 14l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search company, position, location, etc."
            aria-label="Search applications"
          />
        </div>

        <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort applications">
          {Object.entries(SORTS).map(([key, option]) => (
            <option key={key} value={key}>{option.label}</option>
          ))}
        </select>
      </section>

      <div className="chips" role="tablist" aria-label="Filter by date">
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
        <button
          type="button"
          role="tab"
          aria-selected={dateRange === "date"}
          className={`chip chip-date ${dateRange === "date" ? "active" : ""}`}
          onClick={openDatePicker}
          aria-label="Pick a single date"
          title="Pick a single date"
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <rect x="3.5" y="4.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M3.5 8.5h13M7 2.75v3.5M13 2.75v3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          {dateRange === "date" && formatDate(pickedDate)}
          <input
            ref={dateInput}
            type="date"
            className="chip-date-input"
            value={pickedDate}
            max={daysAgoISO(0)}
            tabIndex={-1}
            aria-label="Choose a single date"
            onChange={(event) => {
              const value = event.target.value;
              if (value) {
                const isToday = value === daysAgoISO(0);
                setPickedDate(isToday ? "" : value);
                setDateRange(isToday ? "today" : "date");
              }
            }}
          />
        </button>
      </div>

      <div className="chips" role="tablist" aria-label="Filter by status">
        {["All", ...STATUSES].map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={statusFilter === status}
            className={`chip ${statusFilter === status ? "active" : ""}`}
            onClick={() => setStatusFilter(status)}
          >
            {status}
            <span className="chip-count">{status === "All" ? searched.length : counts[status]}</span>
          </button>
        ))}
      </div>

      {total === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28">
              <rect x="3" y="7" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <h2>No applications yet</h2>
          <p className="muted">Add your first application to start tracking your search.</p>
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            Add application
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state compact">
          <h2>No matches</h2>
          <p className="muted">Try a different date range, search or status filter.</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setQuery("");
              setStatusFilter("All");
              setDateRange("all");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul className="app-list">
          {visible.map((job, index) => (
            <Fragment key={job.id}>
            {showDayHeaders && jobDay(job) !== jobDay(visible[index - 1] || {}) && (
              <li className="day-header">
                <button
                  type="button"
                  className="day-toggle"
                  aria-expanded={!collapsedDays.includes(jobDay(job))}
                  onClick={() => toggleDay(jobDay(job))}
                >
                  <span>{dayLabel(jobDay(job))}</span>
                  <span className="day-count">{dayCounts[jobDay(job)]}</span>
                  <span className="day-line" />
                  <svg className="day-chevron" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </li>
            )}
            {renderCard(job, showDayHeaders && collapsedDays.includes(jobDay(job)))}
            </Fragment>
          ))}
        </ul>
      )}

      {editing && (
        <Modal title={editing === "new" || !editing.id ? "New application" : "Edit application"} onClose={() => setEditing(null)}>
          <ApplicationForm
            job={editing === "new" ? null : editing}
            applications={applications}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </main>
  );
}

export default Applications;
