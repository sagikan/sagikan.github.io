import { describe, expect, it } from "vitest";
import { createMachine } from "../stateMachine";

const DOOR = {
  initial: "closed",
  states: {
    closed: { open: "open", lock: "locked" },
    open: { close: "closed" },
    locked: { unlock: ["closed", "locked"] }
  }
};

describe("createMachine", () => {
  const door = createMachine("door", DOOR);

  it.each([
    ["closed", "open", undefined, "open"],
    ["locked", "unlock", "closed", "closed"],
    ["locked", "unlock", "locked", "locked"]
  ])("moves from %s on %s (picking %s) to %s", (state, event, pick, expected) => {
    expect(door.next(state, event, pick)).toBe(expected);
    expect(door.can(state, event, pick)).toBe(true);
  });

  it.each([
    ["a move the state doesn't have", "open", "lock", undefined],
    ["an unknown state", "ajar", "close", undefined],
    ["a pick that isn't one of the move's states", "locked", "unlock", "open"],
    ["a name from the object prototype", "closed", "toString", undefined]
  ])("rejects %s", (_title, state, event, pick) => {
    expect(door.next(state, event, pick)).toBeNull();
    expect(door.can(state, event, pick)).toBe(false);
  });

  it("lists the states a move starts from", () => {
    expect(door.sources("close")).toEqual(["open"]);
    expect(door.sources("fly")).toEqual([]);
  });

  it("exposes its name, states and starting state", () => {
    expect(door).toMatchObject({ name: "door", initial: "closed", states: ["closed", "open", "locked"] });
  });

  it.each([
    ["a move to an unknown state", { initial: "a", states: { a: { go: "b" } } }, 'leads to unknown state "b"'],
    ["a list move with an unknown state", { initial: "a", states: { a: { go: ["a", "c"] } } }, 'leads to unknown state "c"'],
    ["an unknown starting state", { initial: "z", states: { a: {} } }, '"z" isn\'t a valid state']
  ])("refuses to build a machine with %s", (_title, table, message) => {
    expect(() => createMachine("broken", table)).toThrow(message);
  });
});
