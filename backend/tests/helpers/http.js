import { vi } from "vitest";

// Builds a stand-in for an Express response that records what was set on it
export function mockResponse() {
  const res = { cookie: vi.fn(), clearCookie: vi.fn(), status: vi.fn(), json: vi.fn() };

  res.status.mockReturnValue(res);

  return res;
}

// Reads the options of the last cookie set under a name
export function cookieOptions(res, name) {
  return res.cookie.mock.calls.findLast(([cookieName]) => cookieName === name)?.[2];
}

// Reads the value of the last cookie set under a name
export function cookieValue(res, name) {
  return res.cookie.mock.calls.findLast(([cookieName]) => cookieName === name)?.[1];
}
