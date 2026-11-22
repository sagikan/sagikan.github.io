import { useCallback, useEffect, useState } from "react";
import { apiRequest, checkHealth, onReachability } from "./lib/api";
import { navigate, redirect, useHashRoute } from "./lib/router";
import { useMachine } from "./hooks/useMachine";
import { useStepSaves } from "./hooks/useStepSaves";
import { API_HEALTH, SESSION } from "./utils/auth/authMachines";
import Footer from "./components/layout/Footer";
import Navbar from "./components/layout/Navbar";
import Alert from "./components/ui/Alert";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Applications from "./pages/Applications";
import Account from "./pages/Account";
import Jobs from "./pages/Jobs";
import Privacy from "./pages/Privacy";
import PolicyNotice from "./components/auth/PolicyNotice";
import { POLICY_VERSION, needsPolicyNotice } from "./utils/policy/policy";

const PROTECTED_ROUTES = ["/applications", "/jobs", "/account"];
const NO_EMAIL_UPDATES = { pending: [], recent: [] };
const EMAIL_REFRESH_MS = 2 * 60 * 1000;

// Root component: checks the session and routes between pages
function App() {
  const route = useHashRoute();
  const [apiStatus, sendHealth] = useMachine(API_HEALTH);
  const [session, sendSession] = useMachine(SESSION);
  const [csrfToken, setCsrfToken] = useState("");
  const authenticated = session === "signed_in";
  const [email, setEmail] = useState("");
  const [seenPolicy, setSeenPolicy] = useState(undefined);
  const [applications, setApplications] = useState([]);
  const [emailUpdates, setEmailUpdates] = useState(NO_EMAIL_UPDATES);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(null);

  // Clears all signed-in state
  const clearSession = useCallback(() => {
    sendSession("signOut");
    setApplications([]);
    setEmailUpdates(NO_EMAIL_UPDATES);
    setSeenPolicy(undefined);
    setCsrfToken("");
  }, [sendSession]);

  // Loads pending and recent email updates
  const loadEmailUpdates = useCallback(async () => {
    const result = await apiRequest("/api/email/events").catch(() => null);

    if (result?.response.ok) {
      setEmailUpdates(result.data);
    }
  }, []);
  const stepSaves = useStepSaves({
    applications,
    setApplications,
    onError: setError,
    onUnauthorized: clearSession,
    onSaved: loadEmailUpdates,
    csrfToken
  });

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
      setSeenPolicy(data.user.policyVersion);
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
      sendSession("signIn");
      setError("");
      loadEmailUpdates();
    } catch (err) {
      setError(err.message);
    }
  }, [clearSession, loadEmailUpdates, sendSession]);

  useEffect(() => onReachability((reached) => sendHealth(reached ? "online" : "offline")), [sendHealth]);

  useEffect(() => {
    let current = true;

    // Moves the session, unless this run was replaced (React runs effects twice in development)
    function settle(move) {
      if (current) {
        sendSession(move);
      }
    }

    // Checks the API and restores the session on first load
    async function initialize() {
      try {
        const result = await checkHealth();
        sendHealth(result.status === "ok" ? "online" : "offline");
      } catch {
        sendHealth("offline");
        settle("signOut");

        return;
      }

      try {
        if (await refreshCsrfToken()) {
          await Promise.all([loadUser(), loadApps()]);
          settle("restore");
        } else {
          settle("signOut");
        }
      } catch {
        settle("signOut");
      }
    }

    initialize();

    return () => {
      current = false;
    };
  }, [refreshCsrfToken, loadUser, loadApps, sendHealth, sendSession]);

  useEffect(() => {
    if (session === "restoring") {
      return;
    }

    if (PROTECTED_ROUTES.includes(route) && !authenticated) {
      redirect("/login");
    } else if ((route === "/login" || route === "/signup") && authenticated) {
      redirect("/applications");
    }
  }, [route, authenticated, session]);

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

  // Records that the user has seen the current privacy policy, and closes the notice
  const acknowledgePolicy = useCallback(async () => {
    setSeenPolicy(POLICY_VERSION);

    if (csrfToken) {
      await apiRequest("/api/account/policy", { method: "POST", body: { version: POLICY_VERSION }, csrfToken }).catch(() => {});
    }
  }, [csrfToken]);

  // Loads the user's applications after sign-in and opens them
  async function completeLogin(userEmail) {
    setFlash(null);
    setEmail(userEmail);

    try {
      if (await refreshCsrfToken()) {
        sendSession("signIn");
      }

      await Promise.all([loadUser(), loadApps()]);
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

  /* Creates or updates an application and returns an error message, if any. An edit can add a status, which changes
     which email updates still apply, so they're reloaded */
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

      if (id) {
        loadEmailUpdates();
      }

      return "";
    } catch {
      return "Could not reach the server. Please try again.";
    }
  }

  /* Deletes an application, which dismisses its waiting email updates; the same function on every render, so cards that
     get it can skip re-rendering */
  const handleDeleteApp = useCallback(async (id) => {
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
      loadEmailUpdates();
    } catch (err) {
      setError(err.message);
    }
  }, [csrfToken, clearSession, loadEmailUpdates]);

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
        } else {
          // The update may be out of date (its application changed since): the fresh lists drop its buttons
          await loadEmailUpdates();
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
  } else if (PROTECTED_ROUTES.includes(route) && !authenticated) {
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
        csrfToken={csrfToken}
        onUnauthorized={clearSession}
        applications={applications}
        emailUpdates={emailUpdates}
        onResolveEmailUpdate={resolveEmailUpdate}
        error={error}
        onDismissError={() => setError("")}
        onSave={saveApp}
        onDelete={handleDeleteApp}
        savingIds={stepSaves.savingIds}
        onAddStep={stepSaves.onAddStep}
        onChangeStep={stepSaves.onChangeStep}
        onRemoveStep={stepSaves.onRemoveStep}
      />
    );
  } else if (route === "/privacy") {
    page = <Privacy />;
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
      {needsPolicyNotice({ authenticated, seenVersion: seenPolicy, route }) && (
        <PolicyNotice
          onClose={acknowledgePolicy}
          onReview={() => {
            acknowledgePolicy();
            navigate("/privacy");
          }}
        />
      )}
      <Footer apiStatus={apiStatus} />
    </div>
  );
}

export default App;
