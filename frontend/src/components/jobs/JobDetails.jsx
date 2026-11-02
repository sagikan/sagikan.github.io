import { useEffect, useLayoutEffect, useRef, useState } from "react";
import CompanyAvatar from "../ui/CompanyAvatar";
import { formatDate } from "../../lib/api";
import { postingAge, scoreLevel } from "./jobInfo";
import { CalendarIcon, ExternalIcon, FreshnessCalendar, PinIcon } from "./JobIcons";

// Shows a posting date with its age on hover
export function PostedDate({ postedAt }) {
  return <span title={postingAge(postedAt).label}>{formatDate(postedAt)}</span>;
}

// Shows the match score as a ring that fills up when it first appears
export function ScoreRing({ score }) {
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true));

    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={`score-ring match-${scoreLevel(score)}`}
      style={{ "--score": filled ? score : 0 }}
      role="img"
      aria-label={`${score}% match`}
    >
      <span>{score}</span>
    </div>
  );
}

// Shows as many tags as fit on one line, with a count of the rest
function FitTags({ items, label }) {
  const listRef = useRef(null);
  const signature = items.map((item) => item.key).join("|");

  useLayoutEffect(() => {
    const list = listRef.current;

    if (!list) {
      return undefined;
    }

    // Hides the tags that don't fit and counts them in the last chip
    const fit = () => {
      const tags = [...list.querySelectorAll("[data-tag]")];
      const more = list.querySelector("[data-more]");
      const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
      let used = 0;
      let shown = 0;

      tags.forEach((tag) => {
        tag.style.display = "";
      });
      more.style.display = "";
      more.textContent = `+${tags.length}`;

      const moreWidth = more.offsetWidth;

      for (const [index, tag] of tags.entries()) {
        const next = used + (index ? gap : 0) + tag.offsetWidth;
        const reserve = index < tags.length - 1 ? gap + moreWidth : 0;

        if (next + reserve > list.clientWidth) {
          break;
        }

        used = next;
        shown = index + 1;
      }

      tags.forEach((tag, index) => {
        tag.style.display = index < shown ? "" : "none";
      });

      const hidden = tags.slice(shown);

      more.style.display = hidden.length ? "" : "none";
      more.textContent = `+${hidden.length}`;
      more.title = hidden.map((tag) => tag.dataset.tag).join(", ");
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);

    fit();
    observer?.observe(list);

    return () => observer?.disconnect();
  }, [signature]);

  return (
    <ul ref={listRef} className="job-skills job-skills-fit" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} data-tag={item.name} className={`skill skill-${item.kind}`}>
          <span className="visually-hidden">{item.kind === "have" ? "Have: " : "Missing: "}</span>{item.name}
        </li>
      ))}
      <li data-more className="skill skill-more" style={{ display: "none" }} />
    </ul>
  );
}

// Lists the matching and missing skills
export function MatchSkills({ job, split = false }) {
  const have = job.match_have || [];
  const missing = job.match_missing || [];

  if (have.length === 0 && missing.length === 0) {
    return job.match_reason ? <p className="job-reason">{job.match_reason}</p> : null;
  }

  if (!split) {
    const items = [
      ...have.map((name) => ({ key: `have-${name}`, kind: "have", name })),
      ...missing.map((name) => ({ key: `missing-${name}`, kind: "missing", name }))
    ];

    return <FitTags items={items} label="How your resume matches" />;
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

  return (
    <div className="job-skill-groups">
      {haveItems.length > 0 && <ul className="job-skills" aria-label="Skills you have">{haveItems}</ul>}
      {missingItems.length > 0 && <ul className="job-skills" aria-label="Skills you're missing">{missingItems}</ul>}
    </div>
  );
}

// Dialog with a job's full details
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
                  View posting <ExternalIcon />
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
                  <dt><PinIcon /><span className="visually-hidden">Location</span></dt>
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
                    {job.state === "applied" ? <CalendarIcon /> : <FreshnessCalendar level={postingAge(job.posted_at).level} />}
                    <span className="visually-hidden">Posted</span>
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
