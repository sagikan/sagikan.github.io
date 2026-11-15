import { memo } from "react";
import { formatDate, jobDay } from "../../lib/api";
import AppNote from "./AppNote";
import FitMeta from "./FitMeta";
import StatusStack from "./StatusStack";
import { ExternalIcon } from "../jobs/JobIcons";
import CompanyAvatar from "../ui/CompanyAvatar";

/* An application's card: company, position, details and note, with its status area on the right. A card waiting on
   an email update shows the update's panel (review) in its place, with its mail line (footer) under it. Every callback
   gets the application (or its ID) first, so the page passes the same functions to every card, and a card whose props
   didn't change skips re-rendering (memo) */
function ApplicationCard({
  job, hidden = false, hideCardDate = false, folded = false, busy = false, cvBusy = false, review = null, footer = null,
  onEdit, onCardClick, onDownloadCv, onFoldChange, onAddStep, onChangeStep, onRemoveStep, onDelete
}) {
  // A server from before status steps sends none (the two deploy separately): the status shows as the only step
  const journeyJob = job.steps?.length ? job : { ...job, steps: [{ id: "none", status: job.status, date: jobDay(job) }] };

  return (
    <li
      className={`app-card status-${job.status.toLowerCase()}${review ? " needs-review" : ""}${folded ? " folded" : ""}`}
      hidden={hidden}
      onClick={review ? undefined : (event) => onCardClick(event, job, folded)}
    >
      <CompanyAvatar company={job.company} />

      <div className="app-main">
        <div className="app-title">
          <h3>{job.position}</h3>
          {!review && (
            <button
              type="button"
              className="icon-btn app-edit"
              onClick={() => onEdit(job)}
              aria-label={`Edit ${job.company} application`}
              title="Edit"
            >
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path d="M3 6h6.5M14.5 6H17M3 14h2.5M10.5 14H17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="12" cy="6" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="8" cy="14" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
          )}
        </div>
        <FitMeta>
          <span className="app-company">{job.company}</span>
          {job.location && (
            <span className="app-meta-item app-location-item">
              <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                <path d="M10 17.5s5.5-4.9 5.5-9.25a5.5 5.5 0 0 0-11 0C4.5 12.6 10 17.5 10 17.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                <circle cx="10" cy="8.25" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
              </svg>
              <span className="app-location">{job.location}</span>
            </span>
          )}
          {job.workplace_model && (
            <span
              className={`app-tag workplace-tag mix-${job.workplace_model.toLowerCase()}`}
              title={job.workplace_model}
            >
              {job.workplace_model}
            </span>
          )}
          {job.applied_at && (!hideCardDate || review) && (
            <span className="app-meta-item app-date-item">
              <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                <rect x="3.5" y="4.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <path d="M3.5 8.5h13M7 2.75v3.5M13 2.75v3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              {formatDate(job.applied_at)}
            </span>
          )}
          {job.job_url && (
            <a className="job-posting-link" href={job.job_url} target="_blank" rel="noreferrer" aria-label="View posting">
              <span className="view-posting-text">View posting</span> <ExternalIcon />
            </a>
          )}
        </FitMeta>
        {job.notes && <AppNote notes={job.notes} auto={job.notes_auto} />}
      </div>

      {review ?? (
        <StatusStack
          job={journeyJob}
          folded={folded}
          busy={busy}
          cvBusy={cvBusy}
          onDownloadCv={onDownloadCv}
          onFoldChange={onFoldChange}
          onAddStep={onAddStep}
          onChangeStep={onChangeStep}
          onRemoveStep={onRemoveStep}
          onDelete={onDelete}
        />
      )}

      {footer}
    </li>
  );
}

export default memo(ApplicationCard);
