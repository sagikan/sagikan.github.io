import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "../useMediaQuery";

// Stands in for matchMedia with a query whose answer the test can change
function fakeMediaQuery(initial) {
  const listeners = new Set();
  const list = {
    matches: initial,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener)
  };

  vi.stubGlobal("matchMedia", vi.fn(() => list));

  return {
    listeners,
    change(matches) {
      list.matches = matches;
      listeners.forEach((listener) => listener());
    }
  };
}

describe("useMediaQuery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns whether the query matches, and follows changes", () => {
    const media = fakeMediaQuery(true);
    const { result } = renderHook(() => useMediaQuery("(max-width: 640px)"));

    act(() => media.change(false));

    expect(result.current).toBe(false);
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 640px)");
  });

  it("stops listening when unmounted", () => {
    const media = fakeMediaQuery(false);
    const { unmount } = renderHook(() => useMediaQuery("(max-width: 640px)"));

    unmount();

    expect(media.listeners.size).toBe(0);
  });

  it("returns false where media queries aren't supported", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useMediaQuery("(max-width: 640px)"));

    expect(result.current).toBe(false);
  });
});
