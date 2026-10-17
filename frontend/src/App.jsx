import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL;

function App() {
  const [status, setStatus] = useState("Checking API...");
  const [csrfToken, setCsrfToken] = useState("");
  const [applications, setApplications] = useState([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [applicationStatus, setApplicationStatus] = useState("Applied");
  const [jobUrl, setJobUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [appliedAt, setAppliedAt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editCompany, setEditCompany] = useState("");
  const [editPosition, setEditPosition] = useState("");
  const [editStatus, setEditStatus] = useState("Applied");
  const [editJobUrl, setEditJobUrl] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editAppliedAt, setEditAppliedAt] = useState("");

  async function refreshCsrfToken() {
    const response = await fetch(
      `${API_URL}/api/auth/csrf`,
      { credentials: "include" }
    );

    if (!response.ok) {
      setCsrfToken("");
      return false;
    }

    const data = await response.json();
    setCsrfToken(data.csrfToken);
    return true;
  }

  useEffect(() => {
    async function initialize() {
      try {
        const health = await fetch(`${API_URL}/api/health`);

        if (!health.ok) {
          throw new Error("API request failed");
        }

        const result = await health.json();
        setStatus(`API status: ${result.status}`);
      } catch {
        setStatus("Could not connect to the API.");
        return;
      }

      if (await refreshCsrfToken()) {
        setAuthenticated(true);
        await loadApps();
      } else {
        setAuthenticated(false);
      }
    }

    initialize();
  }, []);

  async function loadApps() {
    try {
      const response = await fetch(
        `${API_URL}/api/applications`,
        { credentials: "include" }
      );

      if (response.status === 401) {
        setAuthenticated(false);
        setApplications([]);
        return;
      }

      if (!response.ok) {
        throw new Error("Could not load applications.");
      }

      const data = await response.json();
      setApplications(data);
      setAuthenticated(true);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAuth(event, action) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(
        `${API_URL}/api/auth/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Authentication failed.");
      }

      setPassword("");
      await refreshCsrfToken();
      await loadApps();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/auth/logout`,
        {
          method: "POST",
          credentials: "include",
          headers: { "X-CSRF-Token": csrfToken }
        }
      );

      if (!response.ok) {
        throw new Error("Could not log out.");
      }

      setAuthenticated(false);
      setApplications([]);
      setEmail("");
      setPassword("");
      setCompany("");
      setPosition("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddApp(event) {
    event.preventDefault();
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/applications`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken
          },
          body: JSON.stringify({
            company,
            position,
            status: applicationStatus,
            job_url: jobUrl || null,
            notes: notes || null,
            applied_at: appliedAt || null
          })
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401) {
          setAuthenticated(false);
        }

        throw new Error(data.error || "Could not add application.");
      }

      setCompany("");
      setPosition("");
      setApplicationStatus("Applied");
      setJobUrl("");
      setNotes("");
      setAppliedAt("");

      await loadApps();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteApp(id) {
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/applications/${id}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "X-CSRF-Token": csrfToken }
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          setAuthenticated(false);
        }

        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.error || "Could not delete application."
        );
      }

      setApplications((current) =>
        current.filter((job) => job.id !== id)
      );
    } catch (err) {
      setError(err.message);
    }
  }

  function handleStartEdit(job) {
    setEditingId(job.id);
    setEditCompany(job.company);
    setEditPosition(job.position);
    setEditStatus(job.status);
    setEditJobUrl(job.job_url || "");
    setEditNotes(job.notes || "");
    setEditAppliedAt(job.applied_at ? String(job.applied_at).slice(0, 10) : "");
    setError("");
  }

  function handleCancelEdit() {
    setEditingId(null);
    setError("");
  }

  async function handleUpdateApp(event) {
    event.preventDefault();
    setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/applications/${editingId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({
            company: editCompany,
            position: editPosition,
            status: editStatus,
            job_url: editJobUrl || null,
            notes: editNotes || null,
            applied_at: editAppliedAt || null
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401) {
          setAuthenticated(false);
          setApplications([]);
        }

        throw new Error(data.error || "Could not update application.");
      }

      setApplications((current) =>
        current.map((job) => job.id === data.id ? data : job)
      );

      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main>
      <h1>Job Tracker</h1>
      <p>{status}</p>

      {error && <p role="alert">{error}</p>}

      {!authenticated ? (
        <section>
          <h2>Welcome</h2>
          <p>Log in or create an account to manage your applications.</p>

          <form onSubmit={(event) => handleAuth(event, "login")}>
            <h3>Log In</h3>

            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
              />
            </label>

            <button type="submit" disabled={loading}>
              {loading ? "Please wait..." : "Log In"}
            </button>
          </form>

          <form onSubmit={(event) => handleAuth(event, "register")}>
            <h3>Create Account</h3>

            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </label>

            <label>
              Password (12–72 characters)
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={12}
                maxLength={72}
                required
                autoComplete="new-password"
              />
            </label>

            <button type="submit" disabled={loading}>
              {loading ? "Please wait..." : "Register"}
            </button>
          </form>
        </section>
      ) : (
        <section>
          <p>You are logged in as {email || "a registered user"}.</p>
          <button onClick={handleLogout}>Log Out</button>

          <h2>My Applications</h2>

          <form onSubmit={handleAddApp}>
            <h3>Add Application</h3>

            <label>
              Company
              <input
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                required
              />
            </label>

            <label>
              Position
              <input
                value={position}
                onChange={(event) => setPosition(event.target.value)}
                required
              />
            </label>

            <label>
              Status
              <select
                value={applicationStatus}
                onChange={(event) => setApplicationStatus(event.target.value)}
              >
                {["Applied", "Interview", "Offer", "Rejected", "Withdrawn"].map(
                  (status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  )
                )}
              </select>
            </label>

            <label>
              Job URL
              <input
                type="url"
                value={jobUrl}
                onChange={(event) => setJobUrl(event.target.value)}
                placeholder="https://..."
              />
            </label>

            <label>
              Date Applied
              <input
                type="date"
                value={appliedAt}
                onChange={(event) => setAppliedAt(event.target.value)}
              />
            </label>

            <label>
              Notes
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
              />
            </label>

            <button type="submit">Add Application</button>
          </form>

          {applications.length === 0 ? (
            <p>No applications yet.</p>
          ) : (
            <ul>
              {applications.map((job) => (
                <li key={job.id}>
                  {editingId === job.id ? (
                    <form onSubmit={handleUpdateApp}>
                      <h3>Edit Application</h3>

                      <label>
                        Company
                        <input
                          value={editCompany}
                          onChange={(event) => setEditCompany(event.target.value)}
                          required
                        />
                      </label>

                      <label>
                        Position
                        <input
                          value={editPosition}
                          onChange={(event) => setEditPosition(event.target.value)}
                          required
                        />
                      </label>

                      <label>
                        Status
                        <select
                          value={editStatus}
                          onChange={(event) => setEditStatus(event.target.value)}
                        >
                          {["Applied", "Interview", "Offer", "Rejected", "Withdrawn"].map(
                            (status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            )
                          )}
                        </select>
                      </label>

                      <label>
                        Job URL
                        <input
                          type="url"
                          value={editJobUrl}
                          onChange={(event) => setEditJobUrl(event.target.value)}
                          placeholder="https://..."
                        />
                      </label>

                      <label>
                        Date Applied
                        <input
                          type="date"
                          value={editAppliedAt}
                          onChange={(event) => setEditAppliedAt(event.target.value)}
                        />
                      </label>

                      <label>
                        Notes
                        <textarea
                          value={editNotes}
                          onChange={(event) => setEditNotes(event.target.value)}
                          rows={3}
                        />
                      </label>

                      <button type="submit">Save Changes</button>
                      <button type="button" onClick={handleCancelEdit}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <strong>{job.company}</strong> — {job.position}
                      <p>Status: {job.status}</p>

                      {job.applied_at && (
                        <p>Applied: {String(job.applied_at).slice(0, 10)}</p>
                      )}

                      {job.job_url && (
                        <p>
                          <a href={job.job_url} target="_blank" rel="noreferrer">
                            Job Posting
                          </a>
                        </p>
                      )}

                      {job.notes && <p>Notes: {job.notes}</p>}

                      <button onClick={() => handleStartEdit(job)}>
                        Edit
                      </button>

                      <button onClick={() => handleDeleteApp(job.id)}>
                        Delete
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

export default App;
