import { useState } from "react";
import PasswordInput from "./PasswordInput";
import { passwordRules } from "../../utils/passwordRules";

function NewPasswordFields({ email, password, onPasswordChange, confirmPassword, onConfirmChange, submitted, label = "Password" }) {
  const [showRules, setShowRules] = useState(false);
  const rules = passwordRules(password, email);
  const passwordsMatch = password === confirmPassword;
  const metCount = rules.filter((rule) => rule.met).length;
  const rulesOpen = showRules || (submitted && metCount < rules.length);

  return (
    <>
      <label className="field">
        <span>{label}</span>
        <PasswordInput
          value={password}
          onChange={onPasswordChange}
          placeholder="Create a strong password"
          autoComplete="new-password"
        />
      </label>

      <button
        type="button"
        className="rules-toggle"
        aria-expanded={rulesOpen}
        aria-controls="password-rules"
        onClick={() => setShowRules(!rulesOpen)}
      >
        Password requirements
        <span className={`rules-count${metCount === rules.length ? " met" : ""}`}>{metCount}/{rules.length}</span>
        <svg className="rules-chevron" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {rulesOpen && (
        <ul id="password-rules" className="password-rules" aria-label="Password requirements">
          {rules.map((rule) => (
            <li key={rule.label} className={rule.met ? "met" : submitted ? "unmet" : ""}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                {rule.met ? (
                  <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <circle cx="8" cy="8" r="2.5" fill="currentColor" />
                )}
              </svg>
              {rule.label}
            </li>
          ))}
        </ul>
      )}

      <label className="field">
        <span>Confirm password</span>
        <PasswordInput
          value={confirmPassword}
          onChange={onConfirmChange}
          placeholder="Re-enter your password"
          autoComplete="new-password"
          aria-invalid={confirmPassword.length > 0 && !passwordsMatch}
        />
        {confirmPassword.length > 0 && (
          <small className={`hint ${passwordsMatch ? "hint-ok" : "hint-error"}`}>
            {!passwordsMatch && "Passwords do not match"}
          </small>
        )}
      </label>
    </>
  );
}

export default NewPasswordFields;
