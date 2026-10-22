import { useEffect, useRef, useState } from "react";
import CodeInput from "./CodeInput";
import Alert from "../Alert";

function MfaSetupStep({
  request,
  onConfirmed,
  initialSetup = null,
  confirmPath = "/api/auth/mfa/setup/confirm",
  submitLabel = "Enable two-factor authentication"
}) {
  const [setup, setSetup] = useState(initialSetup);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const started = useRef(Boolean(initialSetup));

  useEffect(() => {
    if (started.current) {
      return;
    }

    started.current = true;

    request("/api/auth/mfa/setup").then((result) => {
      if (result.ok) {
        setSetup(result.data);
      } else {
        setError(result.error);
      }
    });
  }, [request]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(setup.secret.replace(/\s/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await request(confirmPath, { code });

    setLoading(false);

    if (result.ok) {
      onConfirmed(result.data);
    } else {
      setError(result.error);
      setCode("");
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      {error && <Alert type="error">{error}</Alert>}

      <ol className="setup-steps">
        <li>Install an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.</li>
        <li>Scan this QR code, or enter the key manually.</li>
      </ol>

      <div className="qr-box">
        {setup ? (
          <img src={setup.qrCode} alt="QR code for your authenticator app" width="180" height="180" />
        ) : (
          <span className="spinner" aria-label="Loading QR code" />
        )}
      </div>

      {setup && (
        <div className="secret-box">
          <code>{setup.secret}</code>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      <CodeInput value={code} onChange={setCode} label="Enter the 6-digit code from the app" />

      <button type="submit" className="btn btn-primary btn-block" disabled={loading || !setup || code.length !== 6}>
        {loading ? "Verifying…" : submitLabel}
      </button>
    </form>
  );
}

export default MfaSetupStep;
