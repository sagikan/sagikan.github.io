import { useState } from "react";
import SecondFactorInput from "./SecondFactorInput";
import { emptySecondFactor, isSecondFactorComplete, secondFactorBody } from "../../utils/auth/authForms";
import Alert from "../Alert";

function MfaVerifyStep({ request, onVerified, onModeChange }) {
  const [factor, setFactor] = useState(emptySecondFactor);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await request("/api/auth/mfa/verify", secondFactorBody(factor));

    setLoading(false);

    if (result.ok) {
      onVerified(result.data.user.email);
    } else {
      setError(result.error);
      setFactor((current) => ({ ...current, code: "" }));
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      {error && <Alert type="error">{error}</Alert>}

      <SecondFactorInput
        value={factor}
        onChange={(next) => {
          setFactor(next);
          setError("");

          if (next.useRecovery !== factor.useRecovery) {
            onModeChange?.(next.useRecovery);
          }
        }}
      />

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={loading || !isSecondFactorComplete(factor)}
      >
        {loading ? "Verifying…" : "Verify"}
      </button>
    </form>
  );
}

export default MfaVerifyStep;
