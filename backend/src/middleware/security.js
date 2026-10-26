const isProduction = process.env.NODE_ENV === "production";

// Throws when required secrets are missing or unsafe
function checkSecrets() {
  const problems = [];
  const jwtSecret = process.env.JWT_SECRET || "";
  const mfaKey = process.env.MFA_ENCRYPTION_KEY || "";

  if (jwtSecret.length < 32) {
    problems.push("JWT_SECRET must be at least 32 characters (use `openssl rand -hex 32`).");
  }

  if (!/^[0-9a-f]{64}$/i.test(mfaKey) && Buffer.from(mfaKey, "base64").length !== 32) {
    problems.push("MFA_ENCRYPTION_KEY must be 32 bytes (64 hex characters).");
  }

  if (jwtSecret && jwtSecret === mfaKey) {
    problems.push("JWT_SECRET and MFA_ENCRYPTION_KEY must be different.");
  }

  if (isProduction && !/^https:\/\//.test(process.env.FRONTEND_ORIGIN || "")) {
    problems.push("FRONTEND_ORIGIN must be set to the site's https:// address in production.");
  }

  if (problems.length) {
    throw new Error(`Unsafe configuration:\n- ${problems.join("\n- ")}`);
  }
}

// Adds security headers to every response
function securityHeaders(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cache-Control": "no-store",
  });

  if (isProduction) {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}

// Turns unhandled errors into JSON responses
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "That request is too large." });
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "The request body isn't valid JSON." });
  }

  if (err.type === "encoding.unsupported") {
    return res.status(415).json({ error: "Compressed requests aren't supported." });
  }

  if (err.corsRejected) {
    return res.status(403).json({ error: "Untrusted request origin." });
  }

  console.error(err);

  res.status(err.status && err.status < 500 ? err.status : 500).json({ error: "Something went wrong." });
}

module.exports = { checkSecrets, securityHeaders, errorHandler };
