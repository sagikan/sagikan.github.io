function allowedOrigins() {
  return ["http://localhost:5173", process.env.FRONTEND_ORIGIN].filter(Boolean);
}

function requireTrustedOrigin(req, res, next) {
  const origin = req.get("Origin");

  if (!origin || !allowedOrigins().includes(origin)) {
    return res.status(403).json({ error: "Untrusted request origin." });
  }

  next();
}

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

module.exports = { requireTrustedOrigin, requireCsrf };
