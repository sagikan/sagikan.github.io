import { useMemo, useState } from "react";
import { STATUSES, WORKPLACE_MODELS, formatDate, jobDay, localISO, toDateInput } from "../../lib/api";
import { lastLocationFor, suggestionsFor } from "../../utils/forms/suggestions";
import Alert from "../ui/Alert";
import AutocompleteInput from "../ui/AutocompleteInput";
import CharCount from "../ui/CharCount";
import SelectInput from "../ui/SelectInput";

const WORKPLACE_OPTIONS = [{ value: "", label: "Not specified" }, ...WORKPLACE_MODELS.map((model) => ({ value: model, label: model }))];
const MAX_LENGTH = { position: 200, company: 200, location: 200, job_url: 500, notes: 5000 };
const STATUS_OPTIONS = STATUSES.map((status) => ({ value: status, label: status }));

// Returns the form's starting values for a job, or empty ones
function initialValues(job) {
  return {
    company: job?.company || "",
    position: job?.position || "",
    location: job?.location || "",
    workplace_model: job?.workplace_model || "",
    status: job?.status || "Applied",
    job_url: job?.job_url || "",
    applied_at: job ? toDateInput(job.applied_at) : new Date().toLocaleDateString("en-CA"),
    notes: job?.notes || ""
  };
}

// Trims and lowercases text for comparison
const normalize = (text) => text.trim().toLowerCase();

// Form for adding or editing an application
function ApplicationForm({ job, applications, onSubmit, onCancel }) {
  const [values, setValues] = useState(() => initialValues(job));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoLocation, setAutoLocation] = useState("");
  const suggestions = useMemo(() => ({
    position: suggestionsFor(applications, "position"),
    company: suggestionsFor(applications, "company"),
    location: suggestionsFor(applications, "location")
  }), [applications]);
  const earlierDuplicate = useMemo(() => {
    const position = normalize(values.position);
    const company = normalize(values.company);
    const day = values.applied_at || localISO(new Date());

    if (!position || !company) {
      return null;
    }

    return applications
      .filter((other) =>
        other.id !== job?.id &&
        normalize(other.position) === position &&
        normalize(other.company) === company &&
        jobDay(other) < day
      )
      .sort((a, b) => jobDay(b).localeCompare(jobDay(a)))[0] || null;
  }, [applications, job, values.position, values.company, values.applied_at]);

  // Returns a change handler for a field
  function update(field) {
    return (event) => setField(field, event.target.value);
  }

  // Sets a field's value
  function setField(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  // Sets the company and fills in its last-used location unless the user typed their own
  function changeCompany(company) {
    const untouched = !values.location || values.location === autoLocation;
    const location = lastLocationFor(applications, company);

    setValues((current) => ({ ...current, company, ...(untouched ? { location } : {}) }));

    if (untouched) {
      setAutoLocation(location);
    }
  }

  // Validates and saves the application
  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);

    const message = await onSubmit({
      company: values.company,
      position: values.position,
      location: values.location,
      workplace_model: values.workplace_model || null,
      status: values.status,
      job_url: values.job_url || null,
      notes: values.notes || null,
      applied_at: values.applied_at || null
    });

    setSaving(false);

    if (message) {
      setError(message);
    }
  }

  return (
    <form className="app-form" onSubmit={handleSubmit}>
      {error && <Alert type="error">{error}</Alert>}

      {earlierDuplicate && (
        <Alert type="warning">
          You already applied to this position at this company on {formatDate(jobDay(earlierDuplicate))}.
        </Alert>
      )}

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
          <span className="field-head">Location <CharCount value={values.location} max={MAX_LENGTH.location} /></span>
          <AutocompleteInput
            value={values.location}
            onChange={(value) => setField("location", value)}
            suggestions={suggestions.location}
            placeholder="Tel Aviv-Yafo"
            maxLength={MAX_LENGTH.location}
            required
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

        <label className="field">
          <span>Status</span>
          <SelectInput value={values.status} onChange={(value) => setField("status", value)} options={STATUS_OPTIONS} />
        </label>

        <label className="field">
          <span>Date Applied <small className="optional">&ensp;optional</small></span>
          <input type="date" value={values.applied_at} onChange={update("applied_at")} />
        </label>

        <label className="field field-full">
          <span className="field-head">Job Posting URL <small className="optional">&ensp;optional</small> <CharCount value={values.job_url} max={MAX_LENGTH.job_url} /></span>
          <input type="url" value={values.job_url} onChange={update("job_url")} placeholder="https://…" maxLength={MAX_LENGTH.job_url} />
        </label>

        <label className="field field-full">
          <span className="field-head">Notes <small className="optional">&ensp;optional</small> <CharCount value={values.notes} max={MAX_LENGTH.notes} /></span>
          <textarea
            value={values.notes}
            onChange={update("notes")}
            rows={4}
            maxLength={MAX_LENGTH.notes}
            placeholder="Recruiter name, salary range, next steps, etc."
          />
        </label>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : job?.id ? "Save changes" : "Add application"}
        </button>
      </div>
    </form>
  );
}

export default ApplicationForm;
