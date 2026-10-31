import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Stands in for any outside request a test forgot to mock
function blockedNetworkCall(input) {
  throw new Error(`Unmocked network call in a test: ${String(input?.url ?? input)}`);
}

// Stands in for the dialog methods that jsdom does not have
function installDialogMethods() {
  const dialog = window.HTMLDialogElement.prototype;

  dialog.showModal ??= function showModal() {
    this.setAttribute("open", "");
  };
  dialog.close ??= function close() {
    this.removeAttribute("open");
  };
}

installDialogMethods();

beforeEach(() => {
  vi.stubGlobal("fetch", blockedNetworkCall);
});

afterEach(() => {
  cleanup();
});
