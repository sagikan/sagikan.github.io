import { useEffect, useRef, useState } from "react";

// Note line that is cut off with an ellipsis when too long and opens in full on click
function AppNote({ notes }) {
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
      <i>{notes}</i>
    </p>
  );
}

export default AppNote;
