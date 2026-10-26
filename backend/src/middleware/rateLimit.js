const { rateLimit } = require("express-rate-limit");

// Creates a rate limiter with a JSON error message
function limiter(limit, minutes, error, options = {}) {
  return rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...options,
    handler: (req, res) => {
      const resetTime = req.rateLimit?.resetTime;
      const minutesLeft = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 60000))
        : minutes;

      res.status(429).json({
        error: `${error} Please try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`,
      });
    },
  });
}

// Creates a rate limiter keyed by the signed-in user
function userLimiter(limit, minutes, error) {
  return limiter(limit, minutes, error, { keyGenerator: (req) => `user:${req.user.id}` });
}

module.exports = {
  apiLimiter: limiter(1000, 15, "Too many requests."),
  loginLimiter: limiter(20, 15, "Too many login attempts."),
  registerLimiter: limiter(5, 60, "Too many accounts created from this network."),
  passwordResetLimiter: limiter(10, 15, "Too many password reset attempts."),
  codeLimiter: limiter(30, 15, "Too many attempts."),
  userLimiter,
};
