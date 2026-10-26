import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/* Builds the Content Security Policy for the built page
   GitHub Pages can't send headers, so the CSP is a <meta> tag. Build-only: dev needs inline scripts */
function contentSecurityPolicy(apiUrl) {
  if (apiUrl && !URL.canParse(apiUrl)) {
    throw new Error(`VITE_API_URL is not a valid URL: ${apiUrl}`);
  }

  const apiOrigin = apiUrl ? new URL(apiUrl).origin : "";
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self' blob: data:${apiOrigin ? ` ${apiOrigin}` : ""}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; ");

  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" },
      { tag: "meta", attrs: { name: "referrer", content: "strict-origin-when-cross-origin" }, injectTo: "head-prepend" }
    ]
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");

  return {
    plugins: [react(), contentSecurityPolicy(env.VITE_API_URL)],
    base: "/"
  };
});
