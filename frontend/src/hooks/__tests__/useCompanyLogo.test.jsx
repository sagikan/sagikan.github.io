import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Loads the hook fresh, since it keeps the logos it has loaded for the session
async function freshHook() {
  vi.resetModules();
  vi.stubEnv("VITE_API_URL", "https://api.example.com");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((blob) => `blob:${blob.size}`) }));

  return (await import("../useCompanyLogo")).useCompanyLogo;
}

// Mocks fetch to answer each call with the next response, repeating the last
function mockFetch(...makeResponses) {
  const fetchMock = vi.fn(async () => makeResponses[Math.min(fetchMock.mock.calls.length - 1, makeResponses.length - 1)]());

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

// Builds a logo response of the given size
const logo = (size = 3) => () => new Response(new Uint8Array(size), { headers: { "content-type": "image/png" } });

// Lets pending promises finish
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useCompanyLogo", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a URL for a company's logo once it has loaded", async () => {
    mockFetch(logo());

    const useCompanyLogo = await freshHook();
    const { result } = renderHook(() => useCompanyLogo("Orbit"));

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe("blob:3"));
  });

  it("stays null for a company with no logo", async () => {
    const fetchMock = mockFetch(() => new Response(null, { status: 204 }));
    const useCompanyLogo = await freshHook();
    const { result } = renderHook(() => useCompanyLogo("Nobody"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await settle();

    expect(result.current).toBeNull();
  });

  it.each(["", "   ", undefined])("asks for nothing for the company %j", async (company) => {
    const fetchMock = mockFetch(logo());
    const useCompanyLogo = await freshHook();
    const { result } = renderHook(() => useCompanyLogo(company));

    await settle();

    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks once for a company shown in several places, whatever the letter case or spacing", async () => {
    const fetchMock = mockFetch(logo());
    const useCompanyLogo = await freshHook();
    const first = renderHook(() => useCompanyLogo("Orbit"));
    const second = renderHook(() => useCompanyLogo("  orbit "));

    await waitFor(() => expect(first.result.current).toBe("blob:3"));
    await waitFor(() => expect(second.result.current).toBe("blob:3"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("remembers that a company has no logo for the rest of the session", async () => {
    const fetchMock = mockFetch(() => new Response(null, { status: 204 }));
    const useCompanyLogo = await freshHook();
    const first = renderHook(() => useCompanyLogo("Nobody"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.unmount();
    renderHook(() => useCompanyLogo("Nobody"));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a server error", () => new Response("oops", { status: 500 })],
    ["a rate limit", () => new Response("busy", { status: 429 })],
    ["an ended session", () => new Response("no", { status: 401 })],
    ["a lost connection", () => Promise.reject(new TypeError("network"))]
  ])("tries again next time after %s", async (_title, failure) => {
    const fetchMock = mockFetch(failure, logo());
    const useCompanyLogo = await freshHook();
    const first = renderHook(() => useCompanyLogo("Orbit"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await settle();

    expect(first.result.current).toBeNull();
    first.unmount();

    const second = renderHook(() => useCompanyLogo("Orbit"));

    await waitFor(() => expect(second.result.current).toBe("blob:3"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows nothing for a new company until its own logo has loaded", async () => {
    mockFetch(logo(3), logo(5));

    const useCompanyLogo = await freshHook();
    const { result, rerender } = renderHook(({ company }) => useCompanyLogo(company), { initialProps: { company: "Orbit" } });

    await waitFor(() => expect(result.current).toBe("blob:3"));
    rerender({ company: "Pinnacle" });

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe("blob:5"));
  });

  it("ignores an answer that arrives after the company changed", async () => {
    let finishFirst;
    const first = new Promise((resolve) => {
      finishFirst = () => resolve(logo(3)());
    });

    mockFetch(() => first, logo(2));

    const useCompanyLogo = await freshHook();
    const { result, rerender } = renderHook(({ company }) => useCompanyLogo(company), { initialProps: { company: "Orbit" } });

    rerender({ company: "Pinnacle" });
    await waitFor(() => expect(result.current).toBe("blob:2"));
    finishFirst();
    await settle();

    expect(result.current).toBe("blob:2");
  });
});
