import { useMemo, useState } from "react";
import { WORKPLACE_MODELS, apiRequest } from "../../lib/api";
import { lastLocationFor, suggestionsFor } from "../../utils/forms/suggestions";
import Modal from "../ui/Modal";
import Alert from "../ui/Alert";
import AutocompleteInput from "../ui/AutocompleteInput";
import CharCount from "../ui/CharCount";
import SelectInput from "../ui/SelectInput";

const MAX_LENGTH = { position: 200, company: 200, location: 200, url: 500, description: 20000 };
const WORKPLACE_OPTIONS = [{ value: "", label: "Not specified" }, ...WORKPLACE_MODELS.map((model) => ({ value: model, label: model }))];

// Modal for adding a job by hand
function AddJobModal({ csrfToken, pastEntries, onClose, onAdded, onUnauthorized }) {
  const [values, setValues] = useState({ company: "", position: "", location: "", workplace_model: "", url: "", description: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoLocation, setAutoLocation] = useState("");
  const suggestions = useMemo(() => ({
    position: suggestionsFor(pastEntries, "position"),
    company: suggestionsFor(pastEntries, "company"),
    location: suggestionsFor(pastEntries, "location")
  }), [pastEntries]);

  // Sets a field's value
  const setField = (field, value) => setValues((current) => ({ ...current, [field]: value }));

  // Returns a change handler for a field
  const update = (field) => (event) => setField(field, event.target.value);

  // Sets the company and fills in its last-used location unless the user typed their own
  function changeCompany(company) {
    const untouched = !values.location || values.location === autoLocation;
    const location = lastLocationFor(pastEntries, company);

    setValues((current) => ({ ...current, company, ...(untouched ? { location } : {}) }));

    if (untouched) {
      setAutoLocation(location);
    }
  }

  // Adds the job
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
            <span className="field-head">Position <CharCount value={values.position} max={MAX_LENGTH.position} /></span>
            <AutocompleteInput
              value={values.position}
              onChange={(value) => setField("position", value)}
              suggestions={suggestions.position}
              placeholder="Software Engineer"
              maxLength={MAX_LENGTH.position}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-head">Company <CharCount value={values.company} max={MAX_LENGTH.company} /></span>
            <AutocompleteInput
              value={values.company}
              onChange={changeCompany}
              suggestions={suggestions.company}
              placeholder="ABC Inc."
              maxLength={MAX_LENGTH.company}
              required
            />
          </label>
          <label className="field">
            <span className="field-head">Location <small className="optional">&ensp;optional</small> <CharCount value={values.location} max={MAX_LENGTH.location} /></span>
            <AutocompleteInput
              value={values.location}
              onChange={(value) => setField("location", value)}
              suggestions={suggestions.location}
              placeholder="Tel Aviv-Yafo"
              maxLength={MAX_LENGTH.location}
            />
          </label>
          <label className="field">
            <span>Workplace Model <small className="optional">&ensp;optional</small></span>
            <SelectInput
              value={values.workplace_model}
              onChange={(value) => setField("workplace_model", value)}
              options={WORKPLACE_OPTIONS}
            />
          </label>
          <label className="field field-full">
            <span className="field-head">Job Posting URL <small className="optional">&ensp;optional</small> <CharCount value={values.url} max={MAX_LENGTH.url} /></span>
            <input type="url" value={values.url} onChange={update("url")} placeholder="https://…" maxLength={MAX_LENGTH.url} />
          </label>
          <label className="field field-full">
            <span className="field-head">Job Description <CharCount value={values.description} max={MAX_LENGTH.description} /></span>
            <textarea
              rows={8}
              maxLength={MAX_LENGTH.description}
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
