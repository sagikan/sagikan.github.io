import { useCallback, useEffect, useState } from "react";
import { apiRequest, checkHealth } from "./lib/api";
import { navigate, redirect, useHashRoute } from "./lib/router";
import Navbar from "./components/layout/Navbar";
import Alert from "./components/ui/Alert";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Applications from "./pages/Applications";
import Account from "./pages/Account";
import Jobs from "./pages/Jobs";

const PROTECTED_ROUTES = ["/applications", "/jobs", "/account"];
const NO_EMAIL_UPDATES = { pending: [], recent: [] };
const EMAIL_REFRESH_MS = 2 * 60 * 1000;
const API_LABELS = {
  checking: "Connecting…",
  online: "API online",
  offline: "API offline"
};

// Root component: checks the session and routes between pages
function App() {
  const route = useHashRoute();
  const [apiStatus, setApiStatus] = useState("checking");
  const [booting, setBooting] = useState(true);
  const [csrfToken, setCsrfToken] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [applications, setApplications] = useState([]);
  const [emailUpdates, setEmailUpdates] = useState(NO_EMAIL_UPDATES);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(null);

  // Clears all signed-in state
  const clearSession = useCallback(() => {
    setAuthenticated(false);
    setApplications([]);
    setEmailUpdates(NO_EMAIL_UPDATES);
    setCsrfToken("");
  }, []);

  // Loads pending and recent email updates
  const loadEmailUpdates = useCallback(async () => {
    const result = await apiRequest("/api/email/events").catch(() => null);

    if (result?.response.ok) {
      setEmailUpdates(result.data);
    }
  }, []);

  // Fetches the CSRF token for the current session
  const refreshCsrfToken = useCallback(async () => {
    const { response, data } = await apiRequest("/api/auth/csrf");

    if (!response.ok) {
      setCsrfToken("");

      return false;
    }

    setCsrfToken(data.csrfToken);

    return true;
  }, []);

  // Loads the signed-in user's email
  const loadUser = useCallback(async () => {
    const { response, data } = await apiRequest("/api/auth/me");

    if (response.ok) {
      setEmail(data.user.email);
    }
  }, []);

  // Loads the user's applications
  const loadApps = useCallback(async () => {
    try {
      const { response, data } = await apiRequest("/api/applications");

      if (response.status === 401) {
        clearSession();

        return;
      }

      if (!response.ok) {
        throw new Error("Could not load applications.");
      }

      setApplications(data);
      setAuthenticated(true);
      setError("");
      loadEmailUpdates();
    } catch (err) {
      setError(err.message);
    }
  }, [clearSession, loadEmailUpdates]);

  useEffect(() => {
    // Checks the API and restores the session on first load
    async function initialize() {
      try {
        const result = await checkHealth();
        setApiStatus(result.status === "ok" ? "online" : "offline");
      } catch {
        setApiStatus("offline");
        setBooting(false);

        return;
      }

      try {
        if (await refreshCsrfToken()) {
          setAuthenticated(true);
          await Promise.all([loadUser(), loadApps()]);
        } else {
          setAuthenticated(false);
        }
      } catch {
        setAuthenticated(false);
      } finally {
        setBooting(false);
      }
    }

    initialize();
  }, [refreshCsrfToken, loadUser, loadApps]);

  useEffect(() => {
    if (booting) {
      return;
    }

    if (PROTECTED_ROUTES.includes(route) && !authenticated) {
      redirect("/login");
    } else if ((route === "/login" || route === "/signup") && authenticated) {
      redirect("/applications");
    }
  }, [route, authenticated, booting]);

  useEffect(() => {
    if (!authenticated || route !== "/applications") {
      return;
    }

    // Reloads email updates while the tab is visible
    const refresh = () => {
      if (!document.hidden) {
        loadEmailUpdates();
      }
    };

    const timer = setInterval(refresh, EMAIL_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [authenticated, route, loadEmailUpdates]);

  // Loads the user's applications after sign-in and opens them
  async function completeLogin(userEmail) {
    setFlash(null);
    setEmail(userEmail);

    try {
      if (await refreshCsrfToken()) {
        setAuthenticated(true);
      }

      await loadApps();
    } catch {
      setError("Could not load your applications.");
    }

    navigate("/applications");
  }

  // Logs out and returns to the home page
  async function handleLogout() {
    setError("");

    try {
      const { response } = await apiRequest("/api/auth/logout", {
        method: "POST",
        csrfToken
      });

      if (!response.ok) {
        throw new Error("Could not log out.");
      }

      clearSession();
      setEmail("");
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  }

  // Clears the session and shows a goodbye message after account deletion
  function handleAccountDeleted(message) {
    clearSession();
    setEmail("");
    setFlash({ message, route: "/" });
    navigate("/");
  }

  // Creates or updates an application and returns an error message, if any
  async function saveApp(id, fields) {
    try {
      const { response, data } = await apiRequest(
        id ? `/api/applications/${id}` : "/api/applications",
        { method: id ? "PATCH" : "POST", body: fields, csrfToken }
      );

      if (!response.ok) {
        if (response.status === 401) {
          clearSession();
        }

        return data.error || (id ? "Could not update application." : "Could not add application.");
      }

      setApplications((current) =>
        id ? current.map((job) => (job.id === data.id ? data : job)) : [data, ...current]
      );

      return "";
    } catch {
      return "Could not reach the server. Please try again.";
    }
  }

  // Deletes an application
  async function handleDeleteApp(id) {
    setError("");

    try {
      const { response, data } = await apiRequest(`/api/applications/${id}`, {
        method: "DELETE",
        csrfToken
      });

      if (!response.ok) {
        if (response.status === 401) {
          clearSession();
        }

        throw new Error(data.error || "Could not delete application.");
      }

      setApplications((current) => current.filter((job) => job.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  // Accepts, dismisses or undoes an email update
  async function resolveEmailUpdate(id, action, body = {}) {
    try {
      const { response, data } = await apiRequest(`/api/email/events/${id}/${action}`, {
        method: "POST",
        body,
        csrfToken
      });

      if (!response.ok) {
        if (response.status === 401) {
          clearSession();
        }

        return data.error || "Could not update. Please try again.";
      }

      if (data.application) {
        setApplications((current) => current.map((job) => (job.id === data.application.id ? data.application : job)));
      }

      await loadEmailUpdates();

      return "";
    } catch {
      return "Could not reach the server. Please try again.";
    }
  }

  // Changes an application's status from its card
  async function handleQuickStatus(id, status) {
    const message = await saveApp(id, { status });
    setError(message);
  }

  let page;

  if (route === "/login" || route === "/signup") {
    page = (
      <Login
        key={route}
        mode={route === "/signup" ? "register" : "login"}
        onAuthenticated={completeLogin}
        apiStatus={apiStatus}
      />
    );
  } else if (PROTECTED_ROUTES.includes(route) && (booting || !authenticated)) {
    page = (
      <div className="page-loader" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        Loading…
      </div>
    );
  } else if (route === "/account") {
    page = (
      <Account
        csrfToken={csrfToken}
        onSessionChanged={refreshCsrfToken}
        onUnauthorized={clearSession}
        onDeleted={handleAccountDeleted}
      />
    );
  } else if (route === "/jobs") {
    page = (
      <Jobs
        csrfToken={csrfToken}
        applications={applications}
        onApplied={(application) => setApplications((current) => [application, ...current])}
        onUnauthorized={clearSession}
      />
    );
  } else if (route === "/applications") {
    page = (
      <Applications
        applications={applications}
        emailUpdates={emailUpdates}
        onResolveEmailUpdate={resolveEmailUpdate}
        error={error}
        onDismissError={() => setError("")}
        onSave={saveApp}
        onDelete={handleDeleteApp}
        onQuickStatus={handleQuickStatus}
      />
    );
  } else {
    page = <Landing authenticated={authenticated} />;
  }

  return (
    <div className="app">
      <Navbar
        route={route}
        authenticated={authenticated}
        email={email}
        onLogout={handleLogout}
      />
      {flash && flash.route === route && (
        <div className="flash" role="status">
          <Alert type="success" onDismiss={() => setFlash(null)}>{flash.message}</Alert>
        </div>
      )}
      {page}
      <footer className="footer">
        <div className="footer-inner">
          <div className={`api-pill api-${apiStatus}`} title={API_LABELS[apiStatus]}>
            <span className="api-dot" aria-hidden="true" />
          </div>
          © {new Date().getFullYear()} Applicant Zero
        </div>
      </footer>
    </div>
  );
}

export default App;
