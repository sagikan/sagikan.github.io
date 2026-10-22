import { useEffect } from "react";

// Closes a small menu when the user clicks outside `ref` or presses Escape. Escape is stopped
// there, so it closes only the menu and not a window the menu sits in.
export function useDismiss(open, close, ref) {
  useEffect(() => {
    if (!open) return undefined;

    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close, ref]);
}
