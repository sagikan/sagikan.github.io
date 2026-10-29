const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];
const REDIRECTING_PARAMS = ["host", "hostaddr", "service"];

// Builds an error whose stack is just its message, since Vitest can't print stacks of errors thrown during startup
export function startupError(message) {
  const error = new Error(message);

  error.stack = message;
  error.startup = true;

  return error;
}

// Throws unless the URL points at this machine and at a database whose name ends in _test
export function assertSafeDatabaseUrl(value) {
  if (!value) {
    throw startupError("TEST_DATABASE_URL isn't set. Database tests run in GitHub Actions (see CLAUDE.md).");
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw startupError("The test database URL isn't a valid URL.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const name = decodeURIComponent(url.pathname.slice(1));

  if (!LOCAL_HOSTS.includes(host)) {
    throw startupError(`Refusing to run database tests against "${host}": the host must be this machine.`);
  }

  if (REDIRECTING_PARAMS.some((param) => url.searchParams.has(param))) {
    throw startupError("Refusing to run database tests: the URL has a parameter that can redirect the connection.");
  }

  if (!name.endsWith("_test")) {
    throw startupError(`Refusing to run database tests against "${name}": the database name must end in _test.`);
  }
}

// Throws unless the connection is to a database whose name ends in _test
export async function assertTestDatabase(connection) {
  const { rows } = await connection.query("SELECT current_database() AS name");

  if (!rows[0].name.endsWith("_test")) {
    throw startupError(`Refusing to touch "${rows[0].name}": the database name must end in _test.`);
  }
}
