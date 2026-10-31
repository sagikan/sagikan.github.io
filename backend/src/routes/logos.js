const express = require("express");
const requireAuth = require("../middleware/auth");
const { requireTrustedOrigin } = require("../middleware/csrf");
const { userLimiter } = require("../middleware/rateLimit");
const { getLogo, MAX_NAME_LENGTH } = require("../services/logos/logoService");

const router = express.Router();

/* A lookup spends money and writes to the cache, so the route is closed to requests from other sites
   (images embedded by another page send no Origin header) */
router.use(requireTrustedOrigin, requireAuth, userLimiter(300, 60, "Too many logo requests."));

// Returns a company's logo image, or 204 when it has none
router.get("/", async (req, res) => {
  const company = req.query.company;

  if (typeof company !== "string" || !company.trim() || company.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: "A company name is required." });
  }

  try {
    const logo = await getLogo(company, { userId: req.user.id });

    if (!logo) {
      return res.set("Cache-Control", "private, max-age=3600").status(204).end();
    }

    res.set({ "Content-Type": logo.contentType, "Cache-Control": "private, max-age=86400" });
    res.send(logo.image);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load the logo." });
  }
});

module.exports = router;
