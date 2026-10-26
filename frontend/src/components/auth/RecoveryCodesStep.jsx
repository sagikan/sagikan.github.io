import { useState } from "react";
import Alert from "../ui/Alert";

// Shows new recovery codes and asks the user to save them
function RecoveryCodesStep({ codes, onContinue, continueLabel = "Continue to my applications" }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  // Copies the recovery codes
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  // Downloads the recovery codes as a text file
  function handleDownload() {
    const url = URL.createObjectURL(new Blob([`Applicant Zero recovery codes\n\n${text}\n`], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "applicant-zero-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="auth-form">
      <Alert type="warning">
        Each code works once. Keep them somewhere safe, like a password manager.
        They're the only way in if you lose your authenticator app, and they won't be shown again.
      </Alert>

      <ul className="recovery-grid">
        {codes.map((code) => (
          <li key={code}><code>{code}</code></li>
        ))}
      </ul>

      <div className="button-row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopy}>
          {copied ? "Copied" : "Copy all"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleDownload}>
          Download .txt
        </button>
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
        I've saved my recovery codes
      </label>

      <button type="button" className="btn btn-primary btn-block" disabled={!saved} onClick={onContinue}>
        {continueLabel}
      </button>
    </div>
  );
}

export default RecoveryCodesStep;
