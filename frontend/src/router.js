import { useEffect, useState } from "react";

function currentRoute() {
  return window.location.hash.replace(/^#/, "") || "/";
}

export function useHashRoute() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onChange = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
    };

    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

export function navigate(path) {
  window.location.hash = path;
}

export function redirect(path) {
  window.location.replace(`#${path}`);
}
