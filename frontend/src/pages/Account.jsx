import { useCallback, useEffect, useState } from "react";
import MfaSetupStep from "../components/auth/MfaSetupStep";
import PasswordInput from "../components/auth/PasswordInput";
import RecoveryCodesStep from "../components/auth/RecoveryCodesStep";
import SecondFactorInput from "../components/auth/SecondFactorInput";
import { apiRequest } from "../api";
import { emptySecondFactor, isSecondFactorComplete, secondFactorBody } from "../utils/authForms";

const LOW_RECOVERY_CODES = 3;

function Account({ csrfToken, onSessionChanged, onUnauthorized, onDeleted }) {
  const [recoveryCodesLeft, setRecoveryCodesLeft] = useState(null);
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
