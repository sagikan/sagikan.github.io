require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { requireTrustedOrigin, allowedOrigins } = require("./middleware/csrf");
const { checkSecrets, securityHeaders, errorHandler } = require("./middleware/security");
const { apiLimiter } = require("./middleware/rateLimit");
const authRoutes = require("./routes/auth");
const accountRoutes = require("./routes/account");
const applicationRoutes = require("./routes/applications");
const emailRoutes = require("./routes/email");
const emailIngestRoutes = require("./routes/emailIngest");
const jobRoutes = require("./routes/jobs");
const jobSearch = require("./services/jobs/jobSearch");
const jobFeeds = require("./services/jobs/jobFeeds");
const authService = require("./services/auth/authService");
const devMode = require("./services/shared/devMode");

const app = express();
const port = process.env.PORT || 3000;

checkSecrets();

app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? (process.env.NODE_ENV === "production" ? 1 : 0)));

app.use(securityHeaders);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins().includes(origin)) {
      return callback(null, true);
    }

    callback(Object.assign(new Error(`Origin not allowed: ${origin}`), { corsRejected: true }));
  },
  credentials: true,
  exposedHeaders: ["X-File-Name"]
}));

app.use("/api/email/ingest", express.json({ limit: "1mb", inflate: false }), emailIngestRoutes);

app.use("/api", apiLimiter);

app.use(express.json({ limit: "100kb", inflate: false }));
app.use(cookieParser());

// Checks the origin of state-changing requests
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return requireTrustedOrigin(req, res, next);
  }

  next();
});

// Reports that the API is up
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/jobs", jobRoutes);

// Responds to unknown routes
app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use(errorHandler);

// Starts the server and schedules the daily cleanup
app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);

  if (devMode.offline) {
    console.log("[dev] Paid and optional outside services are off: Claude, JSearch, posting checks and emails use local stand-ins. Set USE_REAL_APIS=true to use them.");
  }

  jobSearch.failInterrupted().catch((err) => console.error("Could not clear interrupted job searches:", err.message));

  // Removes old job postings and expired sessions
  const dailyCleanup = () => {
    jobFeeds.removeOldPostings().catch((err) => console.error("Could not remove old job postings:", err.message));
    authService.removeExpiredSessions().catch((err) => console.error("Could not remove expired sessions:", err.message));
  };

  dailyCleanup();
  setInterval(dailyCleanup, 24 * 60 * 60 * 1000).unref();
});
