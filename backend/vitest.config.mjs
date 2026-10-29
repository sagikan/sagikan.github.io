import { defineConfig } from "vitest/config";

/* Variables set here win over backend/.env: dotenv never overrides a variable that is already set.
   An empty string still counts as set, so real keys in .env can't leak into tests */
const TEST_ENV = {
  NODE_ENV: "test",
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
    include: ["src/**/__tests__/**/*.test.js"],
    setupFiles: ["./tests/setup.js"],
    env: TEST_ENV,
    restoreMocks: true,
    unstubGlobals: true,
    passWithNoTests: true
  }
});
