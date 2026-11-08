import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMachine } from "../../lib/stateMachine";
import { useMachine } from "../useMachine";

const LIGHT = createMachine("light", {
  initial: "off",
  states: {
    off: { switchOn: ["dim", "bright"] },
    dim: { switchOff: "off" },
    bright: { switchOff: "off" }
  }
});

describe("useMachine", () => {
  it("starts in the machine's starting state", () => {
    const { result } = renderHook(() => useMachine(LIGHT));

    expect(result.current[0]).toBe("off");
  });

  it("follows allowed moves, with the caller's pick for a list move", () => {
    const { result } = renderHook(() => useMachine(LIGHT));

    act(() => result.current[1]("switchOn", "bright"));
    const afterOn = result.current[0];
    act(() => result.current[1]("switchOff"));

    expect(afterOn).toBe("bright");
    expect(result.current[0]).toBe("off");
  });

  it("ignores a move that isn't allowed and warns about it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useMachine(LIGHT));

    act(() => result.current[1]("switchOff"));
    act(() => result.current[1]("switchOn", "blinding"));

    expect(result.current[0]).toBe("off");
    expect(warn).toHaveBeenCalledWith('light: "switchOff" isn\'t allowed from "off"');
  });

  it("keeps the same send function between renders", () => {
    const { result, rerender } = renderHook(() => useMachine(LIGHT));
    const send = result.current[1];

    rerender();

    expect(result.current[1]).toBe(send);
  });
});
