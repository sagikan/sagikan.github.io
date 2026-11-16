import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "../../hooks/useDismiss";
import { popupPlace, unzoomedRect } from "../../utils/layout/pageZoom";

/* Dropdown for picking one of the given options, styled like the site's other menus. An option can be disabled
   (shown greyed out, never picked) or an action (set apart under a line). A floating list is drawn on the page body
   floatGap pixels under the trigger (above it when the window has no room below), so a clipped or folding parent
   never cuts it; scrolling closes it */
function SelectInput({
  value, onChange, options, className = "", required = false, openUp = false, fitWidest = false, floating = false, floatGap = 4, ...props
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState(null);
  const ref = useRef(null);
  const listRef = useRef(null);
  const triggerRef = useRef(null);
  const listId = useId();
  const selected = Math.max(0, options.findIndex((option) => option.value === value));

  // Closes the list
  const close = useCallback(() => setOpen(false), []);

  useDismiss(open, close, [ref, listRef]);

  useEffect(() => {
    if (!open || !floating) return undefined;

    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, floating, close]);

  // Places a floating list once it's drawn (hidden) at its full size
  useLayoutEffect(() => {
    if (open && floating && place && place.top === undefined) {
      setPlace({ ...place, ...popupPlace(triggerRef.current, listRef.current, floatGap) });
    }
  }, [open, floating, place, floatGap]);

  // Opens the list with the current option highlighted
  function show() {
    if (floating) {
      setPlace({ minWidth: unzoomedRect(triggerRef.current).width });
    }

    setActive(selected);
    setOpen(true);
  }

  // Picks an option and closes the list; a disabled option is ignored
  function choose(index) {
    const option = options[index];

    if (!option || option.disabled) {
      return;
    }

    setOpen(false);
    onChange(option.value, option);
  }

  // Opens with the arrow keys, moves through the list and picks with Enter or Space
  function handleKeyDown(event) {
    const last = options.length - 1;

    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        show();
      }

      return;
    }

    const moves = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last };

    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Tab") {
      close();
    }
  }

  const list = open && (
    <ul
      ref={listRef}
      className={`dropdown-list${openUp ? " dropdown-list-up" : ""}${floating ? " dropdown-list-floating" : ""}`}
      id={listId}
      role="listbox"
      style={floating && place ? { top: place.top ?? 0, left: place.left ?? 0, minWidth: place.minWidth, visibility: place.top === undefined ? "hidden" : undefined } : undefined}
    >
      {options.map((option, index) => (
        <li
          key={option.value}
          id={`${listId}-${index}`}
          role="option"
          aria-selected={index === selected}
          aria-disabled={option.disabled || undefined}
          className={[
            "dropdown-option",
            option.action ? "dropdown-action" : "",
            index === active ? "is-active" : "",
            index === selected ? "is-selected" : "",
            option.disabled ? "is-disabled" : ""
          ].filter(Boolean).join(" ")}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActive(index)}
          onClick={(event) => {
            // Stops the surrounding label from clicking the button again and reopening the list
            event.preventDefault();
            choose(index);
          }}
        >
          {option.label}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="dropdown" ref={ref}>
      <button
        {...props}
        ref={triggerRef}
        type="button"
        className={`select-trigger ${className}`.trim()}
        onClick={() => (open ? close() : show())}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
      >
        <span className="select-value">
          <span className="select-label" data-value={options[selected]?.value}>{options[selected]?.label}</span>
          {fitWidest && options.filter((option) => !option.action && !option.repeat).map((option) => (
            <span key={option.value} className="select-sizer" aria-hidden="true">{option.label}</span>
          ))}
        </span>
      </button>
      {required && <input className="select-required" tabIndex={-1} aria-hidden="true" value={value} onChange={() => {}} required />}
      {floating && list ? createPortal(list, document.body) : list}
    </div>
  );
}

export default SelectInput;
