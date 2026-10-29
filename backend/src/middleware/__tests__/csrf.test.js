import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { mockResponse } from "../../../tests/helpers/http";

const require = createRequire(import.meta.url);
const { allowedOrigins, csrfOriginProtection, requireCsrf, requireTrustedOrigin } = require("../csrf");

const SITE = "https://app.example.com";

// Runs a middleware on a request with the given method, headers and user
function run(middleware, { method = "POST", headers = {}, user } = {}) {
  const req = { method, user, get: (name) => headers[name] };
  const res = mockResponse();
  const next = vi.fn();

  middleware(req, res, next);

  return { res, next };
}

describe("allowedOrigins", () => {
  it("allows the site and the local dev server outside production", () => {
    vi.stubEnv("FRONTEND_ORIGIN", SITE);

    expect(allowedOrigins()).toEqual(["http://localhost:5173", SITE]);
  });

  it("allows only the site in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRONTEND_ORIGIN", SITE);

    expect(allowedOrigins()).toEqual([SITE]);
  });

  it("allows nothing in production when no site is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRONTEND_ORIGIN", "");

    expect(allowedOrigins()).toEqual([]);
  });
});

describe("requireTrustedOrigin", () => {
  it("lets a request from an allowed origin through", () => {
    vi.stubEnv("FRONTEND_ORIGIN", SITE);

    const { next, res } = run(requireTrustedOrigin, { headers: { Origin: SITE } });

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ["no origin", {}],
    ["another site", { Origin: "https://evil.example.com" }],
    ["the site with another port", { Origin: "https://app.example.com:8443" }],
    ["the site over http", { Origin: "http://app.example.com" }],
    ["a look-alike", { Origin: "https://app.example.com.evil.com" }],
    ["the string null", { Origin: "null" }]
  ])("refuses a request with %s", (_title, headers) => {
    vi.stubEnv("FRONTEND_ORIGIN", SITE);

    const { next, res } = run(requireTrustedOrigin, { headers });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Untrusted request origin." });
  });
});

describe("csrfOriginProtection", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("lets a %s through without checking the origin", (method) => {
    const { next, res } = run(csrfOriginProtection, { method });

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("checks the origin of a %s", (method) => {
    vi.stubEnv("FRONTEND_ORIGIN", SITE);

    expect(run(csrfOriginProtection, { method, headers: { Origin: SITE } }).next).toHaveBeenCalledOnce();

    const refused = run(csrfOriginProtection, { method, headers: { Origin: "https://evil.example.com" } });

    expect(refused.next).not.toHaveBeenCalled();
    expect(refused.res.status).toHaveBeenCalledWith(403);
  });

  it("refuses a state-changing request with no origin at all", () => {
    vi.stubEnv("FRONTEND_ORIGIN", SITE);

    expect(run(csrfOriginProtection, { method: "POST" }).res.status).toHaveBeenCalledWith(403);
  });
});

describe("requireCsrf", () => {
  const user = { csrfToken: "token-1" };

  it.each(["GET", "HEAD", "OPTIONS"])("doesn't ask for the token on a %s", (method) => {
    expect(run(requireCsrf, { method, user }).next).toHaveBeenCalledOnce();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("lets a %s with the matching token through", (method) => {
    const { next, res } = run(requireCsrf, { method, user, headers: { "X-CSRF-Token": "token-1" } });

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ["no token", {}, user],
    ["the wrong token", { "X-CSRF-Token": "token-2" }, user],
    ["a token of another length", { "X-CSRF-Token": "token-11" }, user],
    ["an empty token", { "X-CSRF-Token": "" }, user],
    ["no signed-in user", { "X-CSRF-Token": "token-1" }, undefined],
    ["a user without a token", { "X-CSRF-Token": "undefined" }, {}]
  ])("refuses a POST with %s", (_title, headers, requester) => {
    const { next, res } = run(requireCsrf, { headers, user: requester });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid or missing CSRF token." });
  });
});
