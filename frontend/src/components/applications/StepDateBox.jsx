import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "../../hooks/useDismiss";
import { checkDate, dateBounds } from "../../utils/applications/applicationMachines";
import { popupPlace } from "../../utils/layout/pageZoom";

const GAP = 6;

/* A one-row popup under a step's date (above it when the window has no room below) for picking when the step
   happened, kept between the steps on either side and never after today, except a current interview, which may be
   set up to three months ahead. Save stays off until a new valid date is picked; Escape, a click outside, scrolling or
   resizing the window closes it, as with the dropdowns */
function StepDateBox({ anchor, steps, index, today, onSave, onClose }) {
  const [value, setValue] = useState(steps[index].date);
  const [place, setPlace] = useState(null);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const { min, max } = dateBounds(steps, index, today);
  const { valid, savable } = checkDate(steps, index, value, today);
  const status = steps[index].status;

  useDismiss(true, onClose, [ref, { current: anchor }]);

  useEffect(() => {
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);

    return () => {
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    setPlace(popupPlace(anchor, ref.current, GAP));
    inputRef.current.focus({ preventScroll: true });
  }, [anchor]);

  // Saves the picked date when it can be saved
  function save() {
    if (savable) {
      onSave(value);
    }
  }

  return createPortal(
    <div
      ref={ref}
      className="date-box"
      role="dialog"
      aria-label={`Change the ${status} date`}
      style={place ? { top: place.top, left: place.left } : { visibility: "hidden" }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          save();
        }
      }}
    >
      <div className="date-row">
        <input
          ref={inputRef}
          type="date"
          value={value}
          min={min}
          max={max}
          aria-label={`${status} date`}
          aria-invalid={!valid}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="button" className="btn btn-primary btn-sm" disabled={!savable} onClick={save}>
          Save
        </button>
      </div>
    </div>,
    document.body
  );
}

export default StepDateBox;
