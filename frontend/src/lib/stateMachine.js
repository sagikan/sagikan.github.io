/* Builds a state machine from a table of moves, { state: { event: next } }. A move's next state is one state,
   or a list of states when the outcome depends on data the machine doesn't hold: the caller then picks one of them */
export function createMachine(name, { initial, states }) {
  const names = Object.keys(states);

  if (!Object.hasOwn(states, initial)) {
    throw new Error(`${name}: "${initial}" isn't a valid state`);
  }

  for (const [state, moves] of Object.entries(states)) {
    for (const [event, next] of Object.entries(moves)) {
      for (const target of [next].flat()) {
        if (!Object.hasOwn(states, target)) {
          throw new Error(`${name}: "${event}" from "${state}" leads to unknown state "${target}"`);
        }
      }
    }
  }

  // Returns the state a move leads to, or null when the move isn't allowed
  function next(state, event, pick) {
    const target = Object.hasOwn(states, state) && Object.hasOwn(states[state], event) ? states[state][event] : undefined;

    if (Array.isArray(target)) {
      return target.includes(pick) ? pick : null;
    }

    return target ?? null;
  }

  // Lists the states a move can start from
  function sources(event) {
    return names.filter((state) => Object.hasOwn(states[state], event));
  }

  return { name, initial, states: names, next, can: (state, event, pick) => next(state, event, pick) !== null, sources };
}
