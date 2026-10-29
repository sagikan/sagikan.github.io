import { describe, expect, it } from "vitest";
import { ORIGIN, api, signedInClient } from "../../tests/db/helpers";

describe("the API", () => {
  it("reports that it is up", async () => {
    const res = await api().get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("answers unknown routes with a JSON 404", async () => {
    const res = await api().get("/api/nope");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found." });
  });

  it("adds security headers to every response and hides what it runs on", async () => {
    const res = await api().get("/api/health");

    expect(res.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store"
    });
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  describe("cross-origin requests", () => {
    it("lets the site's own origin read responses, with cookies", async () => {
      const res = await api().get("/api/health").set("Origin", ORIGIN);

      expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("rejects an origin that isn't allowed", async () => {
      const res = await api().get("/api/health").set("Origin", "https://evil.example.com");

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Untrusted request origin." });
    });
  });

  describe("state-changing requests", () => {
    it.each(["post", "put", "patch", "delete"])("refuse a %s from an untrusted origin", async (method) => {
      const res = await api()[method]("/api/applications").set("Origin", "https://evil.example.com");

      expect(res.status).toBe(403);
    });

    it("refuse a request with no origin at all", async () => {
      const { client } = await signedInClient();
      const res = await client.post("/api/applications").unset("Origin").send({});

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Untrusted request origin." });
    });
  });

  describe("request bodies", () => {
    it("answers invalid JSON with a 400", async () => {
      const { client } = await signedInClient();
      const res = await client.post("/api/applications").set("Content-Type", "application/json").send("{ not json");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "The request body isn't valid JSON." });
    });

    it("answers a body over 100 KB with a 413", async () => {
      const { client } = await signedInClient();
      const res = await client.post("/api/applications").send({ notes: "n".repeat(150 * 1024) });

      expect(res.status).toBe(413);
      expect(res.body).toEqual({ error: "That request is too large." });
    });

    it("refuses compressed bodies", async () => {
      const { client } = await signedInClient();
      const res = await client.post("/api/applications").set("Content-Type", "application/json").set("Content-Encoding", "gzip").send("{}");

      expect(res.status).toBe(415);
    });
  });
});
