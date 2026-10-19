import { useCallback, useEffect, useRef, useState } from "react";
import MfaSetupStep from "../components/auth/MfaSetupStep";
import PasswordInput from "../components/auth/PasswordInput";
import RecoveryCodesStep from "../components/auth/RecoveryCodesStep";
import SecondFactorInput from "../components/auth/SecondFactorInput";
import { API_URL, apiRequest } from "../api";
import appsScript from "../emailSync/Code.gs?raw";
import appsScriptManifest from "../emailSync/appsscript.json?raw";
import { emptySecondFactor, isSecondFactorComplete, secondFactorBody } from "../utils/authForms";

const LOW_RECOVERY_CODES = 3;
const COPIED_LABEL_MS = 2000;
const NO_EMAIL_SYNC = { connected: false, autoUpdate: false, lastIngestAt: null, classifierConfigured: true };

function Account({ csrfToken, onSessionChanged, onUnauthorized, onDeleted }) {
  const [recoveryCodesLeft, setRecoveryCodesLeft] = useState(null);
  const [emailSync, setEmailSync] = useState(NO_EMAIL_SYNC);
  const [loadError, setLoadError] = useState("");
  const [panel, setPanel] = useState(null);
  const [success, setSuccess] = useState("");

  const request = useCallback(async (path, body) => {
    try {
      const { response, data } = await apiRequest(path, {
        method: body === undefined ? "GET" : "POST",
        body,
        csrfToken
      });

      if (response.status === 401) {
        onUnauthorized();
      }

      return {
        ok: response.ok,
        data,
        error: response.ok ? "" : data.error || "Something went wrong. Please try again."
      };
    } catch {
      return { ok: false, data: {}, error: "Could not reach the server. Please try again." };
    }
  }, [csrfToken, onUnauthorized]);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let ignore = false;

    request("/api/account/security").then((result) => {
      if (ignore) {
        return;
      }

      if (result.ok) {
        setRecoveryCodesLeft(result.data.recoveryCodesLeft);
        setLoadError("");
      } else {
        setLoadError(result.error);
      }
    });

    request("/api/email/status").then((result) => {
      if (!ignore && result.ok) {
        setEmailSync(result.data);
      }
    });

    return () => {
      ignore = true;
    };
  }, [request, refreshKey]);

  function openPanel(next) {
    setSuccess("");
    setPanel(next);
  }

  function closePanel(message = "") {
    setPanel(null);
    setSuccess(message);
    setRefreshKey((current) => current + 1);
  }

  return (
    <main className="dashboard account-page">
      <div className="dashboard-header">
        <div>
          <h1>Your Account</h1>
          <p className="muted">Manage how you sign in to your account.</p>
        </div>
      </div>

      <div className="account-content">
        {loadError && <div className="alert alert-error" role="alert">{loadError}</div>}
        {success && <div className="alert alert-success" role="status">{success}</div>}

        <section className="settings-card">
          <div className="settings-row">
            <div>
              <div className="settings-heading">
                <h2>Recovery codes</h2>
                {recoveryCodesLeft !== null && (
                  <>
                    <span className="settings-divider" aria-hidden="true" />
                    <span className={recoveryCodesLeft <= LOW_RECOVERY_CODES ? "settings-status warn" : "settings-status"}>
                      {recoveryCodesLeft} unused code{recoveryCodesLeft === 1 ? "" : "s"} left
                      {recoveryCodesLeft <= LOW_RECOVERY_CODES && ". Generate new ones soon."}
                    </span>
                  </>
                )}
              </div>
              <p className="muted">
                Single-use codes that let you sign in if you lose your authenticator app.
              </p>
            </div>
            {panel !== "codes" && (
              <button type="button" className="btn btn-ghost" onClick={() => openPanel("codes")}>
                Generate new codes
              </button>
            )}
          </div>

          {panel === "codes" && (
            <RegenerateCodesPanel
              request={request}
              onCancel={() => setPanel(null)}
              onDone={() => closePanel("New recovery codes are active. Your old codes no longer work.")}
            />
          )}
        </section>

        <section className="settings-card">
          <div className="settings-row">
            <div>
              <h2>Authenticator</h2>
              <p className="muted">
                Got a new phone? Link a new authenticator app.
              </p>
            </div>
            {panel !== "authenticator" && (
              <button type="button" className="btn btn-ghost" onClick={() => openPanel("authenticator")}>
                Set up new authenticator
              </button>
            )}
          </div>

          {panel === "authenticator" && (
            <ResetAuthenticatorPanel
              request={request}
              onSessionChanged={onSessionChanged}
              onCancel={() => setPanel(null)}
              onDone={() => closePanel("Your new authenticator app is set up.")}
            />
          )}
        </section>

        <EmailSyncCard
          status={emailSync}
          panel={panel}
          request={request}
          openPanel={openPanel}
          setPanel={setPanel}
          closePanel={closePanel}
        />

        <section className="settings-card">
          <div className="settings-row">
            <div>
              <h2>Password</h2>
              <p className="muted">
                To change your password, log out and choose "Forgot password?" on the login page.
              </p>
            </div>
          </div>
        </section>

        <section className="settings-card settings-card-danger">
          <div className="settings-row">
            <div>
              <h2>Delete account</h2>
              <p className="muted">
                Permanently delete your account and all of your job applications.
              </p>
            </div>
            {panel !== "delete" && (
              <button type="button" className="btn btn-danger-outline" onClick={() => openPanel("delete")}>
                Delete account
              </button>
            )}
          </div>

          {panel === "delete" && (
            <DeleteAccountPanel request={request} onCancel={() => setPanel(null)} onDeleted={onDeleted} />
          )}
        </section>
      </div>
    </main>
  );
}

function lastSyncLabel(lastIngestAt) {
  if (!lastIngestAt) {
    return "Waiting for the first sync";
  }

  return `Last synced ${new Date(lastIngestAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function EmailSyncCard({ status, panel, request, openPanel, setPanel, closePanel }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function toggleAutoUpdate(event) {
    setError("");
    setSaving(true);

    const result = await request("/api/email/settings", { autoUpdate: event.target.checked });

    setSaving(false);

    if (result.ok) {
      closePanel();
    } else {
      setError(result.error);
    }
  }

  async function disconnect() {
    setError("");

    const result = await request("/api/email/disconnect", {});

    if (result.ok) {
      closePanel("Email sync is disconnected. You can delete the script from your Google account.");
    } else {
      setError(result.error);
    }
  }

  return (
    <section className="settings-card">
      <div className="settings-row">
        <div>
          <div className="settings-heading">
            <h2>Email sync</h2>
            {status.connected && (
              <>
                <span className="settings-divider" aria-hidden="true" />
                <span className="settings-status">{lastSyncLabel(status.lastIngestAt)}</span>
              </>
            )}
          </div>
          <p className="muted">
            For reading your job-related emails and suggesting status updates.
          </p>
        </div>
        {panel !== "email" && (
          <button type="button" className="btn btn-ghost" onClick={() => openPanel("email")}>
            {status.connected ? "Get a new script" : "Set up email sync"}
          </button>
        )}
      </div>

      {!status.classifierConfigured && (
        <div className="alert alert-warning" role="status">
          No API key configured.
        </div>
      )}

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {status.connected && panel !== "email" && (
        <div className="settings-panel">
          <label className="switch-row">
            <input type="checkbox" checked={status.autoUpdate} disabled={saving} onChange={toggleAutoUpdate} />
            <span>
              <strong>Update statuses automatically</strong>
              <small className="muted">
                Only confident matches are applied and are easily reversible.
                Everything else waits for your review.
              </small>
            </span>
          </label>

          {panel === "emailDisconnect" ? (
            <div className="form-actions">
              <span className="muted">Disconnect and delete all email suggestions?</span>
              <button type="button" className="btn btn-ghost" onClick={() => setPanel(null)}>Keep</button>
              <button type="button" className="btn btn-danger" onClick={disconnect}>Disconnect</button>
            </div>
          ) : (
            <div className="form-actions">
              <button type="button" className="btn btn-danger-outline" onClick={() => openPanel("emailDisconnect")}>
                Disconnect
              </button>
            </div>
          )}
        </div>
      )}

      {panel === "email" && (
        <EmailSyncSetupPanel
          request={request}
          replacing={status.connected}
          onCancel={() => setPanel(null)}
          onDone={() => closePanel("Email sync is set up. The first sync runs as soon as you start the script.")}
        />
      )}
    </section>
  );
}

function CopyBlock({ label, text }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(null);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function copy() {
    clearTimeout(resetTimer.current);

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      resetTimer.current = setTimeout(() => setCopied(false), COPIED_LABEL_MS);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="copy-block">
      <div className="copy-block-header">
        <span>{label}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <textarea readOnly value={text} rows={6} spellCheck={false} onFocus={(event) => event.target.select()} />
    </div>
  );
}

function EmailSyncSetupPanel({ request, replacing, onCancel, onDone }) {
  const [confirmed, setConfirmed] = useState(!replacing);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const started = useRef(false);

  // Creating a token replaces the old one, so start straight away unless a working script would be replaced
  useEffect(() => {
    if (!confirmed || started.current) {
      return;
    }

    started.current = true;

    request("/api/email/token", {}).then((result) => {
      if (result.ok) {
        setToken(result.data.token);
      } else {
        setError(result.error);
        started.current = false;
      }
    });
  }, [confirmed, request]);

  if (token) {
    const script = appsScript.replace("__API_URL__", API_URL || "").replace("__TOKEN__", token);

    return (
      <div className="settings-panel">
        <ol className="setup-steps">
          <li>
            Open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com</a>{" "}
            (signed in to the Gmail account you apply with) and create a new project.
          </li>
          <li>
            In <strong>Project Settings</strong> (the gear), tick <strong>Show "appsscript.json" manifest file in editor</strong>.
            Back in the editor, open <strong>appsscript.json</strong> and replace its contents with:
            <CopyBlock label="appsscript.json" text={appsScriptManifest} />
          </li>
          <li>
            Open <strong>Code.gs</strong> and replace its contents with the script below. It contains your private
            token, so don't share it.
            <CopyBlock label="Code.gs" text={script} />
          </li>
          <li>
            Choose the <strong>setup</strong> function in the toolbar and click <strong>Run</strong>. Google will ask for
            permission to read your mail. It shows an "unverified app" warning because the script is yours: click{" "}
            <strong>Advanced → Go to project (unsafe)</strong>.
          </li>
        </ol>
        <p className="muted">
          <b>That's it!</b> It checks your mail every 12 hours (the first run covers the last 45 days). This token is only shown
          now. If you lose it, generate a new script, which stops the old one from working.
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }

  if (!confirmed) {
    return (
      <div className="settings-panel">
        <p className="muted">
          This replaces your current script. It stops working until you install the new one.
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => setConfirmed(true)}>Create new script</button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-panel">
      {error ? (
        <>
          <div className="alert alert-error" role="alert">{error}</div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Close</button>
          </div>
        </>
      ) : (
        <div className="page-loader" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          Creating your script…
        </div>
      )}
    </div>
  );
}

function RegenerateCodesPanel({ request, onCancel, onDone }) {
  const [factor, setFactor] = useState(emptySecondFactor);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [codes, setCodes] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await request("/api/account/recovery-codes", secondFactorBody(factor));

    setLoading(false);

    if (result.ok) {
      setCodes(result.data.recoveryCodes);
    } else {
      setError(result.error);
      setFactor((current) => ({ ...current, code: "" }));
    }
  }

  if (codes) {
    return (
      <div className="settings-panel">
        <RecoveryCodesStep codes={codes} onContinue={onDone} continueLabel="Done" />
      </div>
    );
  }

  return (
    <form className="settings-panel auth-form" onSubmit={handleSubmit}>
      <p className="muted">Confirm it's you. Generating new codes replaces all your existing ones.</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <SecondFactorInput value={factor} onChange={setFactor} />

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={loading || !isSecondFactorComplete(factor)}>
          {loading ? "Verifying…" : "Generate codes"}
        </button>
      </div>
    </form>
  );
}

function ResetAuthenticatorPanel({ request, onSessionChanged, onCancel, onDone }) {
  const [stage, setStage] = useState("verify");
  const [password, setPassword] = useState("");
  const [factor, setFactor] = useState(emptySecondFactor);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState([]);

  async function handleVerify(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await request("/api/account/mfa/reset/start", { password, ...secondFactorBody(factor) });

    setLoading(false);

    if (result.ok) {
      setPassword("");
      setSetup(result.data);
      setStage("setup");
    } else {
      setError(result.error);
      setFactor((current) => ({ ...current, code: "" }));
    }
  }

  async function handleConfirmed(data) {
    await onSessionChanged();
    setCodes(data.recoveryCodes);
    setStage("codes");
  }

  if (stage === "setup") {
    return (
      <div className="settings-panel">
        <p className="muted">Scan this with your new authenticator app, then enter a code from it.</p>
        <MfaSetupStep
          request={request}
          initialSetup={setup}
          confirmPath="/api/account/mfa/reset/confirm"
          submitLabel="Switch to this authenticator"
          onConfirmed={handleConfirmed}
        />
        <button type="button" className="btn btn-ghost btn-block" onClick={onCancel}>
          Cancel and keep my current authenticator
        </button>
      </div>
    );
  }

  if (stage === "codes") {
    return (
      <div className="settings-panel">
        <p className="muted">Your old recovery codes were replaced. Save these new ones.</p>
        <RecoveryCodesStep codes={codes} onContinue={onDone} continueLabel="Done" />
      </div>
    );
  }

  return (
    <form className="settings-panel auth-form" onSubmit={handleVerify}>
      <p className="muted">Confirm it's you with your password and a code from your current app.</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <label className="field">
        <span>Password</span>
        <PasswordInput
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </label>

      <SecondFactorInput value={factor} onChange={setFactor} />

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !password || !isSecondFactorComplete(factor)}
        >
          {loading ? "Verifying…" : "Continue"}
        </button>
      </div>
    </form>
  );
}

function DeleteAccountPanel({ request, onCancel, onDeleted }) {
  const [password, setPassword] = useState("");
  const [factor, setFactor] = useState(emptySecondFactor);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const confirmed = confirm === "DELETE";

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await request("/api/account/delete", {
      password,
      confirm,
      ...secondFactorBody(factor)
    });

    setLoading(false);

    if (result.ok) {
      onDeleted(result.data.message);
    } else {
      setError(result.error);
      setFactor((current) => ({ ...current, code: "" }));
    }
  }

  return (
    <form className="settings-panel auth-form" onSubmit={handleSubmit}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <label className="field">
        <span>Password</span>
        <PasswordInput
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </label>

      <SecondFactorInput value={factor} onChange={setFactor} />

      <label className="field">
        <span>Type DELETE to confirm</span>
        <input
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="DELETE"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          type="submit"
          className="btn btn-danger"
          disabled={loading || !password || !isSecondFactorComplete(factor) || !confirmed}
        >
          {loading ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </form>
  );
}

export default Account;
