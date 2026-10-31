import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { api, signedInClient } from "../../../tests/db/helpers";

const require = createRequire(import.meta.url);
const db = require("../../config/db");

const PNG = Buffer.from([137, 80, 78, 71]);

describe("GET /api/logos", () => {
  it("refuses a request without a session", async () => {
    const res = await api().get("/api/logos").query({ company: "Orbit" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required." });
  });

  it.each([
    ["no Origin header", (req) => req.unset("Origin")],
    ["an Origin from another site", (req) => req.set("Origin", "https://evil.example")]
  ])("refuses a signed-in request with %s", async (_title, change) => {
    const { client } = await signedInClient();
    const res = await change(client.get("/api/logos").query({ company: "Orbit" }));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Untrusted request origin." });
  });

  it("refuses a request from another site before it asks for a session", async () => {
    const res = await api().get("/api/logos").query({ company: "Orbit" }).set("Origin", "https://evil.example");

    expect(res.status).toBe(403);
  });

  it.each([
    ["no company", {}],
    ["a blank company", { company: "   " }],
    ["a company over 200 characters", { company: "a".repeat(201) }],
    ["a company given twice", "company=Orbit&company=Pinnacle"],
    ["a company given as an object", "company[name]=Orbit"]
  ])("rejects %s", async (_title, query) => {
    const { client } = await signedInClient();
    const res = await client.get("/api/logos").query(query);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "A company name is required." });
  });

  it.each([
    ["exactly 200 characters", "a".repeat(200)],
    ["letters from another alphabet", "וויקס"],
    ["punctuation", "AT&T, Inc."]
  ])("accepts a company name of %s", async (_title, company) => {
    const { client } = await signedInClient();
    const res = await client.get("/api/logos").query({ company });

    expect(res.status).toBe(204);
  });

  it("serves a cached logo with its content type", async () => {
    const { client } = await signedInClient();

    await db.query("INSERT INTO company_logos (name_key, image, content_type) VALUES ('orbit', $1, 'image/png')", [PNG]);

    const res = await client.get("/api/logos").query({ company: "Orbit Ltd." }).buffer(true).parse((response, done) => {
      const chunks = [];

      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => done(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("private, max-age=86400");
    expect(res.body.equals(PNG)).toBe(true);
  });

  it("answers 204 for a company the user recently missed", async () => {
    const { user, client } = await signedInClient();

    await db.query("INSERT INTO logo_misses (user_id, name_key) VALUES ($1, 'nobody')", [user.id]);

    const res = await client.get("/api/logos").query({ company: "Nobody" });

    expect(res.status).toBe(204);
  });

  it("answers 204 when lookups are off and nothing is cached", async () => {
    const { client } = await signedInClient();
    const res = await client.get("/api/logos").query({ company: "Nobody" });

    expect(res.status).toBe(204);
  });
});
