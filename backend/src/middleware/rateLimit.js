const { rateLimit } = require("express-rate-limit");

function limiter(limit, minutes, error) {
  return rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
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

module.exports = {
  loginLimiter: limiter(20, 15, "Too many login attempts."),
  registerLimiter: limiter(5, 60, "Too many accounts created from this network."),
  passwordResetLimiter: limiter(10, 15, "Too many password reset attempts."),
  codeLimiter: limiter(30, 15, "Too many attempts."),
};
