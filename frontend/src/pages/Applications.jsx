import { useMemo, useState } from "react";
import { STATUSES, formatDate, toDateInput } from "../api";
import ApplicationForm from "../components/ApplicationForm";
import Modal from "../components/Modal";

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

function sortDate(job) {
  return toDateInput(job.applied_at) || String(job.created_at || "");
}

function Applications({ applications, email, error, onDismissError, onSave, onDelete, onQuickStatus }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [editing, setEditing] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const counts = useMemo(() => {
    const result = Object.fromEntries(STATUSES.map((status) => [status, 0]));
    applications.forEach((job) => {
      result[job.status] = (result[job.status] || 0) + 1;
    });
    return result;
  }, [applications]);

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();

    return applications
      .filter((job) => statusFilter === "All" || job.status === statusFilter)
      .filter((job) =>
        !search ||
        job.company.toLowerCase().includes(search) ||
        job.position.toLowerCase().includes(search) ||
        (job.location || "").toLowerCase().includes(search) ||
        (job.notes || "").toLowerCase().includes(search)
      )
      .sort(SORTS[sort].compare);
  }, [applications, query, statusFilter, sort]);

  const total = applications.length;
  const active = counts.Applied + counts.Interview;
  const responded = counts.Interview + counts.Offer + counts.Rejected;
  const responseRate = total ? Math.round((responded / total) * 100) : 0;

  const stats = [
    { label: "Total", value: total },
    { label: "In Progress", value: active },
    { label: "Interviews", value: counts.Interview },
    { label: "Offers", value: counts.Offer },
    { label: "Response Rate", value: `${responseRate}%` }
  ];

  async function handleSubmit(fields) {
    const message = await onSave(editing === "new" ? null : editing.id, fields);

    if (!message) {
      setEditing(null);
    }

    return message;
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Applications</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          New
        </button>
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

      <section className="stats">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <span className="stat-label">{stat.label}</span>
            <strong className="stat-value">{stat.value}</strong>
          </div>
        ))}
      </section>

      {total > 0 && (
        <section className="pipeline" aria-label="Status breakdown">
          {STATUSES.filter((status) => counts[status] > 0).map((status) => (
            <span
              key={status}
              className={`pipeline-segment seg-${status.toLowerCase()}`}
              style={{ flexGrow: counts[status] }}
              title={`${status}: ${counts[status]}`}
            />
          ))}
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
            placeholder="Search company, position, location or notes"
            aria-label="Search applications"
          />
        </div>

        <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort applications">
          {Object.entries(SORTS).map(([key, option]) => (
            <option key={key} value={key}>{option.label}</option>
          ))}
        </select>
      </section>

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
            <span className="chip-count">{status === "All" ? total : counts[status]}</span>
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
          <p className="muted">Try a different search or status filter.</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setQuery("");
              setStatusFilter("All");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul className="app-list">
          {visible.map((job) => (
            <li key={job.id} className={`app-card status-${job.status.toLowerCase()}`}>
              <span className="avatar">{job.company.trim()[0]?.toUpperCase() || "?"}</span>

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
                  {job.workplace_model && <span className="app-tag">{job.workplace_model}</span>}
                  {job.applied_at && (
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
                      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
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
                      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                        <path d="M4 6h12M8 6V4h4v2m-6 0l1 10h6l1-10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Modal title={editing === "new" ? "New application" : "Edit application"} onClose={() => setEditing(null)}>
          <ApplicationForm
            job={editing === "new" ? null : editing}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
    </main>
  );
}

export default Applications;
