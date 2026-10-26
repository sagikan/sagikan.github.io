import { useState } from "react";

const ROLES = { error: "alert", warning: "status", success: "status" };

// Message box that can be dismissed
function Alert({ type = "error", children, onDismiss, className = "" }) {
  const text = typeof children === "string" ? children : null;
  const [dismissed, setDismissed] = useState(undefined);

  if (dismissed !== undefined && (text === null || dismissed === text)) {
    return null;
  }

  return (
    <div className={`alert alert-${type} alert-dismissible ${className}`.trim()} role={ROLES[type]}>
      <div className="alert-content">{children}</div>
      <button
        type="button"
        className="icon-btn alert-close"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(text);
          onDismiss?.();
        }}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default Alert;
