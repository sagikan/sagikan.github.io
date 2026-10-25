import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../Modal";
import CvEditor from "./CvEditor";
import JobDetails from "./JobDetails";
import { apiRequest, apiUpload } from "../../api";
import { downloadBlob, makeTailoredPdf } from "../../utils/resume/cvPdf";
import { renderFirstPage } from "../../utils/resume/pdfPreview";
import Alert from "../Alert";
import { countChanges } from "../../utils/resume/cvChanges";
import { MAX_GRADES_MB, checkPdf } from "../../utils/resume/pdfFiles";
import { useDismiss } from "../../hooks/useDismiss";

const PREVIEW_WIDTH = 220;
const PREVIEW_DELAY_MS = 300;
const previews = new WeakMap();

function previewOf(pdf) {
  if (!previews.has(pdf)) {
    previews.set(pdf, renderFirstPage(pdf.blob, PREVIEW_WIDTH));
  }

  return previews.get(pdf);
}

function DownloadButton({ primary, busy, disabled, pdfKey, getPdf, onClick }) {
  const [preview, setPreview] = useState(null);
  const [shown, setShown] = useState(false);
  const timer = useRef(null);
  const ticket = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  function show(event) {
    if (event.pointerType !== "mouse") return;

    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const current = ++ticket.current;
      setShown(true);
      setPreview((old) => (old?.key === pdfKey ? old : { key: pdfKey, status: "loading" }));

      try {
        const pdf = await getPdf();
        const page = await previewOf(pdf);
        if (current === ticket.current) {
          setPreview({ key: pdfKey, status: "ready", ...page, fileName: pdf.fileName });
        }
      } catch {
        if (current === ticket.current) setPreview({ key: pdfKey, status: "failed" });
      }
    }, PREVIEW_DELAY_MS);
  }

  function hide() {
    clearTimeout(timer.current);
    ticket.current++;
    setShown(false);
  }

  return (
    <div className="pdf-hover" onPointerEnter={show} onPointerLeave={hide}>
      <button
        type="button"
        className={`btn ${primary ? "btn-primary" : "btn-ghost"}`}
        disabled={disabled}
        onClick={() => {
          hide();
          onClick();
        }}
      >
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
          <path d="M10 3.5v9M6 8.75l4 4 4-4M4 15.5h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {busy ? "Preparing…" : "Download PDF"}
      </button>

      {shown && preview && (
        <div className="pdf-preview" aria-hidden="true">
          <div className="pdf-preview-page">
            {preview.status === "ready" && <img src={preview.image} alt="" />}
            {preview.status === "loading" && <span className="spinner" />}
            {preview.status === "failed" && <span className="pdf-preview-note">No preview</span>}
          </div>
          {preview.status === "ready" && (
            <div className="pdf-preview-meta">
              <span>{preview.fileName}</span>
              <span>{preview.pages === 1 ? "1 page" : `${preview.pages} pages`}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GradeSheetButton({ gradeSheet, attached, disabled, csrfToken, onAttach, onUploaded, onError, onUnauthorized }) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);

  async function upload(file) {
    const problem = checkPdf(file, MAX_GRADES_MB);

    if (problem) {
      onError(problem);
      return;
    }

    setUploading(true);
    onError("");

    try {
      const { response, data } = await apiUpload("/api/jobs/grade-sheet", file, { csrfToken });

      if (response.status === 401) {
        onUnauthorized();
        return;
      }

      if (!response.ok) {
        onError(data.error || "Could not upload your grade sheet.");
        return;
      }

      onUploaded(data);
      onAttach(true);
    } catch {
      onError("Could not reach the server. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  const label = attached && gradeSheet ? `Grade sheet attached: ${gradeSheet.filename}` : "Attach a grade sheet";

  return (
    <div className="attach" ref={ref}>
      <button
        type="button"
        className="attach-btn"
        aria-pressed={attached}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={disabled || uploading}
        onClick={() => setOpen((value) => !value)}
      >
        {uploading ? (
          <span className="spinner spinner-sm" aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
            <path d="M14.5 9.5l-5.25 5.25a3.18 3.18 0 0 1-4.5-4.5l6-6a2.12 2.12 0 0 1 3 3l-6 6a1.06 1.06 0 0 1-1.5-1.5l5.25-5.25" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {open && (
        <div className="attach-menu" role="menu" aria-label="Grade sheet">
          {gradeSheet && (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={attached}
              title="The grade sheet in your profile"
              onClick={() => {
                onAttach(true);
                setOpen(false);
              }}
            >
              <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                <path d="M5.5 2.75h6l3.75 3.75v9.25a1.5 1.5 0 0 1-1.5 1.5h-8.25a1.5 1.5 0 0 1-1.5-1.5v-11.5a1.5 1.5 0 0 1 1.5-1.5zM11.5 2.75v3.75h3.75" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="attach-menu-name">{gradeSheet.filename}</span>
              {attached && CHECK}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            title={gradeSheet ? "Replaces the one in your profile" : "Also saved to your profile"}
            onClick={() => {
              setOpen(false);
              inputRef.current.click();
            }}
          >
            <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                <path d="M10 13V3.75M6.25 7.5 10 3.75l3.75 3.75M4 13.5v1.75a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V13.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            <span className="attach-menu-name">Upload new file</span>
          </button>
          {attached && (
            <>
              <hr />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onAttach(false);
                  setOpen(false);
                }}
              >
                <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
                <span className="attach-menu-name">Remove attachment</span>
              </button>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files[0];
          event.target.value = "";
          if (file) upload(file);
        }}
      />
    </div>
  );
}

const CHECK = (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function TailorModal({ job, csrfToken, baseCv, gradeSheet, onGradeSheetChange, onClose, onTailored, onApply, onUnauthorized }) {
  const hasGradeSheet = Boolean(gradeSheet);

  const request = useCallback(async (path, options) => {
    const result = await apiRequest(path, options);

    if (result.response.status === 401) {
      onUnauthorized();
    }

    return result;
  }, [onUnauthorized]);
  const [tailoring, setTailoring] = useState(null);
  const [cv, setCv] = useState(null);
  const [includeGrades, setIncludeGrades] = useState(false);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [showChanges, setShowChanges] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const started = useRef(false);

  const [editorKey, setEditorKey] = useState(0);

  const accept = useCallback((saved) => {
    setEditorKey((key) => key + 1);
    setTailoring(saved);
    setCv(saved.cv);
    setIncludeGrades(saved.include_grade_sheet && hasGradeSheet);
    setDirty(false);
    setStatus("ready");
  }, [hasGradeSheet]);

  const generate = useCallback(async () => {
    setStatus("tailoring");
    setError("");

    try {
      const { response, data } = await request(`/api/jobs/${job.id}/tailor`, { method: "POST", csrfToken });

      if (!response.ok) {
        setError(data.error || "Could not tailor your resume.");
        setStatus(tailoring ? "ready" : "failed");
        return;
      }

      accept(data.tailoring);
      onTailored(job.id, data.description);
    } catch {
      setError("Could not reach the server. Please try again.");
      setStatus(tailoring ? "ready" : "failed");
    }
  }, [job.id, csrfToken, tailoring, accept, onTailored, request]);

  useEffect(() => {
    if (started.current) {
      return;
    }

    started.current = true;

    (async () => {
      try {
        const { response, data } = await request(`/api/jobs/${job.id}/tailoring`);

        if (response.ok && data.tailoring) {
          accept(data.tailoring);
        } else if (response.ok) {
          generate();
        } else {
          setError(data.error || "Could not load the tailored resume.");
          setStatus("failed");
        }
      } catch {
        setError("Could not reach the server. Please try again.");
        setStatus("failed");
      }
    })();
  }, [job.id, accept, generate, request]);

  async function save() {
    const { response, data } = await request(`/api/jobs/${job.id}/tailoring`, {
      method: "PUT",
      body: { cv, include_grade_sheet: includeGrades },
      csrfToken
    });

    if (!response.ok) {
      throw new Error(data.error || "Could not save your changes.");
    }

    setTailoring(data.tailoring);
    setCv(data.tailoring.cv);
    setDirty(false);
    return data.tailoring;
  }

  async function run(label, action) {
    setBusy(label);
    setError("");

    try {
      await action();
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setBusy("");
    }
  }

  const pdfCache = useRef({ key: null, promise: null });
  const pdfKeyOf = useCallback((source) => JSON.stringify([
    source, includeGrades, gradeSheet?.filename, gradeSheet?.uploaded_at
  ]), [includeGrades, gradeSheet]);
  const pdfKey = useMemo(() => pdfKeyOf(cv), [pdfKeyOf, cv]);

  const getPdf = useCallback((source = cv) => {
    const key = pdfKeyOf(source);

    if (pdfCache.current.key !== key) {
      const promise = makeTailoredPdf(source, includeGrades);
      pdfCache.current = { key, promise };
      promise.catch(() => {
        if (pdfCache.current.promise === promise) pdfCache.current = { key: null, promise: null };
      });
    }

    return pdfCache.current.promise;
  }, [cv, includeGrades, pdfKeyOf]);

  const download = () => run("download", async () => {
    const saved = dirty || includeGrades !== tailoring.include_grade_sheet ? await save() : tailoring;
    const { blob, fileName } = await getPdf(saved.cv);
    downloadBlob(blob, fileName);
  });

  const applied = job.state === "applied";
  const gaps = tailoring?.gaps || [];
  const flags = tailoring?.flags || [];
  const changeCount = countChanges(cv, baseCv);

  return (
    <Modal
      title={<span className="tailor-title">Resume for <strong>{job.position}</strong> at {job.company}</span>}
      onClose={onClose}
      wide
    >
      <div className="tailor">
        {error && <Alert type="error">{error}</Alert>}

        {(status === "loading" || status === "tailoring") && (
          <div className="tailor-progress" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            {status === "loading" ? "Loading…" : "Tailoring your resume to this job…"}
          </div>
        )}

        {status === "failed" && (
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={generate}>Try again</button>
          </div>
        )}

        {status === "ready" && cv && (
          <>


            {flags.length > 0 && (
              <Alert type="warning">
                The highlighted lines contain numbers that aren't in your original resume. Check them before sending.
              </Alert>
            )}

            <div className="tailor-viewbar">
              <div className="viewbar-group">
                <button
                  type="button"
                  className="viewbar-btn"
                  aria-haspopup="dialog"
                  onClick={() => setShowDetails(true)}
                >
                  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                    <path d="M5.5 2.75h6l3.75 3.75v9.25a1.5 1.5 0 0 1-1.5 1.5h-8.25a1.5 1.5 0 0 1-1.5-1.5v-11.5a1.5 1.5 0 0 1 1.5-1.5zM11.5 2.75v3.75h3.75M7 10.5h6M7 13.5h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Job details
                </button>
                <button
                  type="button"
                  className="viewbar-btn changes-toggle"
                  aria-pressed={showChanges}
                  onClick={() => setShowChanges((value) => !value)}
                >
                  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                    <path d="M6 3.5v13M3.5 6h5M14 3.5v13M11.5 14h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Show changes
                  {changeCount > 0 && <span className="changes-count">{changeCount}</span>}
                </button>
              </div>
              <button
                type="button"
                className="viewbar-btn"
                disabled={Boolean(busy)}
                onClick={() => {
                  if (!dirty || window.confirm("Regenerating replaces your edits. Continue?")) {
                    generate();
                  }
                }}
              >
                <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                  <path d="M16 10a6 6 0 1 1-1.76-4.24M16 4v3.5h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Regenerate
              </button>
            </div>

            <CvEditor
              key={editorKey}
              cv={cv}
              mode="tailored"
              showChanges={showChanges}
              original={baseCv}
              flags={flags}
              suggestions={gaps}
              onChange={(next) => {
                setCv(next);
                setDirty(true);
              }}
            />

            <div className="form-actions sticky-actions tailor-actions">
              <GradeSheetButton
                gradeSheet={gradeSheet}
                attached={includeGrades}
                disabled={Boolean(busy)}
                csrfToken={csrfToken}
                onAttach={setIncludeGrades}
                onUploaded={onGradeSheetChange}
                onError={setError}
                onUnauthorized={onUnauthorized}
              />
              <DownloadButton
                primary={applied}
                busy={busy === "download"}
                disabled={Boolean(busy)}
                pdfKey={pdfKey}
                getPdf={getPdf}
                onClick={download}
              />
              <button type="button" className="btn btn-ghost" disabled={Boolean(busy) || !dirty} onClick={() => run("save", save)}>
                {dirty ? (
                  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                    <path d="M4.5 4.5a1 1 0 0 1 1-1h7.6l2.4 2.4v8.6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z M7 3.5v3.5h5V3.5M7 15.5v-4h6v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                    <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
              {!applied && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={Boolean(busy)}
                  onClick={() => run("apply", async () => {
                    if (dirty || includeGrades !== tailoring.include_grade_sheet) {
                      await save();
                    }
                    await onApply(job);
                  })}
                >
                  {busy === "apply" ? "Saving…" : "Mark as applied"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {showDetails && <JobDetails job={job} onClose={() => setShowDetails(false)} />}
    </Modal>
  );
}

export default TailorModal;
