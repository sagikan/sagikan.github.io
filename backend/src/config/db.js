require("dotenv").config();

const { Pool } = require("pg");

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDatabase() ? false : { rejectUnauthorized: false },
});

module.exports = pool;
module.exports.isLocalDatabase = isLocalDatabase;
