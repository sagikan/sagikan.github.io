import { useEffect, useState } from "react";

// Reads the route from the URL hash
function currentRoute() {
  return window.location.hash.replace(/^#/, "") || "/";
}

// Returns the current route and updates it on hash changes
export function useHashRoute() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    // Updates the route and scrolls to the top
    const onChange = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };

    window.addEventListener("hashchange", onChange);

    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

// Goes to a route
export function navigate(path) {
  window.location.hash = path;
}

// Goes to a route, replacing the current history entry
export function redirect(path) {
  window.location.replace(`#${path}`);
}
