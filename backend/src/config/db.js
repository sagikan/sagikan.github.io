require("dotenv").config();

const { Pool } = require("pg");

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];
const pool = new Pool({
  connectionString: isLocalDatabase() ? process.env.DATABASE_URL : withoutSslParams(process.env.DATABASE_URL),
  ssl: sslOptions(),
});

function isLocalDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    return true;
  }

  try {
    const url = new URL(connectionString);
    const host = url.searchParams.get("host") || url.hostname.replace(/^\[|\]$/g, "");
    return !host || host.startsWith("/") || LOCAL_HOSTS.includes(host);
  } catch {
    return false;
  }
}

function isPrivateNetworkHost(connectionString = process.env.DATABASE_URL) {
  try {
    const host = new URL(connectionString).hostname;
    return Boolean(host) && !host.includes(".") && !host.includes(":");
  } catch {
    return false;
  }
}

function sslOptions() {
  if (isLocalDatabase()) {
    return false;
  }

  if (process.env.DATABASE_SSL_VERIFY === "false") {
    console.warn("[db] DATABASE_SSL_VERIFY=false: the database certificate is not checked.");
    return { rejectUnauthorized: false };
  }

  // Render's internal host is private-network only; its certificate names the public host.
  if (isPrivateNetworkHost()) {
    return { rejectUnauthorized: false };
  }

  return process.env.DATABASE_CA_CERT
    ? { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, "\n") }
    : { rejectUnauthorized: true };
}

function withoutSslParams(connectionString) {
  try {
    const url = new URL(connectionString);
    ["sslmode", "sslrootcert", "sslcert", "sslkey"].forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return connectionString;
  }
}

module.exports = pool;
module.exports.isLocalDatabase = isLocalDatabase;
