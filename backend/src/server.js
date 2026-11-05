require("dotenv").config();
const app = require("./app");
const jobSearch = require("./services/jobs/jobSearch");
const jobFeeds = require("./services/jobs/jobFeeds");
const authService = require("./services/auth/authService");
const logoService = require("./services/logos/logoService");
const devMode = require("./services/shared/devMode");

const port = process.env.PORT || 3000;

// Starts the server and schedules the daily cleanup
app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);

  if (process.env.NODE_ENV === "development" && !devMode.development) {
    console.warn("[dev] NODE_ENV=development but FRONTEND_ORIGIN is not a local address: the dev sign-up shortcuts stay off.");
  }

  if (devMode.offline) {
    console.log("[dev] Paid and optional outside services are off: Claude, JSearch, posting checks and emails use local stand-ins. Set USE_REAL_APIS=true to use them.");
  }

  jobSearch.failInterrupted().catch((err) => console.error("Could not clear interrupted job searches:", err.message));

  // Removes old job postings, expired sessions and old notes that no logo was found
  const dailyCleanup = () => {
    jobFeeds.removeOldPostings().catch((err) => console.error("Could not remove old job postings:", err.message));
    authService.removeExpiredSessions().catch((err) => console.error("Could not remove expired sessions:", err.message));
    logoService.removeOldMisses().catch((err) => console.error("Could not remove old logo notes:", err.message));
  };

  dailyCleanup();
  setInterval(dailyCleanup, 24 * 60 * 60 * 1000).unref();
});
