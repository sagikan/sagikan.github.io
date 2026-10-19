import { useMemo, useState } from "react";
import { STATUSES, WORKPLACE_MODELS, formatDate, jobDay, localISO, toDateInput } from "../api";

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

const normalize = (text) => text.trim().toLowerCase();

function ApplicationForm({ job, applications, onSubmit, onCancel }) {
  const [values, setValues] = useState(() => initialValues(job));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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

  function update(field) {
    return (event) => setValues((current) => ({ ...current, [field]: event.target.value }));
  }

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
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {earlierDuplicate && (
        <div className="alert alert-warning" role="status">
          You already applied to this position at this company on {formatDate(jobDay(earlierDuplicate))}.
        </div>
      )}

      <div className="form-grid">
        <label className="field">
          <span>Position</span>
          <input value={values.position} onChange={update("position")} placeholder="Software Engineer" required autoFocus />
        </label>

        <label className="field">
          <span>Company</span>
          <input value={values.company} onChange={update("company")} placeholder="Acme Inc." required />
        </label>

        <label className="field">
          <span>Location</span>
          <input value={values.location} onChange={update("location")} placeholder="Tel Aviv, Israel" required />
        </label>

        <label className="field">
          <span>Workplace model <small className="optional">(optional)</small></span>
          <select value={values.workplace_model} onChange={update("workplace_model")}>
            <option value="">Not specified</option>
            {WORKPLACE_MODELS.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Status</span>
          <select value={values.status} onChange={update("status")}>
            {STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Date applied <small className="optional">(optional)</small></span>
          <input type="date" value={values.applied_at} onChange={update("applied_at")} />
        </label>

        <label className="field field-full">
          <span>Job posting URL <small className="optional">(optional)</small></span>
          <input type="url" value={values.job_url} onChange={update("job_url")} placeholder="https://…" />
        </label>

        <label className="field field-full">
          <span>Notes <small className="optional">(optional)</small></span>
          <textarea
            value={values.notes}
            onChange={update("notes")}
            rows={4}
            placeholder="Recruiter name, salary range, next steps…"
          />
        </label>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : job ? "Save changes" : "Add application"}
        </button>
      </div>
    </form>
  );
}

export default ApplicationForm;
