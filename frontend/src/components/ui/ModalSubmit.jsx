import { useContext } from "react";
import { createPortal } from "react-dom";
import ButtonIcon from "./ButtonIcon";
import { ModalSlotContext } from "./modalSlot";

// Renders a form's submit button in the modal's header, next to the close button, with an optional icon
function ModalSubmit({ formId, active = true, label, busy, icon, children, ...props }) {
  const slot = useContext(ModalSlotContext);

  if (!slot || !active) {
    return null;
  }

  return createPortal(
    <button type="submit" form={formId} className="btn btn-primary btn-compact" disabled={busy} aria-label={label} title={label} {...props}>
      {icon && <ButtonIcon name={icon} busy={busy} />}
      {children}
    </button>,
    slot
  );
}

export default ModalSubmit;
