const dns = require("dns").promises;
const net = require("net");

const MAX_REDIRECTS = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const blocked = new net.BlockList();
[
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, "ipv4"));
[
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, "ipv6"));

function isPublicAddress(address) {
  const family = net.isIP(address);

  if (family === 4) {
    return !blocked.check(address, "ipv4");
  }

  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    return mapped ? isPublicAddress(mapped[1]) : !blocked.check(address, "ipv6");
  }

  return false;
}

async function checkUrl(raw) {
  const url = new URL(raw);

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Only plain http(s) links can be fetched.");
  }

  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error("Only the standard web ports can be fetched.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });

  if (addresses.length === 0 || !addresses.every(({ address }) => isPublicAddress(address))) {
    throw new Error("That address is not on the public internet.");
  }

  return url;
}

async function readLimited(response) {
  const reader = response.body?.getReader();

  if (!reader) {
    return "";
  }

  const chunks = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    size += value.length;

    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function safeFetch(raw, { headers = {}, timeoutMs = 12_000 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = await checkUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, { headers, signal, redirect: "manual" });
    const location = response.headers.get("location");

    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {});
      url = await checkUrl(new URL(location, url).toString());
      continue;
    }

    return {
      status: response.status,
      ok: response.ok,
      url: url.toString(),
      text: () => readLimited(response)
    };
  }

  throw new Error("Too many redirects.");
}

module.exports = { safeFetch, isPublicAddress };
