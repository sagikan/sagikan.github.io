import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Stands in for any outside request a test forgot to mock
function blockedNetworkCall(input) {
  throw new Error(`Unmocked network call in a test: ${String(input?.url ?? input)}`);
}

beforeEach(() => {
  vi.stubGlobal("fetch", blockedNetworkCall);
});

afterEach(() => {
  cleanup();
});
