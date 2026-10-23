// Usage: npm run db:reset [-- --yes] [-- --allow-remote]
require("dotenv").config();

const readline = require("readline/promises");
const db = require("../src/config/db");

const TABLES = ["closed_postings", "feed_state","job_postings", "job_boards", "cv_tailorings", "jobs", "job_searches", "grade_sheets", "cv_profiles", "email_events", "email_sync", "recovery_codes", "password_resets", "email_verifications", "applications", "users"];
const { isLocalDatabase } = db;

function describeDatabase() {
  try {
    const url = new URL(process.env.DATABASE_URL);
    const host = url.searchParams.get("host") || url.hostname;
    return `${host}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return "(DATABASE_URL not set; using local PG* defaults)";
  }
}

async function confirm() {
  if (process.argv.includes("--yes")) {
    return true;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `This will DELETE ALL DATA in ${describeDatabase()}.\nType "reset" to continue: `
  );
  rl.close();

  return answer.trim() === "reset";
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to reset the database with NODE_ENV=production.");
    process.exitCode = 1;
    return;
  }

  if (!isLocalDatabase() && !process.argv.includes("--allow-remote")) {
    console.error(
      `Refusing to reset remote database ${describeDatabase()}.\n` +
      "Point DATABASE_URL at a local database, or pass --allow-remote if you're sure."
    );
    process.exitCode = 1;
    return;
  }

  if (!(await confirm())) {
    console.log("Aborted.");
    return;
  }

  await db.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  console.log(`Emptied: ${TABLES.join(", ")}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
