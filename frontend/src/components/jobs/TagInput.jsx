import { useState } from "react";
import CharCount from "../ui/CharCount";
import InsetCount from "../ui/InsetCount";
import { useSortable } from "../../hooks/useSortable";

// Input that turns entries into removable tags
function TagInput({ values, onChange, max, maxLength, showCount = false, isAdded, sortable = false, placeholder, label, splitOnComma = false }) {
  const [draft, setDraft] = useState("");
  const sort = useSortable(values, onChange, { flow: true });
  const full = values.length >= max;

  // Adds the typed values as tags, each cut to the character limit, up to the tag limit
  function add(raw) {
    const parts = (splitOnComma ? raw.split(",") : [raw]).map((part) => part.trim().slice(0, maxLength)).filter(Boolean);
    const next = [...values];

    for (const part of parts) {
      if (next.length < max && !next.some((value) => value.toLowerCase() === part.toLowerCase())) {
        next.push(part);
      }
    }

    onChange(next);
    setDraft("");
  }

  const input = (
    <input
      value={draft}
      aria-label={label}
      disabled={full}
      placeholder={full ? `Limit reached` : placeholder}
      onChange={(event) => {
        const value = event.target.value;

        // A comma list is split into tags first, so only a single tag is held to the character limit
        if (splitOnComma && value.includes(",")) add(value);
        else setDraft(value.slice(0, maxLength));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (draft.trim()) add(draft);
        } else if (event.key === "Backspace" && !draft && values.length) {
          onChange(values.slice(0, -1));
        }
      }}
      onBlur={() => draft.trim() && add(draft)}
    />
  );

  return (
    <div className="tag-field">
      {maxLength && !full ? <InsetCount value={draft} max={maxLength}>{input}</InsetCount> : input}
      {(values.length > 0 || showCount) && (
        <div className="tag-row">
          <div className="tag-list">
            {values.map((value, index) => (
              <span
                className={`tag${isAdded?.(value) ? " tag-added" : ""}${sortable ? " tag-sortable" : ""}${sort.dragging === index ? " is-dragging" : ""}`}
                key={value}
                title={value}
                {...(sortable ? {
                  ref: sort.itemRef(index),
                  tabIndex: 0,
                  "aria-label": `${value}. Drag to reorder, or use the arrow keys`,
                  ...sort.dragProps(index, { skipInteractive: true })
                } : {})}
              >
                {isAdded?.(value) && <span className="tag-plus" aria-label="Added">+</span>}
                <span className="tag-text">{value}</span>
                <button
                  type="button"
                  className="tag-remove"
                  aria-label={`Remove ${value}`}
                  onClick={() => onChange(values.filter((_, i) => i !== index))}
                >
                  <svg viewBox="0 0 20 20" width="10" height="10" aria-hidden="true">
                    <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
          {showCount && <CharCount count={values.length} max={max} />}
        </div>
      )}
    </div>
  );
}

export default TagInput;
