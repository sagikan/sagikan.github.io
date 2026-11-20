import { useLayoutEffect, useRef, useState } from "react";

const SLACK_PX = 4;

// Returns an element's flex gap in pixels
function gapOf(element) {
  return Number.parseFloat(getComputedStyle(element).columnGap) || 0;
}

/* Tells whether a row of buttons must drop its optional labels (marked data-drop-label) to stay on one line. The
   labels' widths are remembered while they show, so once dropped the row knows when there's room to bring them back.
   layoutKey should change whenever buttons come or go, since the row's own size doesn't change then */
export function useCompactRow(rowRef, layoutKey = "") {
  const [compact, setCompact] = useState(false);
  const labels = useRef(0);

  useLayoutEffect(() => {
    const row = rowRef.current;

    if (!row) {
      return undefined;
    }

    // Compares the room in the row with the width its buttons need with their labels showing
    const check = () => {
      const shown = [...row.querySelectorAll("[data-drop-label]")].filter((label) => label.offsetWidth > 0);
      const items = [...row.children];
      const style = getComputedStyle(row);
      const room = row.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
      const used = items.reduce((sum, item) => sum + item.offsetWidth, 0) + gapOf(row) * (items.length - 1);

      if (shown.length) {
        labels.current = shown.reduce((sum, label) => sum + label.offsetWidth + gapOf(label.parentElement), 0);
      }

      setCompact(used + (shown.length ? 0 : labels.current) + SLACK_PX > room);
    };

    check();
    const observer = new ResizeObserver(check);
    observer.observe(row);
    [...row.children].forEach((item) => observer.observe(item));

    return () => observer.disconnect();
  }, [rowRef, layoutKey]);

  return compact;
}
