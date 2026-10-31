import { useEffect, useRef, useState } from "react";
import { ModalSlotContext } from "./modalSlot";

// Dialog that closes on Escape or a backdrop click
function Modal({ title, onClose, children, wide = false }) {
  const dialogRef = useRef(null);
  const [actionsSlot, setActionsSlot] = useState(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();

    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`modal${wide ? " modal-wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-body">
        <div className="modal-header">
          <h2>{title}</h2>
          <div className="modal-header-end">
            <div className="modal-actions" ref={setActionsSlot} />
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <ModalSlotContext.Provider value={actionsSlot}>{children}</ModalSlotContext.Provider>
      </div>
    </dialog>
  );
}

export default Modal;
