// Shows an application status as a colored badge
function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      <span className="badge-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

export default StatusBadge;
