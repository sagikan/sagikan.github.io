import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { api, createApplication, createUser, signIn, signedInClient } from "../../../tests/db/helpers";

const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken");
const db = require("../../config/db");

const NEW_APPLICATION = { company: "Acme", position: "Backend Engineer", location: "Haifa" };

// Counts the rows of a table
async function countRows(table, where = "TRUE") {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`);

  return rows[0].count;
}

describe("authentication", () => {
  it.each([
    ["get", "/api/applications"],
    ["post", "/api/applications"],
    ["patch", "/api/applications/1"],
    ["delete", "/api/applications/1"]
  ])("refuses a %s without a session", async (method, path) => {
    const res = await api()[method](path);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required." });
  });

  it("refuses a garbled session cookie and clears it", async () => {
    const res = await api().get("/api/applications").set("Cookie", "token=garbage");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired token." });
    expect(res.headers["set-cookie"].join(";")).toContain("token=;");
  });

  it("refuses a session that has been ended on the server", async () => {
    const { client } = await signedInClient();

    await db.query("DELETE FROM sessions");

    const res = await client.get("/api/applications");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Your session has ended. Please log in again." });
  });

  it("refuses a session after the user's token version changed, such as after a password reset", async () => {
    const { client } = await signedInClient();

    await db.query("UPDATE users SET token_version = token_version + 1");

    expect((await client.get("/api/applications")).status).toBe(401);
  });

  it("refuses a session that has expired", async () => {
    const { client } = await signedInClient();

    await db.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 minute'");

    expect((await client.get("/api/applications")).status).toBe(401);
  });

  it("refuses a pending sign-in cookie in place of a session", async () => {
    const user = await createUser();
    const { cookie } = await signIn(user);
    const session = jwt.decode(cookie.replace("token=", ""));
    const pending = jwt.sign({ id: user.id, typ: "pending", ver: 0, stage: "mfa", sid: session.sid }, process.env.JWT_SECRET, { algorithm: "HS256" });
    const res = await api().get("/api/applications").set("Cookie", `token=${pending}`);

    expect(res.status).toBe(401);
  });

  describe("CSRF protection", () => {
    it.each(["post", "patch", "delete"])("refuses a %s without the CSRF token", async (method) => {
      const { client } = await signedInClient();
      const res = await client[method]("/api/applications/1").unset("X-CSRF-Token").send({ status: "Offer" });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Invalid or missing CSRF token." });
    });

    it("refuses the wrong CSRF token", async () => {
      const { client } = await signedInClient();
      const res = await client.post("/api/applications").set("X-CSRF-Token", "wrong").send(NEW_APPLICATION);

      expect(res.status).toBe(403);
      expect(await countRows("applications")).toBe(0);
    });

    it("doesn't ask for the token on reads", async () => {
      const { client } = await signedInClient();

      expect((await client.get("/api/applications").unset("X-CSRF-Token")).status).toBe(200);
    });
  });
});

describe("GET /api/applications", () => {
  it("returns an empty list for a new user", async () => {
    const { client } = await signedInClient();
    const res = await client.get("/api/applications");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns the user's applications, newest first, with their fields", async () => {
    const { client, user } = await signedInClient();

    await createApplication(user.id, { company: "First", applied_at: "2026-03-01", workplace_model: "Remote", job_url: "https://example.com/1", notes: "Call back" });
    await createApplication(user.id, { company: "Second" });

    const res = await client.get("/api/applications");

    expect(res.body.map((application) => application.company)).toEqual(["Second", "First"]);
    expect(res.body[1]).toMatchObject({
      company: "First",
      position: "Backend Engineer",
      location: "Haifa",
      workplace_model: "Remote",
      status: "Applied",
      job_url: "https://example.com/1",
      notes: "Call back",
      applied_at: "2026-03-01",
      cv_job_id: null
    });
    expect(res.body[1]).not.toHaveProperty("user_id");
  });

  it("never returns another user's applications", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });

    await createApplication(other.id, { company: "Secret Corp" });

    expect((await client.get("/api/applications")).body).toEqual([]);
  });
});

describe("POST /api/applications", () => {
  it("creates an application with defaults, and returns it", async () => {
    const { client, user } = await signedInClient();
    const res = await client.post("/api/applications").send(NEW_APPLICATION);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...NEW_APPLICATION, status: "Applied", workplace_model: null, job_url: null, notes: null, applied_at: null });
    expect(await countRows("applications", `user_id = ${user.id}`)).toBe(1);
  });

  it("stores every field, trimming text", async () => {
    const { client } = await signedInClient();
    const res = await client.post("/api/applications").send({
      company: "  Acme  ",
      position: " Backend Engineer ",
      location: " Haifa ",
      workplace_model: "Hybrid",
      status: "Interview",
      job_url: " https://example.com/job ",
      notes: " Met the team ",
      applied_at: "2026-04-02"
    });

    expect(res.body).toMatchObject({
      company: "Acme",
      position: "Backend Engineer",
      location: "Haifa",
      workplace_model: "Hybrid",
      status: "Interview",
      job_url: "https://example.com/job",
      notes: "Met the team",
      applied_at: "2026-04-02"
    });
  });

  it("turns an empty link or note into nothing", async () => {
    const { client } = await signedInClient();
    const res = await client.post("/api/applications").send({ ...NEW_APPLICATION, job_url: "   ", notes: "" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ job_url: null, notes: null });
  });

  it("saves the application for the signed-in user, whatever the body says", async () => {
    const { client, user } = await signedInClient();
    const other = await createUser({ email: "noa@example.com" });

    await client.post("/api/applications").send({ ...NEW_APPLICATION, user_id: other.id });

    expect(await countRows("applications", `user_id = ${user.id}`)).toBe(1);
    expect(await countRows("applications", `user_id = ${other.id}`)).toBe(0);
  });

  it.each([
    ["no company", { company: undefined }, "Company, position and location are required."],
    ["a blank position", { position: "   " }, "Company, position and location are required."],
    ["a non-text location", { location: 5 }, "Company, position and location are required."],
    ["a company over 200 characters", { company: "c".repeat(201) }, "company can be at most 200 characters."],
    ["an unknown status", { status: "Ghosted" }, "Invalid status."],
    ["an unknown workplace type", { workplace_model: "Office" }, "Invalid workplace model."],
    ["a link that isn't http", { job_url: "ftp://example.com/job" }, "The link must start with http:// or https://."],
    ["a link over 500 characters", { job_url: `https://example.com/${"a".repeat(500)}` }, "The link can be at most 500 characters."],
    ["notes over 5000 characters", { notes: "n".repeat(5001) }, "Notes can be at most 5000 characters."],
    ["a date that doesn't exist", { applied_at: "2026-02-30" }, "applied_at must be a real date in YYYY-MM-DD format or null."]
  ])("refuses an application with %s", async (_title, change, message) => {
    const { client } = await signedInClient();
    const res = await client.post("/api/applications").send({ ...NEW_APPLICATION, ...change });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
    expect(await countRows("applications")).toBe(0);
  });

  it.each([["an array", []], ["no body", undefined]])("refuses %s as the body", async (_title, body) => {
    const { client } = await signedInClient();
    const res = await client.post("/api/applications").send(body);

    expect(res.status).toBe(400);
  });

  it("stops at 5000 applications", async () => {
    const { client, user } = await signedInClient();

    await db.query(
      `INSERT INTO applications (user_id, company, position, location) SELECT $1, 'Co ' || n, 'Role', 'Place' FROM generate_series(1, 5000) AS n`,
      [user.id]
    );

    const res = await client.post("/api/applications").send(NEW_APPLICATION);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("You can keep up to 5000 applications");
    expect(await countRows("applications")).toBe(5000);
  });

  it("doesn't count other users' applications toward the limit", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });

    await db.query(
      `INSERT INTO applications (user_id, company, position, location) SELECT $1, 'Co ' || n, 'Role', 'Place' FROM generate_series(1, 5000) AS n`,
      [other.id]
    );

    expect((await client.post("/api/applications").send(NEW_APPLICATION)).status).toBe(201);
  });
});

describe("PATCH /api/applications/:id", () => {
  it("updates the given fields and returns the application", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id);
    const res = await client.patch(`/api/applications/${application.id}`).send({ status: "Offer", notes: "Great call", applied_at: "2026-05-01" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: application.id, company: "Acme", status: "Offer", notes: "Great call", applied_at: "2026-05-01" });
    expect((await db.query("SELECT status FROM applications WHERE id = $1", [application.id])).rows[0].status).toBe("Offer");
  });

  it("clears optional fields with null or empty text", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id, { notes: "Old", job_url: "https://example.com/1", workplace_model: "Remote", applied_at: "2026-01-01" });
    const res = await client.patch(`/api/applications/${application.id}`).send({ notes: "  ", job_url: "", workplace_model: null, applied_at: null });

    expect(res.body).toMatchObject({ notes: null, job_url: null, workplace_model: null, applied_at: null });
  });

  it("changes nothing else", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id);
    const other = await createApplication(user.id, { company: "Other" });

    await client.patch(`/api/applications/${application.id}`).send({ status: "Rejected" });

    expect((await db.query("SELECT status FROM applications WHERE id = $1", [other.id])).rows[0].status).toBe("Applied");
  });

  it("can't update another user's application", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });
    const application = await createApplication(other.id);
    const res = await client.patch(`/api/applications/${application.id}`).send({ status: "Offer" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Application not found." });
    expect((await db.query("SELECT status FROM applications WHERE id = $1", [application.id])).rows[0].status).toBe("Applied");
  });

  it("reports an application that doesn't exist", async () => {
    const { client } = await signedInClient();

    expect((await client.patch("/api/applications/999").send({ status: "Offer" })).status).toBe(404);
  });

  it.each([
    ["an invalid ID", "abc", { status: "Offer" }, "Invalid application ID."],
    ["an ID with a leading zero", "01", { status: "Offer" }, "Invalid application ID."],
    ["an empty body", "1", {}, "At least one field must be provided."],
    ["an array body", "1", [{ status: "Offer" }], "Invalid request body."],
    ["a field that can't be updated", "1", { user_id: 2 }, "One or more fields cannot be updated."],
    ["an inherited field name", "1", { constructor: "x" }, "One or more fields cannot be updated."],
    ["an unknown status", "1", { status: "Ghosted" }, "Invalid status."],
    ["a blank company", "1", { company: "  " }, "company must be a non-empty string."]
  ])("refuses %s", async (_title, id, body, message) => {
    const { client, user } = await signedInClient();

    await createApplication(user.id);

    const res = await client.patch(`/api/applications/${id}`).send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
  });

  it("changes nothing when one of several fields is invalid", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id);

    await client.patch(`/api/applications/${application.id}`).send({ notes: "Changed", status: "Ghosted" });

    expect((await db.query("SELECT notes FROM applications WHERE id = $1", [application.id])).rows[0].notes).toBeNull();
  });
});

describe("DELETE /api/applications/:id", () => {
  it("deletes the application", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id);
    const res = await client.delete(`/api/applications/${application.id}`);

    expect(res.status).toBe(204);
    expect(await countRows("applications")).toBe(0);
  });

  it("deletes only that application", async () => {
    const { client, user } = await signedInClient();
    const application = await createApplication(user.id);

    await createApplication(user.id, { company: "Keep" });
    await client.delete(`/api/applications/${application.id}`);

    expect((await db.query("SELECT company FROM applications")).rows).toEqual([{ company: "Keep" }]);
  });

  it("can't delete another user's application", async () => {
    const { client } = await signedInClient({ email: "dana@example.com" });
    const other = await createUser({ email: "noa@example.com" });
    const application = await createApplication(other.id);
    const res = await client.delete(`/api/applications/${application.id}`);

    expect(res.status).toBe(404);
    expect(await countRows("applications")).toBe(1);
  });

  it.each(["abc", "0", "-1", "1.5", "1e3"])("refuses the ID %s", async (id) => {
    const { client } = await signedInClient();
    const res = await client.delete(`/api/applications/${id}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid application ID." });
  });

  it("reports an application that doesn't exist", async () => {
    const { client } = await signedInClient();

    expect((await client.delete("/api/applications/999")).status).toBe(404);
  });
});

describe("the database", () => {
  it("removes a user's applications and sessions with the user", async () => {
    const { user } = await signedInClient();

    await createApplication(user.id);
    await db.query("DELETE FROM users WHERE id = $1", [user.id]);

    expect(await countRows("applications")).toBe(0);
    expect(await countRows("sessions")).toBe(0);
  });

  it("refuses an unknown status or workplace type even when the API is bypassed", async () => {
    const user = await createUser();

    await expect(createApplication(user.id, { status: "Ghosted" })).rejects.toThrow();
    await expect(createApplication(user.id, { workplace_model: "Office" })).rejects.toThrow();
  });
});
