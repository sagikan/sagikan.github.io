import { useEffect, useRef } from "react";
import CompanyAvatar from "../CompanyAvatar";
import { formatDate } from "../../api";
import { CALENDAR_ICON, EXTERNAL_ICON, PIN_ICON, postingAge, scoreLevel } from "./jobInfo";

const CARD_TAGS = 4;

export function PostedDate({ postedAt }) {
  return <span title={postingAge(postedAt).label}>{formatDate(postedAt)}</span>;
}

export function ScoreRing({ score }) {
  return (
    <div
      className={`score-ring match-${scoreLevel(score)}`}
      style={{ "--score": score }}
      role="img"
      aria-label={`${score}% match`}
    >
      <span>{score}</span>
    </div>
  );
}

export function MatchSkills({ job, split = false }) {
  const limit = split ? Infinity : CARD_TAGS;
  const have = (job.match_have || []).slice(0, limit);
  const missing = (job.match_missing || []).slice(0, limit);

  if (have.length === 0 && missing.length === 0) {
    return job.match_reason ? <p className="job-reason">{job.match_reason}</p> : null;
  }

  const haveItems = have.map((item) => (
    <li key={`have-${item}`} className="skill skill-have">
      <span className="visually-hidden">Have: </span>{item}
    </li>
  ));
  const missingItems = missing.map((item) => (
    <li key={`missing-${item}`} className="skill skill-missing">
      <span className="visually-hidden">Missing: </span>{item}
    </li>
  ));

  if (split) {
    return (
      <div className="job-skill-groups">
        {haveItems.length > 0 && <ul className="job-skills" aria-label="Skills you have">{haveItems}</ul>}
        {missingItems.length > 0 && <ul className="job-skills" aria-label="Skills you're missing">{missingItems}</ul>}
      </div>
    );
  }

  return (
    <ul className="job-skills" aria-label="How your resume matches">
      {haveItems}
      {missingItems}
    </ul>
  );
}

function JobDetails({ job, onClose }) {
  const dialogRef = useRef(null);
  const titleId = `job-details-${job.id}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="drawer"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="drawer-panel">
        <header className="drawer-header">
          <CompanyAvatar company={job.company} />
          <div className="job-heading">
            <h2 id={titleId} className="job-title">{job.position}</h2>
            <p className="drawer-company">
              {job.company}
              {job.url && (
                <a className="job-posting-link" href={job.url} target="_blank" rel="noreferrer">
                  View posting {EXTERNAL_ICON}
                </a>
              )}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="drawer-body">
          <div className="drawer-facts">
            {job.match_score !== null && <ScoreRing score={job.match_score} />}
            <dl>
              {(job.location || job.workplace_model) && (
                <>
                  <dt>{PIN_ICON}<span className="visually-hidden">Location</span></dt>
                  <dd>
                    {job.location}
                    {job.workplace_model && (
                      <span className={`app-tag workplace-tag mix-${job.workplace_model.toLowerCase()}`}>{job.workplace_model}</span>
                    )}
                  </dd>
                </>
              )}
              {job.posted_at && (
                <>
                  <dt className={job.state === "applied" ? "" : `posted-${postingAge(job.posted_at).level}`}>
                    {CALENDAR_ICON}<span className="visually-hidden">Posted</span>
                  </dt>
                  <dd><PostedDate postedAt={job.posted_at} /></dd>
                </>
              )}
            </dl>
          </div>

          <MatchSkills job={job} split />

          {job.description ? (
            <section>
              <h3 className="drawer-section-title">About the role</h3>
              <p className="drawer-description">{job.description}</p>
            </section>
          ) : (
            <p className="muted">No description was saved for this job. Use "View posting" to read it on the original site.</p>
          )}
        </div>
      </div>
    </dialog>
  );
}

export default JobDetails;
