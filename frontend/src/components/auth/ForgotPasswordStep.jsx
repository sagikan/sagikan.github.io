import { useState } from "react";

function ForgotPasswordStep({ initialEmail, request, onSent }) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await request("/api/auth/password/forgot", { email });

    setLoading(false);

    if (result.ok) {
      onSent(email, result.data.message);
    } else {
      setError(result.error);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <label className="field">
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          autoComplete="email"
          autoFocus
        />
      </label>

      <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
        {loading ? "Sending…" : "Send reset code"}
      </button>
    </form>
  );
}

export default ForgotPasswordStep;
