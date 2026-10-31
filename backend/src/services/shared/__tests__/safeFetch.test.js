import { createRequire } from "node:module";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { mockDns, mockWeb } from "../../../../tests/helpers/network";

const require = createRequire(import.meta.url);
const dns = require("dns");
const { isPublicAddress, safeFetch, safeLookup } = require("../safeFetch");

// Builds a redirect response
function redirect(location, status = 302) {
  return () => new Response(null, { status, headers: { location } });
}

// Builds a plain text response
function page(text, status = 200) {
  return () => new Response(text, { status });
}

// Builds a compressed response
function compressed(encoding, body) {
  return () => new Response(body, { headers: { "content-encoding": encoding } });
}

// Makes the connection-time lookup answer with the given addresses, or an error
function mockLookup(answer) {
  return vi.spyOn(dns, "lookup").mockImplementation((_hostname, _options, callback) => (
    answer instanceof Error ? callback(answer) : callback(null, answer)
  ));
}

// Runs safeLookup and returns what it answered with
function lookupWith(options) {
  return new Promise((resolve) => {
    safeLookup("example.com", options, (...answer) => resolve(answer));
  });
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

describe("safeLookup", () => {
  const PUBLIC = [{ address: "93.184.216.34", family: 4 }];

  it("looks up every address of the host name, keeping the order the resolver gave", async () => {
    const lookup = mockLookup(PUBLIC);

    await lookupWith({});

    expect(lookup).toHaveBeenCalledWith("example.com", { all: true, verbatim: true }, expect.any(Function));
  });

  it("answers with one address and its family when a single address is wanted", async () => {
    mockLookup(PUBLIC);

    expect(await lookupWith({})).toEqual([null, "93.184.216.34", 4]);
  });

  it("answers with the list of addresses when all of them are wanted", async () => {
    mockLookup([...PUBLIC, { address: "2606:4700:4700::1111", family: 6 }]);

    expect(await lookupWith({ all: true })).toEqual([null, [...PUBLIC, { address: "2606:4700:4700::1111", family: 6 }]]);
  });

  it("answers when no options are given", async () => {
    mockLookup(PUBLIC);

    const answer = await new Promise((resolve) => {
      safeLookup("example.com", undefined, (...result) => resolve(result));
    });

    expect(answer).toEqual([null, "93.184.216.34", 4]);
  });

  it.each([
    ["a private address", [{ address: "10.0.0.5", family: 4 }]],
    ["a loopback address", [{ address: "127.0.0.1", family: 4 }]],
    ["an IPv6 loopback address", [{ address: "::1", family: 6 }]],
    ["the cloud metadata address", [{ address: "169.254.169.254", family: 4 }]],
    ["a mix of public and private addresses", [...PUBLIC, { address: "192.168.1.1", family: 4 }]],
    ["no addresses", []]
  ])("refuses %s, even when all addresses are wanted", async (_title, addresses) => {
    mockLookup(addresses);

    const [single] = await lookupWith({});
    const [all] = await lookupWith({ all: true });

    expect(single).toEqual(new Error("That address is not on the public internet."));
    expect(all).toEqual(new Error("That address is not on the public internet."));
  });

  it("passes on a failed lookup", async () => {
    mockLookup(new Error("ENOTFOUND"));

    expect((await lookupWith({}))[0]).toEqual(new Error("ENOTFOUND"));
  });
});

describe("safeFetch", () => {
  it("fetches a public page and returns its status, final URL and text", async () => {
    mockDns();

    const requestMock = mockWeb(page("hello"));
    const response = await safeFetch("https://example.com/job");

    expect(response).toMatchObject({ status: 200, ok: true, url: "https://example.com/job" });
    expect(await response.text()).toBe("hello");
    expect(requestMock.mock.calls[0][0].href).toBe("https://example.com/job");
  });

  it("connects through the checking lookup, so a name can't answer differently after the check", async () => {
    mockDns();

    const requestMock = mockWeb(page("hello"));

    await safeFetch("https://example.com/job");

    expect(requestMock.mock.calls[0][1].lookup).toBe(safeLookup);
    expect(requestMock.mock.calls[0][1].method).toBe("GET");
  });

  it("refuses a real connection to a name that resolves to the loopback address after passing the check", async () => {
    mockDns();

    await expect(safeFetch("http://localhost/")).rejects.toThrow("not on the public internet");
  });

  it("sends a default user agent, asks for compressed pages and lets the caller's headers win in any letter case", async () => {
    mockDns();

    const requestMock = mockWeb(page("hello"));

    await safeFetch("https://example.com/", { headers: { "User-Agent": "Custom", Accept: "text/html" } });

    expect(requestMock.mock.calls[0][1].headers).toEqual({ "user-agent": "Custom", "accept-encoding": "gzip, deflate, br", accept: "text/html" });

    await safeFetch("https://example.com/");

    expect(requestMock.mock.calls[1][1].headers).toEqual({ "user-agent": "node", "accept-encoding": "gzip, deflate, br" });
  });

  it("uses plain http for an http link", async () => {
    mockDns();

    const requestMock = mockWeb(page("hello"));
    const response = await safeFetch("http://example.com/");

    expect(response.url).toBe("http://example.com/");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("gives every request a time limit", async () => {
    mockDns();

    const requestMock = mockWeb(page("hello"));

    await safeFetch("https://example.com/", { timeoutMs: 500 });

    expect(requestMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(requestMock.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it.each([
    ["a client error", 404],
    ["a server error", 500],
    ["a redirect with no place to go", 302]
  ])("reports %s without throwing", async (_title, status) => {
    mockDns();
    mockWeb(page("body", status));

    expect(await safeFetch("https://example.com/job")).toMatchObject({ status, ok: false });
  });

  it("treats the whole 2xx range as ok", async () => {
    mockDns();
    mockWeb(() => new Response(null, { status: 204 }), page("b", 299), page("c", 300));

    expect((await safeFetch("https://example.com/1")).ok).toBe(true);
    expect((await safeFetch("https://example.com/2")).ok).toBe(true);
    expect((await safeFetch("https://example.com/3")).ok).toBe(false);
  });

  it.each([
    ["a relative redirect", "/moved", "https://example.com/moved"],
    ["an absolute redirect", "https://other.example.com/new", "https://other.example.com/new"],
    ["a redirect to http", "http://example.com/plain", "http://example.com/plain"]
  ])("follows %s to a public address", async (_title, location, finalUrl) => {
    mockDns();
    mockWeb(redirect(location), page("moved page"));

    const response = await safeFetch("https://example.com/job");

    expect(response.url).toBe(finalUrl);
    expect(await response.text()).toBe("moved page");
  });

  it.each([301, 302, 303, 307, 308])("follows a %i redirect", async (status) => {
    mockDns();
    mockWeb(redirect("/moved", status), page("moved page"));

    expect((await safeFetch("https://example.com/job")).url).toBe("https://example.com/moved");
  });

  it("checks the address of every hop", async () => {
    const lookup = mockDns();

    mockWeb(redirect("https://other.example.com/new"), page("moved page"));
    await safeFetch("https://example.com/job");

    expect(lookup.mock.calls.map(([host]) => host)).toEqual(["example.com", "other.example.com"]);
  });

  it("returns a redirect that has no Location header as the answer", async () => {
    mockDns();
    mockWeb(() => new Response(null, { status: 301 }));

    expect(await safeFetch("https://example.com/")).toMatchObject({ status: 301, ok: false });
  });

  it.each([
    ["a non-web protocol", "ftp://example.com/file"],
    ["a link with a user name", "https://user@example.com/"],
    ["a link with credentials", "https://user:pass@example.com/"],
    ["a non-standard port", "https://example.com:8443/"],
    ["a loopback address", "http://127.0.0.1/admin"],
    ["a private address", "http://10.0.0.1/"],
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data"],
    ["a bracketed IPv6 loopback address", "http://[::1]/"],
    ["an IPv4-mapped loopback address", "http://[::ffff:127.0.0.1]/"],
    ["text that is not a link", "not a link"]
  ])("refuses %s", async (_title, url) => {
    mockDns();

    const requestMock = mockWeb(page("secret"));

    await expect(safeFetch(url)).rejects.toThrow();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("allows the standard ports written out", async () => {
    mockDns();
    mockWeb(page("a"), page("b"));

    expect((await safeFetch("https://example.com:443/")).status).toBe(200);
    expect((await safeFetch("http://example.com:80/")).status).toBe(200);
  });

  it("refuses a host name that resolves to a private address", async () => {
    mockDns("10.0.0.5");

    const requestMock = mockWeb(page("secret"));

    await expect(safeFetch("https://internal.example.com/")).rejects.toThrow("not on the public internet");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("refuses a host name that resolves to a mix of public and private addresses", async () => {
    mockDns().mockResolvedValue([{ address: "93.184.216.34" }, { address: "127.0.0.1" }]);
    mockWeb(page("secret"));

    await expect(safeFetch("https://example.com/")).rejects.toThrow("not on the public internet");
  });

  it("refuses a host name that resolves to nothing", async () => {
    mockDns().mockResolvedValue([]);
    mockWeb(page("secret"));

    await expect(safeFetch("https://example.com/")).rejects.toThrow("not on the public internet");
  });

  it.each([
    ["a private address", "http://169.254.169.254/latest"],
    ["a non-web protocol", "ftp://example.com/file"],
    ["a non-standard port", "https://example.com:8443/"],
    ["a link with credentials", "https://user:pass@example.com/"]
  ])("refuses a redirect to %s", async (_title, location) => {
    mockDns();

    const requestMock = mockWeb(redirect(location), page("secret"));

    await expect(safeFetch("https://example.com/")).rejects.toThrow();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after too many redirects", async () => {
    mockDns();

    const requestMock = mockWeb(redirect("/again"));

    await expect(safeFetch("https://example.com/")).rejects.toThrow("Too many redirects.");
    expect(requestMock).toHaveBeenCalledTimes(6);
  });

  it("passes on a failed connection", async () => {
    mockDns();
    mockWeb(() => {
      throw new Error("ECONNRESET");
    });

    await expect(safeFetch("https://example.com/")).rejects.toThrow("ECONNRESET");
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

    mockWeb(() => new Response(stream()));

    const response = await safeFetch("https://example.com/big");

    expect((await response.text()).length).toBe(2 * 1024 * 1024);
  });

  it("returns an empty text for an empty body", async () => {
    mockDns();
    mockWeb(() => new Response(null, { status: 200 }));

    expect(await (await safeFetch("https://example.com/")).text()).toBe("");
  });

  it("reads a body as UTF-8", async () => {
    mockDns();
    mockWeb(page("שלום – résumé"));

    expect(await (await safeFetch("https://example.com/")).text()).toBe("שלום – résumé");
  });

  it.each([
    ["gzip", (text) => gzipSync(text)],
    ["x-gzip", (text) => gzipSync(text)],
    ["deflate", (text) => deflateSync(text)],
    ["br", (text) => brotliCompressSync(text)],
    ["GZIP", (text) => gzipSync(text)]
  ])("undoes %s compression", async (encoding, compress) => {
    mockDns();
    mockWeb(compressed(encoding, compress("<h1>Backend Engineer</h1>")));

    expect(await (await safeFetch("https://example.com/")).text()).toBe("<h1>Backend Engineer</h1>");
  });

  it("stops a compressed body that grows past the size limit when unpacked", async () => {
    mockDns();
    mockWeb(compressed("gzip", gzipSync(Buffer.alloc(10 * 1024 * 1024, 97))));

    expect((await (await safeFetch("https://example.com/")).text()).length).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("fails to read a body that is not valid for its compression", async () => {
    mockDns();
    mockWeb(compressed("gzip", "this is not gzip"));

    await expect((await safeFetch("https://example.com/")).text()).rejects.toThrow();
  });

  it("reads a body with an encoding it does not know as it is", async () => {
    mockDns();
    mockWeb(compressed("zstd", "plain text"));

    expect(await (await safeFetch("https://example.com/")).text()).toBe("plain text");
  });
});
