
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});
// Temporary example endpoint
app.get("/api/applications", (req, res) => {
  res.json([]);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});
