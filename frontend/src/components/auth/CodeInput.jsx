// Input for a 6-digit code
function CodeInput({ value, onChange, label = "6-digit code" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="code-input"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        placeholder="000000"
        required
        autoFocus
      />
    </label>
  );
}

export default CodeInput;
