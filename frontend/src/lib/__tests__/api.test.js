import { beforeEach, describe, expect, it, vi } from "vitest";

const API = "https://api.example.com";

// Loads the module fresh, since it reads the API address when it loads
async function freshModule() {
  vi.resetModules();
  vi.stubEnv("VITE_API_URL", API);

  return import("../api");
}

// Mocks fetch to answer with the given response
function mockFetch(response) {
  const fetchMock = vi.fn(async () => response);

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

// Builds a JSON response
function json(data, init = {}) {
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" }, ...init });
}

describe("constants", () => {
  it("uses the address from the environment", async () => {
    expect((await freshModule()).API_URL).toBe(API);
  });

  it("lists the application statuses and workplace types the server accepts", async () => {
    const { STATUSES, WORKPLACE_MODELS } = await freshModule();

    expect(STATUSES).toEqual(["Applied", "Interview", "Offer", "Rejected", "Withdrawn"]);
    expect(WORKPLACE_MODELS).toEqual(["On-site", "Hybrid", "Remote"]);
  });
});

describe("checkHealth", () => {
  it("returns the health report", async () => {
    const fetchMock = mockFetch(json({ status: "ok" }));
    const { checkHealth } = await freshModule();

    expect(await checkHealth()).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/api/health`);
  });

  it("throws when the API isn't healthy", async () => {
    mockFetch(new Response("down", { status: 503 }));
    const { checkHealth } = await freshModule();

    await expect(checkHealth()).rejects.toThrow("API request failed");
  });
});

describe("apiRequest", () => {
  it("sends a plain GET with the cookies and returns the response and its data", async () => {
    const reply = json({ applications: [] });
    const fetchMock = mockFetch(reply);
    const { apiRequest } = await freshModule();
    const result = await apiRequest("/api/applications");

    expect(fetchMock).toHaveBeenCalledWith(`${API}/api/applications`, { method: "GET", credentials: "include", headers: {}, body: undefined });
    expect(result.response).toBe(reply);
    expect(result.data).toEqual({ applications: [] });
  });

  it("sends the body as JSON, with the request's method", async () => {
    const fetchMock = mockFetch(json({}));
    const { apiRequest } = await freshModule();

    await apiRequest("/api/applications", { method: "POST", body: { company: "Acme" } });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{\"company\":\"Acme\"}"
    });
  });

  it("sends an empty body that isn't undefined, such as null or false", async () => {
    const fetchMock = mockFetch(json({}));
    const { apiRequest } = await freshModule();

    await apiRequest("/api/x", { method: "PATCH", body: null });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { "Content-Type": "application/json" }, body: "null" });
  });

  it("sends the CSRF token when there is one", async () => {
    const fetchMock = mockFetch(json({}));
    const { apiRequest } = await freshModule();

    await apiRequest("/api/applications/1", { method: "DELETE", csrfToken: "token-1" });

    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "X-CSRF-Token": "token-1" });
  });

  it("returns empty data when the response isn't JSON, and still returns the response", async () => {
    mockFetch(new Response("Bad gateway", { status: 502 }));
    const { apiRequest } = await freshModule();
    const { response, data } = await apiRequest("/api/applications");

    expect(response.status).toBe(502);
    expect(data).toEqual({});
  });

  it("passes on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const { apiRequest } = await freshModule();

    await expect(apiRequest("/api/applications")).rejects.toThrow("Failed to fetch");
  });
});

describe("apiUpload", () => {
  const file = new File(["%PDF-"], "my résumé.pdf", { type: "application/pdf" });

  it("sends the file as the body of a PUT, with its encoded name and the CSRF token", async () => {
    const fetchMock = mockFetch(json({ ok: true }));
    const { apiUpload } = await freshModule();
    const { data } = await apiUpload("/api/profile/cv", file, { csrfToken: "token-1" });

    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/api/profile/cv`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/pdf", "X-CSRF-Token": "token-1", "X-File-Name": "my%20r%C3%A9sum%C3%A9.pdf" },
      body: file
    });
  });

  it("uses the given method", async () => {
    const fetchMock = mockFetch(json({}));
    const { apiUpload } = await freshModule();

    await apiUpload("/api/profile/grades", file, { csrfToken: "t", method: "POST" });

    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("returns empty data when the response isn't JSON", async () => {
    mockFetch(new Response("", { status: 413 }));
    const { apiUpload } = await freshModule();
    const { response, data } = await apiUpload("/api/profile/cv", file, { csrfToken: "t" });

    expect(response.status).toBe(413);
    expect(data).toEqual({});
  });
});

describe("apiFile", () => {
  it("returns the file's bytes and its decoded name", async () => {
    const fetchMock = mockFetch(new Response(new Uint8Array([1, 2, 3]), { headers: { "X-File-Name": "my%20r%C3%A9sum%C3%A9.pdf" } }));
    const { apiFile } = await freshModule();

    expect(await apiFile("/api/jobs/grade-sheet")).toEqual({ bytes: new Uint8Array([1, 2, 3]), fileName: "my résumé.pdf" });
    expect(fetchMock).toHaveBeenCalledWith(`${API}/api/jobs/grade-sheet`, { credentials: "include" });
  });

  it("returns nothing when the file isn't there", async () => {
    mockFetch(new Response("missing", { status: 404 }));
    const { apiFile } = await freshModule();

    expect(await apiFile("/api/jobs/grade-sheet")).toBeNull();
  });

  it.each([
    ["no name header", {}],
    ["a name that can't be decoded", { "X-File-Name": "%E0%A4%A" }]
  ])("returns an empty name for %s", async (_title, headers) => {
    mockFetch(new Response(new Uint8Array([9]), { headers }));
    const { apiFile } = await freshModule();

    expect(await apiFile("/api/jobs/grade-sheet")).toEqual({ bytes: new Uint8Array([9]), fileName: "" });
  });
});

describe("dates", () => {
  let api;

  beforeEach(async () => {
    api = await freshModule();
  });

  describe("toDateInput", () => {
    it.each([
      ["a full timestamp", "2026-05-01T10:30:00.000Z", "2026-05-01"],
      ["a plain date", "2026-05-01", "2026-05-01"],
      ["null", null, ""],
      ["an empty string", "", ""],
      ["undefined", undefined, ""]
    ])("turns %s into %j", (_title, value, expected) => {
      expect(api.toDateInput(value)).toBe(expected);
    });
  });

  describe("localISO", () => {
    it("writes a date in local time, padded", () => {
      expect(api.localISO(new Date(2026, 0, 5))).toBe("2026-01-05");
      expect(api.localISO(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    });
  });

  describe("jobDay", () => {
    it("uses the day the application was made", () => {
      expect(api.jobDay({ applied_at: "2026-05-01", created_at: "2026-06-01T00:00:00Z" })).toBe("2026-05-01");
    });

    it("falls back to the day it was added, in local time", () => {
      expect(api.jobDay({ applied_at: null, created_at: new Date(2026, 4, 3, 23, 30).toISOString() })).toBe("2026-05-03");
    });

    it("returns an empty string when it has neither", () => {
      expect(api.jobDay({ applied_at: null, created_at: null })).toBe("");
    });
  });

  describe("formatDate", () => {
    it("formats the day for the reader's locale, without shifting it across time zones", () => {
      const expected = new Date(2026, 9, 29).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

      expect(api.formatDate("2026-10-29")).toBe(expected);
      expect(api.formatDate("2026-10-29T23:59:59.000Z")).toBe(expected);
    });

    it.each([null, undefined, ""])("returns an empty string for %j", (value) => {
      expect(api.formatDate(value)).toBe("");
    });
  });
});
