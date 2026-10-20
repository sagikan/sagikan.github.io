const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { requireTrustedOrigin } = require("./middleware/csrf");
const authRoutes = require("./routes/auth");
const accountRoutes = require("./routes/account");
const applicationRoutes = require("./routes/applications");
const emailRoutes = require("./routes/email");
const emailIngestRoutes = require("./routes/emailIngest");
require("dotenv").config();

const app = express();

app.set("trust proxy", Number(process.env.TRUST_PROXY ?? (process.env.NODE_ENV === "production" ? 1 : 0)));

const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_ORIGIN
].filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origin not allowed: ${origin}`));
  },
  credentials: true
}));

app.use("/api/email/ingest", express.json({ limit: "1mb" }), emailIngestRoutes);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return requireTrustedOrigin(req, res, next);
  }

  next();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/email", emailRoutes);

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});
