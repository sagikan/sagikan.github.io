const jwt = require("jsonwebtoken");
const db = require("../config/db");

async function requireAuth(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.typ !== "session") {
      throw new Error("Not a session token");
    }
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  try {
    const result = await db.query(`SELECT token_version FROM users WHERE id = $1`, [payload.id]);
    const user = result.rows[0];

    if (!user || user.token_version !== payload.ver) {
      return res.status(401).json({ error: "Your session has ended. Please log in again." });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not verify session." });
  }

  req.user = payload;
  next();
}

module.exports = requireAuth;
