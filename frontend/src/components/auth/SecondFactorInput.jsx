import CodeInput from "./CodeInput";

function SecondFactorInput({ value, onChange, codeLabel = "Authentication code" }) {
  function toggle() {
    onChange({ useRecovery: !value.useRecovery, code: "", recoveryCode: "" });
  }

  return (
    <>
      {value.useRecovery ? (
        <label className="field">
          <span>Recovery code</span>
          <input
            className="code-input code-input-text"
            value={value.recoveryCode}
            onChange={(event) => onChange({ ...value, recoveryCode: event.target.value.toUpperCase() })}
            placeholder="XXXXX-XXXXX"
            autoComplete="off"
            spellCheck={false}
            required
            autoFocus
          />
        </label>
      ) : (
        <CodeInput value={value.code} onChange={(code) => onChange({ ...value, code })} label={codeLabel} />
      )}

      <button type="button" className="link-btn toggle-factor" onClick={toggle}>
        {value.useRecovery ? "Have an authenticator app? Use it instead" : "Lost your device? Use a recovery code"}
      </button>
    </>
  );
}

export default SecondFactorInput;
