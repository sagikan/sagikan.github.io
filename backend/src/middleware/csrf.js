// Lists the origins allowed to call the API
function allowedOrigins() {
  return [
    process.env.NODE_ENV === "production" ? null : "http://localhost:5173",
    process.env.FRONTEND_ORIGIN
  ].filter(Boolean);
}

// Rejects requests from origins that aren't allowed
function requireTrustedOrigin(req, res, next) {
  const origin = req.get("Origin");

  if (!origin || !allowedOrigins().includes(origin)) {
    return res.status(403).json({ error: "Untrusted request origin." });
  }

  next();
}

// Rejects state-changing requests that don't come from an allowed origin
function csrfOriginProtection(req, res, next) {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return requireTrustedOrigin(req, res, next);
  }

  next();
}

// Rejects state-changing requests without a matching CSRF token
function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const csrfToken = req.get("X-CSRF-Token");

  if (
    !req.user?.csrfToken ||
    typeof csrfToken !== "string" ||
    csrfToken !== req.user.csrfToken
  ) {
    return res.status(403).json({ error: "Invalid or missing CSRF token." });
  }

  next();
}

module.exports = { allowedOrigins, requireTrustedOrigin, csrfOriginProtection, requireCsrf };
