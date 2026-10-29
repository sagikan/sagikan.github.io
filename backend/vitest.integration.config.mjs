import { defineConfig } from "vitest/config";

/* Database tests run in GitHub Actions against a throwaway Postgres, never on a developer's machine.
   They refuse to start unless TEST_DATABASE_URL points at this machine and at a database ending in _test.
   Like the unit tests they never read backend/.env, and the variables below win over the real ones */
const TEST_ENV = {
  NODE_ENV: "test",
  DOTENV_CONFIG_PATH: "/nonexistent/.env.test",
  DOTENV_CONFIG_QUIET: "true",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
  DATABASE_CA_CERT: "",
  DATABASE_SSL_VERIFY: "",
  ANTHROPIC_API_KEY: "",
  BREVO_API_KEY: "",
  JSEARCH_API_KEY: "",
  SMTP_HOST: "",
  SMTP_USER: "",
  SMTP_PASS: "",
  MAIL_FROM: "",
  USE_REAL_APIS: "false",
  SIGNUPS_OPEN: "",
  TRUST_PROXY: "",
  FRONTEND_ORIGIN: "https://app.test",
  JWT_SECRET: "test-jwt-secret-for-database-tests-0123456789",
  MFA_ENCRYPTION_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
};

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.db.test.js"],
    globalSetup: ["./tests/db/globalSetup.js"],
    setupFiles: ["./tests/db/setup.js"],
    env: TEST_ENV,
    fileParallelism: false,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true
  }
});
