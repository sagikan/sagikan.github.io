import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createMachine, TransitionError } = require("../stateMachine");

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
    ["open", "close", undefined, "closed"],
    ["locked", "unlock", "closed", "closed"],
    ["locked", "unlock", "locked", "locked"]
  ])("moves from %s on %s (picking %s) to %s", (state, event, pick, expected) => {
    expect(door.next(state, event, pick)).toBe(expected);
    expect(door.move(state, event, pick)).toBe(expected);
    expect(door.can(state, event, pick)).toBe(true);
  });

  it.each([
    ["a move the state doesn't have", "open", "lock", undefined],
    ["an unknown state", "ajar", "close", undefined],
    ["a pick that isn't one of the move's states", "locked", "unlock", "open"],
    ["a list move without a pick", "locked", "unlock", undefined],
    ["a name from the object prototype", "closed", "constructor", undefined]
  ])("rejects %s", (_title, state, event, pick) => {
    expect(door.next(state, event, pick)).toBeNull();
    expect(door.can(state, event, pick)).toBe(false);
    expect(() => door.move(state, event, pick)).toThrow(TransitionError);
  });

  it("names the machine, state and move in the error", () => {
    expect(() => door.move("open", "lock")).toThrow('door: "lock" isn\'t allowed from "open"');
  });

  it("lists the states a move starts from and leads to", () => {
    expect(door.sources("close")).toEqual(["open"]);
    expect(door.sources("unlock")).toEqual(["locked"]);
    expect(door.targets("unlock")).toEqual(["closed", "locked"]);
    expect(door.sources("fly")).toEqual([]);
  });

  it("exposes its name, states and starting state", () => {
    expect(door).toMatchObject({ name: "door", initial: "closed", states: ["closed", "open", "locked"] });
  });

  it("quotes states for SQL and refuses anything else", () => {
    expect(door.sqlList(["open", "locked"])).toBe("'open', 'locked'");
    expect(() => door.sqlList(["open'; DROP TABLE users; --"])).toThrow("isn't a valid state");
  });

  it.each([
    ["a move to an unknown state", { states: { a: { go: "b" } } }, 'leads to unknown state "b"'],
    ["a list move with an unknown state", { states: { a: { go: ["a", "c"] } } }, 'leads to unknown state "c"'],
    ["an unknown starting state", { initial: "z", states: { a: {} } }, '"z" isn\'t a valid state'],
    ["a state name that isn't safe in SQL", { states: { "a b": {} } }, '"a b" isn\'t a valid state']
  ])("refuses to build a machine with %s", (_title, table, message) => {
    expect(() => createMachine("broken", table)).toThrow(message);
  });

  it("accepts several starting states", () => {
    expect(createMachine("door", { ...DOOR, initial: ["closed", "locked"] }).initial).toEqual(["closed", "locked"]);
  });
});
