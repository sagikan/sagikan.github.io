import { useId, useMemo, useState } from "react";
import { useMachine } from "../../hooks/useMachine";
import { STATUSES, WORKPLACE_MODELS, localISO, toDateInput } from "../../lib/api";
import { NOTE, noteStateOf } from "../../utils/applications/applicationMachines";
import { duplicateKey, duplicateNote, findLatestDuplicate, suggestNote } from "../../utils/applications/duplicates";
import { lastLocationFor, suggestionsFor } from "../../utils/forms/suggestions";
import Alert from "../ui/Alert";
import AutocompleteInput from "../ui/AutocompleteInput";
import CharCount from "../ui/CharCount";
import ModalSubmit from "../ui/ModalSubmit";
import SelectInput from "../ui/SelectInput";
import DuplicateWarning from "./DuplicateWarning";

const WORKPLACE_OPTIONS = [{ value: "", label: "Not specified" }, ...WORKPLACE_MODELS.map((model) => ({ value: model, label: model }))];
const MAX_LENGTH = { position: 200, company: 200, location: 200, job_url: 500, notes: 2000 };
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
    notes: job?.notes || "",
    revertedKey: ""
  };
}

// Returns the form's starting values and note state, with the note filled from the latest duplicate
function startingForm(job, applications) {
  const noteState = noteStateOf(job);
  const { values, move } = suggestNote(noteState, initialValues(job), null, applications, job?.id);

  return { values, noteState: move ? NOTE.next(noteState, ...move) : noteState };
}

// Form for adding or editing an application
function ApplicationForm({ job, applications, onSubmit, active = true }) {
  const formId = useId();
  const [starting] = useState(() => startingForm(job, applications));
  const [values, setValues] = useState(starting.values);
  const [noteState, sendNote] = useMachine(NOTE, starting.noteState);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoLocation, setAutoLocation] = useState("");
  const suggestions = useMemo(() => ({
    position: suggestionsFor(applications, "position"),
    company: suggestionsFor(applications, "company"),
    location: suggestionsFor(applications, "location")
  }), [applications]);
  const earlierDuplicate = useMemo(() => findLatestDuplicate(applications, {
    position: values.position,
    company: values.company,
    day: values.applied_at || localISO(new Date()),
    excludeId: job?.id,
    revertedKey: values.revertedKey
  }), [applications, job, values.position, values.company, values.applied_at, values.revertedKey]);

  // Returns a change handler for a field
  function update(field) {
    return (event) => setField(field, event.target.value);
  }

  // Applies a change to the values, filling the note from the latest duplicate when the note allows it
  function applyChange(next, field) {
    const { values: updated, move } = suggestNote(noteState, next, field, applications, job?.id);

    setValues(updated);

    if (move) {
      sendNote(...move);
    }
  }

  // Sets a field's value
  function setField(field, value) {
    if (field === "notes") {
      sendNote("write");
    }

    applyChange({ ...values, [field]: value }, field);
  }

  // Reverts the duplicate warning for this position and company, and empties the note it filled in
  function revertDuplicate() {
    const generated = earlierDuplicate ? duplicateNote(earlierDuplicate) : null;
    const emptiesNote = NOTE.can(noteState, "revert") && (noteState === "automatic" || values.notes === generated);

    if (emptiesNote) {
      sendNote("revert");
    }

    setValues({
      ...values,
      revertedKey: duplicateKey(values.position, values.company),
      notes: emptiesNote ? "" : values.notes
    });
  }

  // Sets the company and fills in its last-used location unless the user typed their own
  function changeCompany(company) {
    const untouched = !values.location || values.location === autoLocation;
    const location = lastLocationFor(applications, company);

    applyChange({ ...values, company, ...(untouched ? { location } : {}) }, "company");

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
      notes_auto: noteState === "automatic",
      applied_at: values.applied_at || null
    });

    setSaving(false);

    if (message) {
      setError(message);
    }
  }

  return (
    <form id={formId} className="app-form" onSubmit={handleSubmit}>
      {error && <Alert type="error">{error}</Alert>}

      <DuplicateWarning duplicate={earlierDuplicate} onRevert={revertDuplicate} />

      <div className="form-grid" style={{ "--fixed-rows": 4 }}>
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

        <label className="field field-full">
          <span className="field-head">Job Posting URL <small className="optional">&ensp;optional</small> <CharCount value={values.job_url} max={MAX_LENGTH.job_url} /></span>
          <input type="url" value={values.job_url} onChange={update("job_url")} placeholder="https://…" maxLength={MAX_LENGTH.job_url} />
        </label>

        <label className="field">
          <span>Status</span>
          <SelectInput value={values.status} onChange={(value) => setField("status", value)} options={STATUS_OPTIONS} openUp />
        </label>

        <label className="field">
          <span>Date Applied <small className="optional">&ensp;optional</small></span>
          <input type="date" value={values.applied_at} onChange={update("applied_at")} />
        </label>

        <label className="field field-full">
          <span className="field-head">Notes <small className="optional">&ensp;optional</small> <CharCount value={values.notes} max={MAX_LENGTH.notes} /></span>
          <textarea
            value={values.notes}
            onChange={update("notes")}
            rows={3}
            maxLength={MAX_LENGTH.notes}
            placeholder="Recruiter name, salary range, next steps, etc."
          />
        </label>
      </div>

      <ModalSubmit formId={formId} active={active} label={job?.id ? "Save changes" : "Add application"} busy={saving} icon={job?.id ? "check" : "plus"}>
        {job?.id ? (saving ? "Saving…" : "Save") : "Add"}
      </ModalSubmit>
    </form>
  );
}

export default ApplicationForm;
