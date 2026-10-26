import { useId, useState } from "react";

const MAX_SHOWN = 8;

// Trims and lowercases text for comparison
function keyOf(value) {
  return value.trim().toLowerCase();
}

// Lists the suggestions that contain the typed text, those starting with it first
function matchesFor(suggestions, value) {
  const query = keyOf(value);
  const matching = suggestions.filter((suggestion) => keyOf(suggestion) !== query && keyOf(suggestion).includes(query));
  const starting = matching.filter((suggestion) => keyOf(suggestion).startsWith(query));
  const rest = matching.filter((suggestion) => !keyOf(suggestion).startsWith(query));

  return [...starting, ...rest].slice(0, MAX_SHOWN);
}

// Shows a suggestion with the typed part in bold
function Highlighted({ text, query }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;

  if (at === -1) {
    return text;
  }

  return (
    <>
      {text.slice(0, at)}
      <strong>{text.slice(at, at + query.length)}</strong>
      {text.slice(at + query.length)}
    </>
  );
}

// Text input with a dropdown of earlier values that match what's typed
function AutocompleteInput({ value, onChange, suggestions, ...props }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const matches = open ? matchesFor(suggestions, value) : [];
  const shown = matches.length > 0;

  // Closes the list
  function close() {
    setOpen(false);
    setActive(-1);
  }

  // Fills in a suggestion and closes the list
  function choose(suggestion) {
    onChange(suggestion);
    close();
  }

  // Updates the value and shows the matching suggestions
  function handleChange(event) {
    onChange(event.target.value);
    setOpen(true);
    setActive(-1);
  }

  // Moves through the list with the arrow keys, picks with Enter and closes with Escape
  function handleKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (!shown) {
        setOpen(true);

        return;
      }

      const next = active + (event.key === "ArrowDown" ? 1 : -1);
      setActive(next >= matches.length ? -1 : next < -1 ? matches.length - 1 : next);
    } else if (event.key === "Enter" && shown && active >= 0) {
      event.preventDefault();
      choose(matches[active]);
    } else if (event.key === "Escape" && shown) {
      // Stops the Escape here, so it closes only the list and not the window around it
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  return (
    <div className="dropdown">
      <input
        {...props}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={close}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
      />
      {shown && (
        <ul className="dropdown-list" id={listId} role="listbox">
          {matches.map((suggestion, index) => (
            <li
              key={suggestion}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={`dropdown-option${index === active ? " is-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(suggestion)}
            >
              <Highlighted text={suggestion} query={keyOf(value)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AutocompleteInput;
