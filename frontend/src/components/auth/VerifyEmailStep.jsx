import { useEffect, useState } from "react";
import CodeInput from "./CodeInput";
import Alert from "../ui/Alert";

const RESEND_SECONDS = 60;

// Asks for the email verification code
function VerifyEmailStep({ request, onNext, emailSent }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(emailSent ? "" : "We couldn't send the verification email. Try resending it.");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(emailSent ? RESEND_SECONDS : 0);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }

    const timer = setTimeout(() => setCooldown((current) => current - 1), 1000);

    return () => clearTimeout(timer);
  }, [cooldown]);

  // Verifies the email code
  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    const result = await request("/api/auth/verify-email", { code });

    setLoading(false);

    if (result.ok) {
      onNext(result.data.next);
    } else {
      setError(result.error);
      setCode("");
    }
  }

  // Sends a new verification code
  async function handleResend() {
    setError("");
    setInfo("");

    const result = await request("/api/auth/resend-verification");

    if (result.ok) {
      setInfo("A new code is on its way.");
      setCooldown(RESEND_SECONDS);
    } else {
      setError(result.error);
      setCooldown(result.data.retryAfter || 0);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      {error && <Alert type="error">{error}</Alert>}
      {info && <Alert type="success">{info}</Alert>}

      <CodeInput value={code} onChange={setCode} label="Verification code" />

      <button type="submit" className="btn btn-primary btn-block" disabled={loading || code.length !== 6}>
        {loading ? "Verifying…" : "Verify email"}
      </button>

      <p className="auth-switch">
        Didn't get it? Check your spam folder or{" "}
        <button type="button" className="link-btn" onClick={handleResend} disabled={cooldown > 0}>
          {cooldown > 0 ? `resend in ${cooldown}s` : "resend the code"}
        </button>
      </p>
    </form>
  );
}

export default VerifyEmailStep;
