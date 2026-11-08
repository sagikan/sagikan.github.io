import { useRef, useState } from "react";
import Modal from "../ui/Modal";
import PillGroup from "../ui/PillGroup";
import CvEditor, { Required } from "./CvEditor";
import TagInput from "./TagInput";
import { WORKPLACE_MODELS, apiRequest, apiUpload } from "../../lib/api";
import { LIMITS, formatResume, resumeProblems } from "../../utils/resume/resumeRules";
import Alert from "../ui/Alert";
import ButtonIcon from "../ui/ButtonIcon";
import { MAX_CV_MB, MAX_GRADES_MB, checkPdf } from "../../utils/resume/pdfFiles";
import { useMachine } from "../../hooks/useMachine";
import { GRADE_SHEET, RESUME_FILE } from "../../utils/resume/resumeMachines";

const SENIORITIES = ["Any", "Student", "Junior", "Mid", "Senior"];
const SENIORITY_OPTIONS = SENIORITIES.map((level) => ({ key: level, label: level }));
const WORKPLACE_OPTIONS = WORKPLACE_MODELS.map((model) => ({ key: model, label: model }));

// Turns saved preferences into form values
function toForm(preferences) {
  const prefs = preferences || {};

  return {
    roles: prefs.roles || [],
    locations: prefs.locations || [],
    workplace_models: prefs.workplace_models || [],
    seniority: SENIORITIES.includes(prefs.seniority) ? prefs.seniority : "Any"
  };
}

// Button that opens a PDF file picker
function PdfButton({ label, disabled, onFile, primary = false }) {
  const inputRef = useRef(null);

  return (
    <>
      <button
        type="button"
        className={`btn ${primary ? "btn-primary" : "btn-ghost"} btn-sm`}
        disabled={disabled}
        onClick={() => inputRef.current.click()}
      >
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}

// Modal for editing the resume, preferences and grade sheet
function ProfileModal({ profile, csrfToken, onClose, onSaved, onUnauthorized }) {
  const [cv, setCv] = useState(() => profile.cv && formatResume(profile.cv));
  const [prefs, setPrefs] = useState(() => toForm(profile.preferences));
  const [gradeSheet, setGradeSheet] = useState(profile.gradeSheet);
  const [resumeFile, sendResumeFile] = useMachine(RESUME_FILE);
  const [gradeState, sendGradeSheet] = useMachine(GRADE_SHEET);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [problems, setProblems] = useState([]);
  // Changes on every Save, so a closed problem list shows again if the next save also fails
  const [saveAttempts, setSaveAttempts] = useState(0);
  // Bumped each time a resume is read, so the editor restarts with the new entries collapsed
  const [readCount, setReadCount] = useState(0);
  const reading = resumeFile === "reading";
  const saving = resumeFile === "saving";
  const gradeBusy = gradeState === "busy";

  // Uploads a resume PDF and fills the editor from it
  async function readCv(file) {
    const problem = checkPdf(file, MAX_CV_MB);
    setError(problem);
    setNotice("");

    if (problem) {
      return;
    }

    sendResumeFile("read");

    try {
      const { response, data } = await apiUpload("/api/jobs/profile/cv", file, { csrfToken });

      if (response.status === 401) {
        onUnauthorized();

        return;
      }

      if (!response.ok) {
        setError(data.error || "Could not read your resume.");

        return;
      }

      setCv(formatResume(data.cv));
      setReadCount((count) => count + 1);
      setPrefs(toForm(data.preferences));
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      sendResumeFile("done");
    }
  }

  // Uploads a grade sheet PDF
  async function uploadGrades(file) {
    const problem = checkPdf(file, MAX_GRADES_MB);
    setError(problem);

    if (problem) {
      return;
    }

    sendGradeSheet("start");

    try {
      const { response, data } = await apiUpload("/api/jobs/grade-sheet", file, { csrfToken });

      if (!response.ok) {
        setError(data.error || "Could not upload your grade sheet.");

        return;
      }

      setGradeSheet(data.gradeSheet);
      onSaved(data, { keepOpen: true });
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      sendGradeSheet("done");
    }
  }

  // Removes the grade sheet
  async function removeGrades() {
    sendGradeSheet("start");
    setError("");

    try {
      const { response, data } = await apiRequest("/api/jobs/grade-sheet", { method: "DELETE", csrfToken });

      if (!response.ok) {
        setError(data.error || "Could not remove your grade sheet.");

        return;
      }

      setGradeSheet(null);
      onSaved(data, { keepOpen: true });
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      sendGradeSheet("done");
    }
  }

  // Saves the resume and preferences
  async function save(event) {
    event.preventDefault();
    setError("");

    const preferences = prefs;
    const found = [
      ...(preferences.roles.length === 0 ? ["Add at least one role to search for."] : []),
      ...(preferences.roles.length > LIMITS.roles ? [`Roles: ${preferences.roles.length} of ${LIMITS.roles} allowed.`] : []),
      ...(preferences.locations.length === 0 ? ["Add at least one location."] : []),
      ...(preferences.locations.length > LIMITS.locations ? [`Locations: ${preferences.locations.length} of ${LIMITS.locations} allowed.`] : []),
      ...(preferences.workplace_models.length === 0 ? ["Choose at least one workplace type."] : []),
      ...[...preferences.roles, ...preferences.locations]
        .filter((item) => item.length > LIMITS.preference)
        .map((item) => `"${item.slice(0, 30)}…" is ${item.length} characters long. Keep it to ${LIMITS.preference}.`),
      ...resumeProblems(cv)
    ];

    setProblems(found);
    setSaveAttempts((count) => count + 1);

    if (found.length > 0) {
      const form = event.currentTarget;
      requestAnimationFrame(() => form.querySelector(".problem-list")?.scrollIntoView({ behavior: "smooth", block: "center" }));

      return;
    }

    sendResumeFile("save");

    try {
      const { response, data } = await apiRequest("/api/jobs/profile", {
        method: "PUT",
        body: { cv: formatResume(cv), preferences },
        csrfToken
      });

      if (!response.ok) {
        setError(data.error || "Could not save your profile.");

        return;
      }

      onSaved(data);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      sendResumeFile("done");
    }
  }

  return (
    <Modal title="Profile" onClose={onClose} wide>
      <form className="app-form profile-form" onSubmit={save}>
        {error && <Alert type="error">{error}</Alert>}
        {notice && <Alert type="success">{notice}</Alert>}
        {problems.length > 0 && (
          <Alert type="error" key={saveAttempts} onDismiss={() => setProblems([])}>
            <span>Fix these before saving:</span>
            <ul className="problem-list">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          </Alert>
        )}

        <section className="profile-block">
          <div className="profile-block-header">
            <div>
              <h3>Resume</h3>
              <p className="muted">
                {reading
                  ? "Reading your resume… this may take a moment."
                  : cv
                    ? "Used to find matching jobs and to tailor each application."
                    : "Upload your resume as a PDF (up to 5 MB) to get started."}
              </p>
            </div>
            {reading
              ? <span className="spinner" aria-hidden="true" />
              : <PdfButton label={cv ? "Replace resume" : "Upload resume"} primary={!cv} disabled={saving} onFile={readCv} />}
          </div>
        </section>

        {cv && !reading && (
          <>
            <section className="profile-block">
              <h3>Work Details</h3>
              <div className="cv-fields">
                <div className="field">
                  <span>Roles<Required /></span>
                  <TagInput
                    values={prefs.roles}
                    max={LIMITS.roles}
                    maxLength={LIMITS.preference}
                    showCount
                    sortable
                    label="Roles"
                    placeholder="Type a role and press Enter"
                    onChange={(roles) => setPrefs((current) => ({ ...current, roles }))}
                  />
                </div>
                <div className="field">
                  <span>Locations<Required /></span>
                  <TagInput
                    values={prefs.locations}
                    max={LIMITS.locations}
                    maxLength={LIMITS.preference}
                    showCount
                    sortable
                    label="Locations"
                    placeholder="Type a location and press Enter"
                    onChange={(locations) => setPrefs((current) => ({ ...current, locations }))}
                  />
                </div>
              </div>
              <div className="cv-fields">
                <div className="field">
                  <span id="seniority-label">Seniority<Required /></span>
                  <PillGroup
                    className="choice-group"
                    mode="radio"
                    aria-labelledby="seniority-label"
                    options={SENIORITY_OPTIONS}
                    value={prefs.seniority}
                    onChange={(seniority) => setPrefs((current) => ({ ...current, seniority }))}
                  />
                </div>
                <div className="field">
                  <span id="workplace-label">Workplace<Required /></span>
                  <PillGroup
                    className="choice-group"
                    multiple
                    aria-labelledby="workplace-label"
                    options={WORKPLACE_OPTIONS}
                    value={prefs.workplace_models}
                    onChange={(model) => setPrefs((current) => ({
                      ...current,
                      workplace_models: current.workplace_models.includes(model)
                        ? current.workplace_models.filter((item) => item !== model)
                        : WORKPLACE_MODELS.filter((item) => item === model || current.workplace_models.includes(item))
                    }))}
                  />
                </div>
              </div>
            </section>

            <section className="profile-block">
              <h3>Personal Details</h3>
              <CvEditor key={readCount} cv={cv} onChange={setCv} mode="base" />
            </section>

            <section className="profile-block">
              <div className="profile-block-header">
                <div>
                  <h3>Gradesheet / Transcript</h3>
                  <p className="muted">
                    {gradeSheet
                      ? `${gradeSheet.filename} · ${gradeSheet.page_count} page${gradeSheet.page_count === 1 ? "" : "s"}`
                      : "PDF (up to 2 MB) you can attach to the end of any tailored resume."}
                  </p>
                </div>
                <div className="button-row">
                  {gradeSheet && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={gradeBusy} onClick={removeGrades}>
                      Remove
                    </button>
                  )}
                  <PdfButton label={gradeSheet ? "Replace" : "Upload"} disabled={gradeBusy} onFile={uploadGrades} />
                </div>
              </div>
            </section>
          </>
        )}

        <div className="form-actions sticky-actions">
          {cv && !reading && <p className="hint required-note">Fields marked <span className="req">*</span> are required</p>}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!cv || reading || saving} aria-label="Save profile" title="Save profile">
            <ButtonIcon name="check" busy={saving} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default ProfileModal;
