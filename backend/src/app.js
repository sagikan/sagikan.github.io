const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { csrfOriginProtection, allowedOrigins } = require("./middleware/csrf");
const { checkSecrets, securityHeaders, errorHandler } = require("./middleware/security");
const { apiLimiter } = require("./middleware/rateLimit");
const authRoutes = require("./routes/auth");
const accountRoutes = require("./routes/account");
const applicationRoutes = require("./routes/applications");
const emailRoutes = require("./routes/email");
const emailIngestRoutes = require("./routes/emailIngest");
const jobRoutes = require("./routes/jobs");

const app = express();

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

app.use(csrfOriginProtection);

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

module.exports = app;
