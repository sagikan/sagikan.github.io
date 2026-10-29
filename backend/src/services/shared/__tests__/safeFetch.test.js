import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { mockDns, mockFetch } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const { isPublicAddress, safeFetch } = require("../safeFetch");

// Builds a redirect response
function redirect(location) {
  return () => new Response(null, { status: 302, headers: { location } });
}

// Builds a plain text response
function page(text, status = 200) {
  return () => new Response(text, { status });
}

describe("isPublicAddress", () => {
  it.each([
    ["a public IPv4 address", "8.8.8.8", true],
    ["a public IPv6 address", "2606:4700:4700::1111", true],
    ["an IPv4-mapped public address", "::ffff:8.8.8.8", true],
    ["the first address after a private range", "172.32.0.1", true],
    ["loopback", "127.0.0.1", false],
    ["IPv6 loopback", "::1", false],
    ["a 10.x address", "10.1.2.3", false],
    ["a 172.16.x address", "172.16.0.1", false],
    ["a 192.168.x address", "192.168.1.1", false],
    ["the cloud metadata address", "169.254.169.254", false],
    ["a carrier-grade NAT address", "100.64.0.1", false],
    ["an IPv6 unique local address", "fc00::1", false],
    ["an IPv6 link-local address", "fe80::1", false],
    ["an IPv4-mapped loopback address", "::ffff:127.0.0.1", false],
    ["a host name", "example.com", false],
    ["an empty string", "", false]
  ])("treats %s as public: %s", (_title, address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});

describe("safeFetch", () => {
  it("fetches a public page and returns its status, final URL and text", async () => {
    mockDns();
    const fetchMock = mockFetch(page("hello"));
    const response = await safeFetch("https://example.com/job");

    expect(response).toMatchObject({ status: 200, ok: true, url: "https://example.com/job" });
    expect(await response.text()).toBe("hello");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("reports an error status without throwing", async () => {
    mockDns();
    mockFetch(page("missing", 404));

    expect(await safeFetch("https://example.com/job")).toMatchObject({ status: 404, ok: false });
  });

  it("follows a redirect to another public address", async () => {
    mockDns();
    mockFetch(redirect("/moved"), page("moved page"));
    const response = await safeFetch("https://example.com/job");

    expect(response.url).toBe("https://example.com/moved");
    expect(await response.text()).toBe("moved page");
  });

  it.each([
    ["a non-web protocol", "ftp://example.com/file"],
    ["a link with credentials", "https://user:pass@example.com/"],
    ["a non-standard port", "https://example.com:8443/"],
    ["a loopback address", "http://127.0.0.1/admin"],
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data"],
    ["a bracketed IPv6 loopback address", "http://[::1]/"]
  ])("refuses %s", async (_title, url) => {
    mockDns();
    const fetchMock = mockFetch(page("secret"));

    await expect(safeFetch(url)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a host name that resolves to a private address", async () => {
    mockDns("10.0.0.5");
    const fetchMock = mockFetch(page("secret"));

    await expect(safeFetch("https://internal.example.com/")).rejects.toThrow("not on the public internet");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a host name that resolves to a mix of public and private addresses", async () => {
    mockDns().mockResolvedValue([{ address: "93.184.216.34" }, { address: "127.0.0.1" }]);
    mockFetch(page("secret"));

    await expect(safeFetch("https://example.com/")).rejects.toThrow("not on the public internet");
  });

  it("refuses a redirect to a private address", async () => {
    mockDns();
    const fetchMock = mockFetch(redirect("http://169.254.169.254/latest"), page("secret"));

    await expect(safeFetch("https://example.com/")).rejects.toThrow("not on the public internet");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after too many redirects", async () => {
    mockDns();
    const fetchMock = mockFetch(redirect("/again"));

    await expect(safeFetch("https://example.com/")).rejects.toThrow("Too many redirects.");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("stops reading a body at the size limit", async () => {
    mockDns();
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    const stream = () => new ReadableStream({
      start(controller) {
        [chunk, chunk, chunk].forEach((part) => controller.enqueue(part));
        controller.close();
      }
    });

    mockFetch(() => new Response(stream()));
    const response = await safeFetch("https://example.com/big");

    expect((await response.text()).length).toBe(2 * 1024 * 1024);
  });
});
