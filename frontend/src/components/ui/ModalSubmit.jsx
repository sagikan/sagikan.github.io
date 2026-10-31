import { useContext } from "react";
import { createPortal } from "react-dom";
import { ModalSlotContext } from "./modalSlot";

// Renders a form's submit button in the modal's header, next to the close button; plus adds a plus icon, which a spinner replaces while busy
function ModalSubmit({ formId, active = true, label, busy, plus = false, children, ...props }) {
  const slot = useContext(ModalSlotContext);

  if (!slot || !active) {
    return null;
  }

  return createPortal(
    <button type="submit" form={formId} className="btn btn-primary btn-compact" disabled={busy} aria-label={label} title={label} {...props}>
      {plus && (busy ? <span className="spinner spinner-sm" aria-hidden="true" /> : (
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
          <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ))}
      {children}
    </button>,
    slot
  );
}

export default ModalSubmit;
