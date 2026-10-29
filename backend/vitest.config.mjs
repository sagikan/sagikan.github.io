import { defineConfig } from "vitest/config";

/* Tests never read backend/.env: dotenv is pointed at a file that doesn't exist.
   As a second layer, variables set here win anyway, since dotenv never overrides a variable that is
   already set (an empty string still counts as set) */
const TEST_ENV = {
  NODE_ENV: "test",
  DOTENV_CONFIG_PATH: "/nonexistent/.env.test",
  DOTENV_CONFIG_QUIET: "true",
  DATABASE_URL: "postgres://test:test@127.0.0.1:1/app_test",
  DATABASE_CA_CERT: "",
  DATABASE_SSL_VERIFY: "",
  ANTHROPIC_API_KEY: "",
  BREVO_API_KEY: "",
  JSEARCH_API_KEY: "",
  SMTP_HOST: "",
  SMTP_USER: "",
  SMTP_PASS: "",
  MFA_ENCRYPTION_KEY: "",
  USE_REAL_APIS: "false",
  JWT_SECRET: "test-jwt-secret"
};

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.js", "tests/**/__tests__/**/*.test.js"],
    exclude: ["**/node_modules/**", "**/*.db.test.js"],
    setupFiles: ["./tests/setup.js"],
    env: TEST_ENV,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    passWithNoTests: true
  }
});
