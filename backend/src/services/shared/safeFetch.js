const dnsModule = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");
const { pipeline } = require("stream");
const zlib = require("zlib");

const dns = dnsModule.promises;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const DECODERS = { gzip: zlib.createGunzip, "x-gzip": zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress };
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

// Checks whether an IP address is public
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

// Checks that a URL is http(s) and points at a public address
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

/* Looks up a host name for a connection and refuses any address that is not public.
   The socket connects to the addresses this returns, so a name can't answer differently
   to an earlier check (DNS rebinding) */
function safeLookup(hostname, options, callback) {
  dnsModule.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      return callback(error);
    }

    if (addresses.length === 0 || !addresses.every(({ address }) => isPublicAddress(address))) {
      return callback(new Error("That address is not on the public internet."));
    }

    if (options?.all) {
      return callback(null, addresses);
    }

    callback(null, addresses[0].address, addresses[0].family);
  });
}

// Reads a response body up to the size limit, undoing any compression
async function readLimited(response) {
  const decoder = DECODERS[String(response.headers["content-encoding"] || "").toLowerCase()];
  const stream = decoder ? pipeline(response, decoder(), () => {}) : response;
  const chunks = [];
  let size = 0;

  for await (const chunk of stream) {
    size += chunk.length;

    if (size > MAX_BYTES) {
      stream.destroy();
      break;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

// Sends one GET request, connecting only to public addresses
function requestOnce(url, headers, signal) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const lowered = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
    const request = transport.request(
      url,
      { method: "GET", headers: { "user-agent": "node", "accept-encoding": "gzip, deflate, br", ...lowered }, lookup: safeLookup, signal },
      resolve
    );

    request.on("error", reject);
    request.end();
  });
}

// Fetches a public URL, checking every redirect and every connection
async function safeFetch(raw, { headers = {}, timeoutMs = 12_000 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = await checkUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await requestOnce(url, headers, signal);
    const location = response.headers.location;

    if (response.statusCode >= 300 && response.statusCode < 400 && location) {
      response.resume();
      url = await checkUrl(new URL(location, url).toString());
      continue;
    }

    return {
      status: response.statusCode,
      ok: response.statusCode >= 200 && response.statusCode < 300,
      url: url.toString(),
      text: () => readLimited(response)
    };
  }

  throw new Error("Too many redirects.");
}

module.exports = { safeFetch, safeLookup, isPublicAddress };
