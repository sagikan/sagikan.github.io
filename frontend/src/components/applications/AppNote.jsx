import { useEffect, useRef, useState } from "react";

// Note line that is cut off with an ellipsis when too long and opens in full on click
function AppNote({ notes, auto = false }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const expandable = clipped || open;

  useEffect(() => {
    if (open) {
      return undefined;
    }

    // Checks whether the text is wider than the line
    const measure = () => setClipped(ref.current.scrollWidth > ref.current.clientWidth);

    measure();
    window.addEventListener("resize", measure);

    return () => window.removeEventListener("resize", measure);
  }, [notes, open]);

  // Toggles the full note with Enter or Space
  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
    }
  }

  return (
    <p
      ref={ref}
      className={`app-notes${expandable ? " is-expandable" : ""}${open ? " is-open" : ""}`}
      {...(expandable && {
        role: "button",
        tabIndex: 0,
        "aria-expanded": open,
        title: open ? "Show less" : "Show the full note",
        onClick: () => setOpen((current) => !current),
        onKeyDown: handleKeyDown
      })}
    >
      {auto && (
        <svg className="app-note-sign" viewBox="0 0 20 20" width="13" height="13" role="img" aria-label="Added automatically">
          <title>Added automatically</title>
          <path d="M8.500 4l1.500 4.200 4.200 1.500-4.200 1.500L8.500 15.400 7 11.200 2.800 9.700 7 8.200zM15.500 2.500v3M14 4h3" fill="none" stroke="currentColor" strokeWidth="1.600" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {notes}
    </p>
  );
}

export default AppNote;
