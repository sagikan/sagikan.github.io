import { formatDate, jobDay } from "../../lib/api";
import Alert from "../ui/Alert";

// Warns that an application for the same position and company already exists; with onRevert it also offers to withdraw the note the warning filled in
function DuplicateWarning({ duplicate, onRevert }) {
  if (!duplicate) {
    return null;
  }

  const day = formatDate(jobDay(duplicate));
  const message = duplicate.status === "Rejected"
    ? `You were rejected for this position after applying on ${day}.`
    : `You applied to this position on ${day}.`;

  return (
    <Alert
      key={duplicate.id}
      type="warning"
      className="duplicate-warning"
      action={onRevert && (
        <button
          type="button"
          className="icon-btn alert-close"
          aria-label="Revert changes"
          title="Revert changes"
          onClick={onRevert}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M4 8h8a4 4 0 0 1 0 8H8M7 5L4 8l3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    >
      <span className="duplicate-message" title={message}>{message}</span>
    </Alert>
  );
}

export default DuplicateWarning;
