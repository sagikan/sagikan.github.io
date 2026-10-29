import { describe, expect, it, vi } from "vitest";
import { assertSafeDatabaseUrl, assertTestDatabase } from "../guard";

describe("assertSafeDatabaseUrl", () => {
  it.each([
    "postgres://postgres:postgres@localhost:5432/app_test",
    "postgres://postgres@127.0.0.1:55432/app_test",
    "postgres://postgres@[::1]:5432/jobs_test",
    "postgresql://user:p%40ss@localhost/my_test?sslmode=disable"
  ])("accepts %s", (url) => {
    expect(() => assertSafeDatabaseUrl(url)).not.toThrow();
  });

  it("explains that database tests run in GitHub Actions when there is no URL", () => {
    expect(() => assertSafeDatabaseUrl(undefined)).toThrow("Database tests run in GitHub Actions");
    expect(() => assertSafeDatabaseUrl("")).toThrow("TEST_DATABASE_URL isn't set");
  });

  it.each([
    ["a remote host", "postgres://u:p@dpg-abc123.oregon-postgres.render.com/app_test"],
    ["a private network host", "postgres://u:p@dpg-abc123-a/app_test"],
    ["a look-alike host name", "postgres://u:p@localhost.evil.com/app_test"],
    ["an address that only starts like localhost", "postgres://u:p@127.0.0.1.nip.io/app_test"],
    ["credentials that mention localhost", "postgres://localhost:5432@evil.com/app_test"]
  ])("refuses %s", (_title, url) => {
    expect(() => assertSafeDatabaseUrl(url)).toThrow("the host must be this machine");
  });

  it.each([
    ["a name without the suffix", "postgres://u:p@localhost/app"],
    ["a development database", "postgres://u:p@localhost/jobs_dev"],
    ["a name that only contains test", "postgres://u:p@localhost/test_data"],
    ["no database name", "postgres://u:p@localhost/"],
    ["the default database", "postgres://u:p@localhost/postgres"]
  ])("refuses %s", (_title, url) => {
    expect(() => assertSafeDatabaseUrl(url)).toThrow("the database name must end in _test");
  });

  it.each(["host", "hostaddr", "service"])("refuses a ?%s= parameter that could redirect the connection", (param) => {
    expect(() => assertSafeDatabaseUrl(`postgres://u:p@localhost/app_test?${param}=db.render.com`)).toThrow("can redirect the connection");
  });

  it("refuses something that isn't a URL", () => {
    expect(() => assertSafeDatabaseUrl("not a url")).toThrow("isn't a valid URL");
  });
});

describe("assertTestDatabase", () => {
  // Builds a connection that says which database it is connected to
  function connectedTo(name) {
    return { query: vi.fn().mockResolvedValue({ rows: [{ name }] }) };
  }

  it("accepts a database whose name ends in _test", async () => {
    await expect(assertTestDatabase(connectedTo("app_test"))).resolves.toBeUndefined();
  });

  it.each(["jobs", "postgres", "app_test_backup", "test"])("refuses the database %s", async (name) => {
    await expect(assertTestDatabase(connectedTo(name))).rejects.toThrow(`Refusing to touch "${name}"`);
  });
});
