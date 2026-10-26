import { useState } from "react";

// Input that turns entries into removable tags
function TagInput({ values, onChange, max, placeholder, label, splitOnComma = false }) {
  const [draft, setDraft] = useState("");
  const full = values.length >= max;

  // Adds the typed values as tags, up to the limit
  function add(raw) {
    const parts = (splitOnComma ? raw.split(",") : [raw]).map((part) => part.trim()).filter(Boolean);
    const next = [...values];

    for (const part of parts) {
      if (next.length < max && !next.some((value) => value.toLowerCase() === part.toLowerCase())) {
        next.push(part);
      }
    }

    onChange(next);
    setDraft("");
  }

  return (
    <div className="tag-field">
      <input
        value={draft}
        aria-label={label}
        disabled={full}
        placeholder={full ? `Limit reached` : placeholder}
        onChange={(event) => {
          const value = event.target.value;

          if (splitOnComma && value.includes(",")) add(value);
          else setDraft(value);
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
      {values.length > 0 && (
        <div className="tag-list">
          {values.map((value, index) => (
            <span className="tag" key={`${value}-${index}`} title={value}>
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
      )}
    </div>
  );
}

export default TagInput;
