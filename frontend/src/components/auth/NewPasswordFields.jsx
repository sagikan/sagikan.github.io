import PasswordInput from "./PasswordInput";
import { passwordRules } from "../../utils/passwordRules";

function NewPasswordFields({ email, password, onPasswordChange, confirmPassword, onConfirmChange, submitted, label = "Password" }) {
  const rules = passwordRules(password, email);
  const passwordsMatch = password === confirmPassword;

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

      <ul className="password-rules" aria-label="Password requirements">
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
