import { useState } from "react";
import Modal from "../Modal";
import { WORKPLACE_MODELS, apiRequest } from "../../api";
import Alert from "../Alert";

function AddJobModal({ csrfToken, onClose, onAdded, onUnauthorized }) {
  const [values, setValues] = useState({ company: "", position: "", location: "", workplace_model: "", url: "", description: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const update = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const { response, data } = await apiRequest("/api/jobs", {
        method: "POST",
        body: { ...values, workplace_model: values.workplace_model || null },
        csrfToken
      });

      if (response.status === 401) {
        onUnauthorized();
        return;
      }

      if (!response.ok) {
        setError(data.error || "Could not add the job.");
        return;
      }

      onAdded(data);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New Job Post" onClose={onClose}>
      <form className="app-form" onSubmit={submit}>
        {error && <Alert type="error">{error}</Alert>}

        <div className="form-grid">
          <label className="field">
            <span>Position</span>
            <input value={values.position} onChange={update("position")} placeholder="Software Engineer" required autoFocus />
          </label>
          <label className="field">
            <span>Company</span>
            <input value={values.company} onChange={update("company")} placeholder="ABC Inc." required />
          </label>
          <label className="field">
            <span>Location <small className="optional">&ensp;optional</small></span>
            <input value={values.location} onChange={update("location")} placeholder="Tel Aviv-Yafo" />
          </label>
          <label className="field">
            <span>Workplace Model <small className="optional">&ensp;optional</small></span>
            <select value={values.workplace_model} onChange={update("workplace_model")}>
              <option value="">Not specified</option>
              {WORKPLACE_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
          <label className="field field-full">
            <span>Job Posting URL <small className="optional">&ensp;optional</small></span>
            <input type="url" value={values.url} onChange={update("url")} placeholder="https://…" />
          </label>
          <label className="field field-full">
            <span>Job Description</span>
            <textarea
              rows={8}
              value={values.description}
              onChange={update("description")}
              placeholder="Paste the full posting: responsibilities and requirements. The resume tailor works from this."
            />
          </label>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Adding and scoring…" : "Add job post"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default AddJobModal;
