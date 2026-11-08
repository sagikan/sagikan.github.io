import { useCallback, useState } from "react";

// Holds a state that only changes by the moves its machine allows; a move that isn't allowed is ignored
export function useMachine(machine) {
  const [state, setState] = useState(machine.initial);
  const send = useCallback((event, pick) => {
    setState((current) => {
      const next = machine.next(current, event, pick);

      if (next === null) {
        if (import.meta.env.DEV) {
          console.warn(`${machine.name}: "${event}" isn't allowed from "${current}"`);
        }

        return current;
      }

      return next;
    });
  }, [machine]);

  return [state, send];
}
