// Button that downloads the resume sent with an application, off while a download is under way
function CvButton({ job, busy, onDownload }) {
  return (
    <button
      type="button"
      className="icon-btn app-cv-btn"
      disabled={busy}
      onClick={() => onDownload(job)}
      aria-label={`Download the resume you sent to ${job.company}`}
      title="Download the resume you sent"
    >
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path d="M5.5 2.75h6l3.75 3.75v9.25a1.5 1.5 0 0 1-1.5 1.5h-8.25a1.5 1.5 0 0 1-1.5-1.5v-11.5a1.5 1.5 0 0 1 1.5-1.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M11.5 2.75v3.75h3.75M10 9v5M7.75 11.75 10 14l2.25-2.25" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export default CvButton;
