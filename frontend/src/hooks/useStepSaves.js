import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { addStep, changeStep, localISO, removeStep } from "../lib/api";
import { withStepAdded, withStepChanged, withStepRemoved } from "../utils/applications/journeyEdits";

const OFFLINE = "Could not reach the server. Please try again.";

/* Saves changes to applications' steps from their cards: each shows at once, then the server's saved copy replaces
   it and onSaved runs (a status change can leave email updates out of date). When a save fails, the card goes back
   to how it was and onError gets the message. Gives the IDs of the applications being saved, and a function per
   change. The functions stay the same between renders (they read the latest applications through a ref), so cards
   that get them can skip re-rendering */
export function useStepSaves({ applications, setApplications, onError, onUnauthorized, onSaved, csrfToken }) {
  const [savingIds, setSavingIds] = useState(() => new Set());
  const latest = useRef(applications);

  // Keeps the latest applications for the saves below
  useLayoutEffect(() => {
    latest.current = applications;
  }, [applications]);

  // Marks an application as saving or not
  const markSaving = useCallback((id, saving) => {
    setSavingIds((current) => {
      const next = new Set(current);

      if (saving) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  }, []);

  // Shows a change at once, sends it, and keeps the server's copy or rolls back with a message
  const save = useCallback(async (id, optimistic, request, fallback) => {
    const before = latest.current.find((job) => job.id === id);

    if (!before) {
      return;
    }

    // Puts the card back and reports why
    const rollBack = (message) => {
      setApplications((current) => current.map((job) => (job.id === id ? before : job)));
      onError(message);
    };

    onError("");
    markSaving(id, true);
    setApplications((current) => current.map((job) => (job.id === id ? optimistic(job) : job)));

    try {
      const { response, data } = await request();

      if (!response.ok) {
        if (response.status === 401) {
          onUnauthorized();
        }

        rollBack(data.error || fallback);
      } else {
        setApplications((current) => current.map((job) => (job.id === data.id ? data : job)));
        onSaved?.();
      }
    } catch {
      rollBack(OFFLINE);
    } finally {
      markSaving(id, false);
    }
  }, [setApplications, onError, onUnauthorized, onSaved, markSaving]);

  // Adds a new current status to an application, dated today
  const onAddStep = useCallback((id, status) => {
    const date = localISO(new Date());

    return save(id, (job) => withStepAdded(job, status, date), () => addStep(id, { status, date }, csrfToken), "Could not add the status.");
  }, [save, csrfToken]);

  // Changes an earlier step's status or a step's date
  const onChangeStep = useCallback((id, stepId, changes) => (
    save(id, (job) => withStepChanged(job, stepId, changes), () => changeStep(id, stepId, changes, csrfToken), "Could not change the step.")
  ), [save, csrfToken]);

  // Removes a step, or undoes the current status
  const onRemoveStep = useCallback((id, stepId) => (
    save(id, (job) => withStepRemoved(job, stepId), () => removeStep(id, stepId, csrfToken), "Could not remove the step.")
  ), [save, csrfToken]);

  return { savingIds, onAddStep, onChangeStep, onRemoveStep };
}
