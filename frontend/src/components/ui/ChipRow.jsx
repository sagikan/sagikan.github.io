import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Marks a chip as shown or as moved to the menu (it stays in the row, out of the way, so its width can be measured)
function setOverflow(chip, overflow) {
  if (overflow) {
    chip.dataset.overflow = "true";
    chip.tabIndex = -1;
    chip.setAttribute("aria-hidden", "true");
  } else {
    delete chip.dataset.overflow;
    chip.removeAttribute("tabindex");
    chip.removeAttribute("aria-hidden");
  }
}

/* Row of filter chips that never wraps: the chips that don't fit move into a "⋮" menu. Each item has the chip itself
   (node) and how it looks and acts in the menu (menuLabel, onSelect, active) */
function ChipRow({ items, ...rowProps }) {
  const rowRef = useRef(null);
  const [firstHidden, setFirstHidden] = useState(items.length);
  const [open, setOpen] = useState(false);
  const hidden = items.slice(firstHidden);

  // Works out how many chips fit on the line next to the "⋮" button
  const fit = useCallback(() => {
    const row = rowRef.current;
    const chips = [...row.querySelectorAll(":scope > .chip")];
    const more = row.querySelector(":scope > .chip-more-wrap");

    // Chips and the button keep their natural width even when moved aside, so nothing is reset before measuring
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const widths = chips.map((chip) => chip.offsetWidth);
    const room = row.clientWidth;
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * (chips.length - 1);
    let count = chips.length;

    if (total > room) {
      count = 0;

      while (count < chips.length) {
        const used = widths.slice(0, count + 1).reduce((sum, width) => sum + width, 0) + more.offsetWidth + gap * (count + 1);

        if (used > room) {
          break;
        }

        count += 1;
      }
    }

    chips.forEach((chip, index) => setOverflow(chip, index >= count));
    more.dataset.idle = count === chips.length ? "true" : "false";
    setFirstHidden(count);

    if (count === chips.length) {
      setOpen(false);
    }
  }, []);

  useLayoutEffect(() => {
    fit();
  });

  useEffect(() => {
    const observer = new ResizeObserver(fit);
    observer.observe(rowRef.current);
    document.fonts?.ready.then(fit);

    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    // Closes the menu on a click elsewhere
    const close = (event) => {
      if (!rowRef.current.querySelector(".chip-more-wrap").contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", close);

    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div {...rowProps} className="chips" ref={rowRef}>
      {items.map((item) => item.node)}

      <span
        className="chip-more-wrap"
        data-idle="true"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <button
          type="button"
          className={`chip chip-more${hidden.some((item) => item.active) ? " active" : ""}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More filters"
          title="More filters"
          onClick={() => setOpen((current) => !current)}
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <circle cx="10" cy="4" r="1.7" fill="currentColor" />
            <circle cx="10" cy="10" r="1.7" fill="currentColor" />
            <circle cx="10" cy="16" r="1.7" fill="currentColor" />
          </svg>
        </button>

        {open && (
          <div className="chip-menu" role="menu">
            {hidden.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={`chip-menu-item${item.active ? " active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.menuLabel}
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

export default ChipRow;
