const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");
const requireAuth = require("./authMiddleware");
const { requireCsrf } = require("./csrfMiddleware");

const router = express.Router();
const isProduction = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge: 60 * 60 * 1000, // 1 hour
  path: "/",
};

router.get("/csrf", requireAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ csrfToken: req.user.csrfToken });
});

router.post("/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = req.body.password;

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 72
    ) {
      return res.status(400).json({
        error: "Enter a valid email and a password of 12–72 characters."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email`,
      [email, passwordHash]
    );
    const user = result.rows[0];
    const token = jwt.sign(
      {
        id: user.id,
        csrfToken: crypto.randomBytes(32).toString("hex"),
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.cookie("token", token, cookieOptions);
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "An account with this email already exists."
      });
    }

    console.error(err);
    res.status(500).json({ error: "Could not create account." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = req.body.password;

    if (typeof password !== "string") {
      return res.status(400).json({ error: "Invalid credentials." });
    }

    const result = await db.query(
      `SELECT id, email, password_hash
       FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const token = jwt.sign(
      {
        id: user.id,
        csrfToken: crypto.randomBytes(32).toString("hex")
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.cookie("token", token, cookieOptions);
    res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not log in." });
  }
});

router.post("/logout", requireAuth, requireCsrf, (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  });

  res.json({ message: "Logged out successfully." });
});

module.exports = router;
