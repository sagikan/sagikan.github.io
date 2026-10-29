import { createRequire } from "node:module";
import { vi } from "vitest";

const require = createRequire(import.meta.url);
const dns = require("dns").promises;

// Makes every host name resolve to one public address
export function mockDns(address = "93.184.216.34") {
  return vi.spyOn(dns, "lookup").mockResolvedValue([{ address }]);
}

// Makes fetch return the responses in order, repeating the last one (each is built fresh, since a body reads once)
export function mockFetch(...makeResponses) {
  const fetchMock = vi.fn(async () => makeResponses[Math.min(fetchMock.mock.calls.length - 1, makeResponses.length - 1)]());

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

// Builds a JSON response
export function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" }, ...init });
}
