import { useEffect, useState } from "react";

// Tells whether a media query matches now, and re-renders when that changes; false where media queries aren't supported
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => Boolean(window.matchMedia?.(query).matches));

  useEffect(() => {
    const list = window.matchMedia?.(query);

    if (!list) return undefined;

    // Follows the query's current answer
    const update = () => setMatches(list.matches);

    update();
    list.addEventListener("change", update);

    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}
