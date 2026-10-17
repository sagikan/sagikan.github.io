const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { requireTrustedOrigin } = require("./csrfMiddleware");
const authRoutes = require("./auth");
const applicationRoutes = require("./applications");
require("dotenv").config();

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_ORIGIN
].filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error("Origin not allowed"));
  },
  credentials: true
}));

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
app.use("/api/applications", applicationRoutes);

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});
