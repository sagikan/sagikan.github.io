import { useCallback, useState } from "react";
import StepIcon from "../components/auth/StepIcon";
import ForgotPasswordStep from "../components/auth/ForgotPasswordStep";
import MfaSetupStep from "../components/auth/MfaSetupStep";
import MfaVerifyStep from "../components/auth/MfaVerifyStep";
import NewPasswordFields from "../components/auth/NewPasswordFields";
import PasswordInput from "../components/auth/PasswordInput";
import RecoveryCodesStep from "../components/auth/RecoveryCodesStep";
import ResetPasswordStep from "../components/auth/ResetPasswordStep";
import VerifyEmailStep from "../components/auth/VerifyEmailStep";
import { apiRequest } from "../lib/api";
import { newPasswordError } from "../utils/auth/authForms";
import { redirect } from "../lib/router";
import Alert from "../components/ui/Alert";

const STEP_HEADERS = {
  verify_email: {
    title: "Check your email",
    text: (email) => `We sent a 6-digit code to ${email}. It expires in 15 minutes.`
  },
  mfa_setup: {
    title: "Secure your account",
    text: () => "Two-factor authentication is required. Link an authenticator app to continue."
  },
  recovery_codes: {
    title: "Save your recovery codes",
    text: () => "Use one of these if you ever lose access to your authenticator app."
  },
  mfa: {
    title: "Two-Factor Authentication",
    text: (email, { usingRecoveryCode }) => usingRecoveryCode
      ? "Enter one of the recovery codes you saved when you set up two-factor authentication. Each code works once."
      : "Enter the 6-digit code from your authenticator app."
  },
  forgot_password: {
    title: "Forgot your password?",
    text: () => "Enter your email and we'll send you a code to reset it."
  },
  reset_password: {
    title: "Choose a new password",
    text: (email) => `Enter the code we sent to ${email} and pick a new password.`
  }
};
const SIGNUPS_OPEN = import.meta.env.VITE_SIGNUPS_OPEN === "true";
const BACK_ICON = (
  <svg viewBox="0 0 20 15" width="16" height="16" aria-hidden="true">
    <path d="M16 10H4m5-5l-5 5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Sign-in and sign-up page with all their steps
function Login({ mode, onAuthenticated, apiStatus }) {
  const [step, setStep] = useState("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [emailSent, setEmailSent] = useState(true);
  const [resetMessage, setResetMessage] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  const isLogin = mode === "login";

  // Switches between sign-in and sign-up
  function switchMode(next) {
    redirect(next === "login" ? "/login" : "/signup");
  }

  // Returns to the first step with a message
  const restart = useCallback((message = "", successNotice = "") => {
    setStep("credentials");
    setPassword("");
    setConfirmPassword("");
    setSubmitted(false);
    setUsingRecoveryCode(false);
    setError(message);
    setNotice(successNotice);
  }, []);

  // Sends a request, restarting when the sign-in expired
  const request = useCallback(async (path, body = {}) => {
    try {
      const { response, data } = await apiRequest(path, { method: "POST", body });

      if (!response.ok && data.restart) {
        restart(data.error);
      }

      return {
        ok: response.ok,
        data,
        error: response.ok ? "" : data.error || "Something went wrong. Please try again."
      };
    } catch {
      return { ok: false, data: {}, error: "Could not reach the server. Please try again." };
    }
  }, [restart]);

  // Signs in or creates the account
  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitted(true);

    if (!isLogin) {
      const passwordError = newPasswordError(password, confirmPassword, email);

      if (passwordError) {
        setError(passwordError);

        return;
      }
    }

    setLoading(true);

    const result = await request(isLogin ? "/api/auth/login" : "/api/auth/register", { email, password });

    setLoading(false);

    if (!result.ok) {
      setError(result.error);

      return;
    }

    setEmail(result.data.email || email);
    setPassword("");
    setConfirmPassword("");
    setEmailSent(result.data.emailSent !== false);
    setStep(result.data.next);
  }

  const header = STEP_HEADERS[step];
  let icon = step;

  if (step === "credentials") {
    icon = isLogin ? "login" : "register";
  } else if (step === "mfa" && usingRecoveryCode) {
    icon = "recovery";
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        {step === "credentials" ? (
          <a href="#/" className="back-link">
            {BACK_ICON}
            Home
          </a>
        ) : step !== "recovery_codes" && (
          <button type="button" className="back-link link-reset" onClick={() => restart()}>
            {BACK_ICON}
          </button>
        )}

        <div className="auth-header">
          <StepIcon name={icon} size={40} />
          <h1>{header ? header.title : isLogin ? "Welcome back" : "Create your account"}</h1>
          <p>
            {header
              ? header.text(email, { usingRecoveryCode })
              : isLogin
                ? "Log in to manage your job applications."
                : "Start tracking your job search in seconds."}
          </p>
        </div>

        {step === "verify_email" && (
          <VerifyEmailStep request={request} emailSent={emailSent} onNext={setStep} />
        )}

        {step === "mfa_setup" && (
          <MfaSetupStep
            request={request}
            onConfirmed={(data) => {
              setRecoveryCodes(data.recoveryCodes);
              setVerifiedEmail(data.user.email);
              setStep("recovery_codes");
            }}
          />
        )}

        {step === "recovery_codes" && (
          <RecoveryCodesStep codes={recoveryCodes} onContinue={() => onAuthenticated(verifiedEmail)} />
        )}

        {step === "mfa" && (
          <MfaVerifyStep
            request={request}
            onVerified={onAuthenticated}
            onModeChange={setUsingRecoveryCode}
          />
        )}

        {step === "forgot_password" && (
          <ForgotPasswordStep
            initialEmail={email}
            request={request}
            onSent={(sentTo, message) => {
              setEmail(sentTo);
              setResetMessage(message);
              setStep("reset_password");
            }}
          />
        )}

        {step === "reset_password" && (
          <ResetPasswordStep
            email={email}
            sentMessage={resetMessage}
            request={request}
            onReset={(message) => restart("", message)}
          />
        )}

        {step === "credentials" && (
          <>
            <div className="segmented" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={isLogin}
                className={isLogin ? "active" : ""}
                onClick={() => switchMode("login")}
              >
                Log in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!isLogin}
                className={!isLogin ? "active" : ""}
                onClick={() => switchMode("register")}
              >
                Sign up
              </button>
            </div>

            {apiStatus === "offline" && (
              <Alert type="warning">
                The server is unreachable right now. Please try again in a moment.
              </Alert>
            )}

            {notice && <Alert type="success">{notice}</Alert>}
            {error && <Alert type="error">{error}</Alert>}

            {!isLogin && !SIGNUPS_OPEN ? (
              <Alert type="warning">
                Sign-ups are paused while the site is being worked on. Please check back soon.
              </Alert>
            ) : (
              <form className="auth-form" onSubmit={handleSubmit}>
                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                  />
                </label>

                {isLogin ? (
                  <label className="field">
                    <span className="field-label-row">
                      Password
                      <button
                        type="button"
                        className="link-btn forgot-link"
                        onClick={() => {
                          setError("");
                          setNotice("");
                          setStep("forgot_password");
                        }}
                      >
                        Forgot password?
                      </button>
                    </span>
                    <PasswordInput
                      value={password}
                      onChange={setPassword}
                      placeholder="Your password"
                      autoComplete="current-password"
                    />
                  </label>
                ) : (
                  <NewPasswordFields
                    email={email}
                    password={password}
                    onPasswordChange={setPassword}
                    confirmPassword={confirmPassword}
                    onConfirmChange={setConfirmPassword}
                    submitted={submitted}
                  />
                )}

                <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
                  {loading ? "Please wait…" : isLogin ? "Log in" : "Create account"}
                </button>
              </form>
            )}

            <p className="auth-switch">
              {isLogin ? "New here? " : "Already have an account? "}
              <button type="button" className="link-btn" onClick={() => switchMode(isLogin ? "register" : "login")}>
                {isLogin ? "Create an account" : "Log in"}
              </button>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export default Login;
