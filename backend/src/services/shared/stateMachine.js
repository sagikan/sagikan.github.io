const NAME_PATTERN = /^[A-Za-z_]+$/;

// Error for a move that a state machine doesn't allow
class TransitionError extends Error {
  constructor(machine, state, event) {
    super(`${machine}: "${event}" isn't allowed from "${state}"`);
    this.state = state;
    this.event = event;
  }
}

/* Builds a state machine from a table of moves, { state: { event: next } }. A move's next state is one state,
   or a list of states when the outcome depends on data the machine doesn't hold: the caller then picks one of them */
function createMachine(name, { initial, states }) {
  const names = Object.keys(states);

  for (const state of [...names, ...[initial ?? []].flat()]) {
    if (!NAME_PATTERN.test(state) || !Object.hasOwn(states, state)) {
      throw new Error(`${name}: "${state}" isn't a valid state`);
    }
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

  // Returns the state a move leads to, throwing when the move isn't allowed
  function move(state, event, pick) {
    const target = next(state, event, pick);

    if (target === null) {
      throw new TransitionError(name, state, event);
    }

    return target;
  }

  // Lists the states a move can start from
  function sources(event) {
    return names.filter((state) => Object.hasOwn(states[state], event));
  }

  // Lists the states a move can lead to
  function targets(event) {
    return [...new Set(sources(event).flatMap((state) => [states[state][event]].flat()))];
  }

  // Quotes states for an SQL list; safe because every state name was checked against NAME_PATTERN
  function sqlList(list) {
    return list.map((state) => {
      if (!Object.hasOwn(states, state)) {
        throw new Error(`${name}: "${state}" isn't a valid state`);
      }

      return `'${state}'`;
    }).join(", ");
  }

  return { name, initial, states: names, next, move, can: (state, event, pick) => next(state, event, pick) !== null, sources, targets, sqlList };
}

module.exports = { createMachine, TransitionError };
