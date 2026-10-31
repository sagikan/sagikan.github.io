import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { vi } from "vitest";

const require = createRequire(import.meta.url);
const dns = require("dns").promises;
const http = require("http");
const https = require("https");

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

// Builds the request object that stands in for http(s).request, answering with a web Response
function fakeRequest(url, makeResponse, callback) {
  const request = new EventEmitter();

  request.end = () => {
    Promise.resolve()
      .then(() => makeResponse(url))
      .then((web) => {
        const response = web.body ? Readable.fromWeb(web.body) : Readable.from([]);

        response.statusCode = web.status;
        response.headers = Object.fromEntries(web.headers.entries());
        callback(response);
      })
      .catch((error) => request.emit("error", error));
  };

  return request;
}

// Makes http(s).request return the responses in order, repeating the last one (each is built fresh, since a body reads once)
export function mockWeb(...makeResponses) {
  const requestMock = vi.fn((url, options, callback) => fakeRequest(url, makeResponses[Math.min(requestMock.mock.calls.length - 1, makeResponses.length - 1)], callback));

  vi.spyOn(https, "request").mockImplementation(requestMock);
  vi.spyOn(http, "request").mockImplementation(requestMock);

  return requestMock;
}
