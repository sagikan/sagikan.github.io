import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

const LAST_STEP = 3;
const TOLERANCE = 0.01;

/* Tells whether a text is shown shorter than it is, down to a fraction of a pixel (scrollWidth rounds, but the ellipsis
   appears even when the text is over by less than a pixel) */
function isTrimmed(text) {
  const range = document.createRange();
  range.selectNodeContents(text);

  return range.getBoundingClientRect().width > text.getBoundingClientRect().width + TOLERANCE;
}

// Tells whether anything in the row is trimmed or runs past its edge
function isCut(row) {
  const edge = row.getBoundingClientRect().right;
  const overflowing = [...row.children].some((item) => item.getClientRects().length > 0 && item.getBoundingClientRect().right > edge + TOLERANCE);

  return overflowing || [...row.querySelectorAll(".app-company, .app-location, .job-company, .job-location-text")].some(isTrimmed);
}

// Info line of a card (an application's or a job's) that gives up details one step at a time as the row runs out of room
function FitMeta({ as: Tag = "div", className = "app-meta", children }) {
  const rowRef = useRef(null);

  // Picks the first step at which nothing is cut off, where the last step leaves the text to be trimmed
  const fit = useCallback(() => {
    const row = rowRef.current;

    for (let step = 0; step <= LAST_STEP; step += 1) {
      row.dataset.fit = step;

      if (!isCut(row)) {
        return;
      }
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

  return (
    <Tag className={className} ref={rowRef} data-fit="0">
      {children}
    </Tag>
  );
}

export default FitMeta;
