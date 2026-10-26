import { useCallback, useId, useRef, useState } from "react";
import { useDismiss } from "../../hooks/useDismiss";

// Dropdown for picking one of the given options, styled like the site's other menus
function SelectInput({ value, onChange, options, ...props }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const listId = useId();
  const selected = Math.max(0, options.findIndex((option) => option.value === value));

  // Closes the list
  const close = useCallback(() => setOpen(false), []);

  useDismiss(open, close, ref);

  // Opens the list with the current option highlighted
  function show() {
    setActive(selected);
    setOpen(true);
  }

  // Picks an option and closes the list
  function choose(index) {
    onChange(options[index].value);
    setOpen(false);
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

  return (
    <div className="dropdown" ref={ref}>
      <button
        {...props}
        type="button"
        className="select-trigger"
        onClick={() => (open ? close() : show())}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
      >
        <span className="select-value">{options[selected]?.label}</span>
      </button>
      {open && (
        <ul className="dropdown-list" id={listId} role="listbox">
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === selected}
              className={`dropdown-option${index === active ? " is-active" : ""}${index === selected ? " is-selected" : ""}`}
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
      )}
    </div>
  );
}

export default SelectInput;
