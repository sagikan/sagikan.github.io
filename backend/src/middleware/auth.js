const db = require("../config/db");
const { verifyToken, hashSessionId, renewSession, clearSessionCookies } = require("../services/authService");

async function requireAuth(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  let payload;

  try {
    payload = verifyToken(token);

    if (payload.typ !== "session" || typeof payload.sid !== "string") {
      throw new Error("Not a session token");
    }
  } catch {
    clearSessionCookies(res);
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  let session;

  try {
    const result = await db.query(
      `SELECT s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = $1 AND s.user_id = $2 AND s.expires_at > NOW() AND u.token_version = $3`,
      [hashSessionId(payload.sid), payload.id, payload.ver]
    );
    session = result.rows[0];
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not verify session." });
  }

  if (!session) {
    clearSessionCookies(res);
    return res.status(401).json({ error: "Your session has ended. Please log in again." });
  }

  req.user = payload;
  renewSession(res, payload, session.expires_at.getTime());
  next();
}

module.exports = requireAuth;
