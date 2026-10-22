import { useEffect, useState } from "react";
import CodeInput from "./CodeInput";
import NewPasswordFields from "./NewPasswordFields";
import { newPasswordError } from "../../utils/auth/authForms";
import Alert from "../Alert";

const RESEND_SECONDS = 60;

function ResetPasswordStep({ email, sentMessage, request, onReset }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(sentMessage);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }

    const timer = setTimeout(() => setCooldown((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setInfo("");
    setSubmitted(true);

    const passwordError = newPasswordError(password, confirmPassword, email);

    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);

    const result = await request("/api/auth/password/reset", { email, code, password });

    setLoading(false);

    if (result.ok) {
      onReset(result.data.message);
    } else {
      setError(result.error);
    }
  }

  async function handleResend() {
    setError("");

    const result = await request("/api/auth/password/forgot", { email });

    if (result.ok) {
      setInfo("If that email has an account, a new code is on its way.");
      setCooldown(RESEND_SECONDS);
    } else {
      setError(result.error);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      {error && <Alert type="error">{error}</Alert>}
      {info && <Alert type="success">{info}</Alert>}

      <CodeInput value={code} onChange={setCode} label="Reset code" />

      <NewPasswordFields
        email={email}
        password={password}
        onPasswordChange={setPassword}
        confirmPassword={confirmPassword}
        onConfirmChange={setConfirmPassword}
        submitted={submitted}
        label="New password"
      />

      <button type="submit" className="btn btn-primary btn-block" disabled={loading || code.length !== 6}>
        {loading ? "Resetting…" : "Reset password"}
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

export default ResetPasswordStep;
