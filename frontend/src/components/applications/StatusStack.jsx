import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import SelectInput from "../ui/SelectInput";
import CvButton from "./CvButton";
import StepDateBox from "./StepDateBox";
import { useMachine } from "../../hooks/useMachine";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { localISO } from "../../lib/api";
import { FIRST_STATUS, STATUS_STACK, STEP_ACTION, menuOptions, removeBlocked } from "../../utils/applications/applicationMachines";
import { foldShapes, restAmount, topIndex, easeInOut, easeOut } from "../../utils/applications/foldGeometry";

const FOLD_MS = 350;
const EAR_MS = 160;
const RETURN_STAGGER = 60;
const LEAVE_MS = 200;
// How long a new current status takes to fade in, evenly, as the card's tint changes (index.css)
const FADE_MS = 300;
// The last part of an undo's fold, in which the page fades, the card's tint changes and the page beneath grows its corner
const LAND_MS = FOLD_MS * 0.6;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PHONE = "(max-width: 640px)";
// Pixels between a status menu and its list: clears the date tag hanging half its height below the menu
const MENU_GAP = 12;

// Formats a YYYY-MM-DD date as "3 Oct"
function shortDate(iso) {
  const [, month, day] = iso.split("-").map(Number);

  return `${day} ${MONTHS[month - 1]}`;
}

// Returns the class naming a status's colors
function statusClass(status) {
  return `status-${status.toLowerCase()}`;
}

/* Returns each page's shade in a run of steps with the same status (interview rounds): "deeper" for a step repeating
   the status above it, "lighter" for the one under that, alternating down the run so a folded corner or a strip never
   blends into the page next to it; "" for every other page */
function repeatShades(steps) {
  const shades = steps.map(() => "");

  for (let i = steps.length - 2; i >= 0; i--) {
    if (steps[i].status === steps[i + 1].status) {
      shades[i] = shades[i + 1] === "deeper" ? "lighter" : "deeper";
    }
  }

  return shades;
}

// Tells whether the user asked for less motion
function reducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

// Reads the status area's size and fold sizes from its element and CSS: slant, strip width and folded corner
function measure(el) {
  const style = getComputedStyle(el);
  // Reads a length in pixels from a CSS variable
  const read = (name) => parseFloat(style.getPropertyValue(name)) || 0;

  return { w: el.clientWidth, h: el.clientHeight, slant: read("--slant"), strip: read("--strip"), ear: read("--ear") };
}

// Close icon
function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// An inline confirm with its question and two buttons, shown in place of a page's controls
function ZoneConfirm({ question, label, onYes, onKeep }) {
  return (
    <div className="zone-confirm">
      <span className="zone-confirm-text">{question}</span>
      <span className="zone-confirm-buttons">
        <button type="button" className="btn btn-danger btn-sm" onClick={onYes}>{label}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onKeep}>Keep</button>
      </span>
    </div>
  );
}

/* A card's status area: a stack of pages, the current status on top and each earlier step as a slashed panel beneath.
   The folded corner folds the top page back one step and keeps it folded; a strip or the card brings it back. Every
   page has its own status menu, date and ×, all following the journey rules. Edits go to the parent, which saves them;
   while one is saving (busy), the controls wait. Every callback gets the application's ID first, so the parent can pass
   the same functions to every card and a card whose props didn't change skips re-rendering (memo) */
function StatusStack({ job, folded, busy = false, cvBusy = false, onDownloadCv, onFoldChange, onAddStep, onChangeStep, onRemoveStep, onDelete }) {
  const steps = job.steps;
  const jobId = job.id;
  const [stack, sendStack] = useMachine(STATUS_STACK);
  const [action, sendAction] = useMachine(STEP_ACTION);
  const [actionId, setActionId] = useState(null);
  const [turnedIds, setTurnedIds] = useState(() => new Set());
  const [dateFor, setDateFor] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const phone = useMediaQuery(PHONE);
  const zoneRef = useRef(null);
  const geometry = useRef(null);
  const stepsRef = useRef(steps);
  const turnedRef = useRef(turnedIds);
  const amounts = useRef(new Map());
  const runs = useRef(new Map());
  const previousIds = useRef(null);
  const focusAfter = useRef(null);
  const wasFolded = useRef(folded);
  const foldChange = useRef(onFoldChange);
  const undone = useRef(null);
  const arriving = useRef(null);
  const fade = useRef(null);
  const today = localISO(new Date());
  const undoingId = action === "undoing" ? actionId : null;
  const flags = steps.map((step) => turnedIds.has(step.id) || step.id === undoingId);
  const top = topIndex(flags);
  // While the current status folds away in an undo, the page beneath already looks like the current one
  const lookCurrent = undoingId ? steps.length - 2 : steps.length - 1;
  const shades = repeatShades(steps.slice(0, lookCurrent + 1));
  const current = steps[steps.length - 1];

  // Returns a page's element and its front, crease shade and flap, found by the step's ID
  const pageOf = useCallback((id) => {
    const el = zoneRef.current?.querySelector(`.zpage[data-step="${id}"]`);

    return el && { el, front: el.querySelector(".zfront"), shade: el.querySelector(".zshade"), flap: el.querySelector(".zflap") };
  }, []);

  // Returns the status area's geometry with the current number of pages
  const zoneOf = useCallback(() => ({ ...geometry.current, count: stepsRef.current.length }), []);

  /* Ends a page's fade, now or once it's done: the card's old tint comes off (index.css), and a page that faded in
     shows fully, while one that faded out stays hidden until it's gone */
  const stopFade = useCallback(() => {
    const run = fade.current;
    const card = zoneRef.current?.closest(".app-card");
    const page = run && pageOf(run.id);

    if (run) {
      cancelAnimationFrame(run.frame);
    }

    if (page) {
      page.el.style.opacity = run.out ? "0" : "";
    }

    card?.style.removeProperty("--was-soft");
    card?.style.removeProperty("--was-alpha");
    fade.current = null;
  }, [pageOf]);

  /* Fades a page in as a new current status, or out as an undone one, while the card's tint from the status it had
     before (wasStatus) fades off by the same amount every frame. The two blend alike on both sides of the status
     area's edge, which a color transition on the card doesn't, so no line shows there. It runs on its own clock and
     finds the page by its latest ID, so a fold or a new ID never leaves it half done */
  const startFade = useCallback((id, wasStatus, { out = false, ms = FADE_MS, ease = (t) => t } = {}) => {
    const card = zoneRef.current?.closest(".app-card");
    const run = { id, out, start: null, frame: 0 };

    stopFade();

    if (reducedMotion()) {
      return;
    }

    // Shows one frame of the fade
    const tick = (now) => {
      run.start ??= now;

      const t = Math.min(1, (now - run.start) / ms);
      const shown = ease(t);
      const page = pageOf(run.id);

      if (t === 1) {
        stopFade();
        return;
      }

      if (page) {
        page.el.style.opacity = String(out ? 1 - shown : shown);
      }

      card?.style.setProperty("--was-alpha", String(1 - shown));
      run.frame = requestAnimationFrame(tick);
    };

    fade.current = run;
    pageOf(id)?.el.style.setProperty("opacity", out ? "1" : "0");
    card?.style.setProperty("--was-soft", `var(--${wasStatus.toLowerCase()}-soft)`);
    card?.style.setProperty("--was-alpha", "1");
    run.frame = requestAnimationFrame(tick);
  }, [pageOf, stopFade]);

  /* Draws one page folded back by an amount from 0 to 1. While an undo folds the current status away, or a new one
     unfolds into place, the other pages are drawn as they are without it */
  const draw = useCallback((id, q) => {
    const index = stepsRef.current.findIndex((step) => step.id === id);
    const page = pageOf(id);
    const zone = zoneOf();

    amounts.current.set(id, q);

    if (index === -1 || !page?.el || !geometry.current?.w) {
      return;
    }

    if ((undone.current && id !== undone.current) || (arriving.current && id !== arriving.current)) {
      zone.count -= 1;
    }

    const shapes = foldShapes(zone, index, q);

    Object.entries(shapes.vars).forEach(([name, value]) => page.el.style.setProperty(name, value));
    page.front.style.clipPath = shapes.front;
    page.shade.style.clipPath = shapes.shade;
    page.flap.style.clipPath = shapes.flap;
  }, [zoneOf, pageOf]);

  // Stops a page's running fold where it is; what it set up for its time (ended) is put back
  const stop = useCallback((id) => {
    const run = runs.current.get(id);

    if (run) {
      cancelAnimationFrame(run.frame);
      runs.current.delete(id);
      run.ended?.();
    }
  }, []);

  /* Animates a page's fold to a new amount along an easing curve. done runs only once it lands; ended runs when it
     lands or another fold of the page takes over, to put back what it set up. The clock starts at the first frame, so
     a busy moment before it delays the fold instead of making it skip ahead. The run follows its page to a new ID */
  const animate = useCallback((id, to, ms, { ease = easeInOut, done, ended } = {}) => {
    const from = amounts.current.get(id) ?? 0;
    const duration = reducedMotion() ? 0 : ms;
    const run = { id, to, start: null, frame: 0, ended };

    stop(id);

    // Draws one frame of the fold
    function frame(now) {
      run.start ??= now;

      const t = duration ? Math.min(1, (now - run.start) / duration) : 1;

      draw(run.id, from + (to - from) * ease(t));

      if (t < 1) {
        run.frame = requestAnimationFrame(frame);
      } else {
        runs.current.delete(run.id);
        run.ended?.();
        done?.();
      }
    }

    runs.current.set(id, run);
    run.frame = requestAnimationFrame(frame);
  }, [draw, stop]);

  // Returns which pages are folded back, oldest first
  const turnedFlags = useCallback(() => stepsRef.current.map((step) => turnedRef.current.has(step.id)), []);

  // Returns how far a page rests now
  const restOf = useCallback((index) => restAmount(zoneOf(), index, turnedFlags()), [zoneOf, turnedFlags]);

  // Settles the top page at its resting fold, showing the folded corner when a page lies beneath
  const settleTop = useCallback(() => {
    const index = topIndex(turnedFlags());

    animate(stepsRef.current[index].id, restOf(index), EAR_MS);
  }, [animate, restOf, turnedFlags]);

  // Draws every page at rest without animating, except pages being animated and, when asked, the top one
  const layOut = useCallback((skipTop = false) => {
    const topNow = topIndex(turnedFlags());

    stepsRef.current.forEach((step, index) => {
      if (!runs.current.has(step.id) && !(skipTop && index === topNow)) {
        draw(step.id, restOf(index));
      }
    });
  }, [draw, restOf, turnedFlags]);

  /* Ends a new current status's arrival, when it lands or a fold takes over: the page under it takes its earlier
     step's look and shape, hidden beneath it */
  const endArrival = useCallback((oldId) => {
    arriving.current = null;
    pageOf(oldId)?.el.classList.remove("holding");
    layOut(true);
  }, [pageOf, layOut]);

  /* Marks which pages are folded back and tells the parent whether the card is folded. The parent's update re-renders
     every card, so it runs as a transition that never holds up the fold's frames */
  const setTurned = useCallback((next) => {
    const was = turnedRef.current.size;

    turnedRef.current = next;
    setTurnedIds(next);

    if (!was && next.size) {
      sendStack("fold");
      startTransition(() => foldChange.current(jobId, true));
    } else if (was && next.size) {
      sendStack("unfold", "folded");
    } else if (was && !next.size) {
      sendStack("unfold", "flat");
      startTransition(() => foldChange.current(jobId, false));
    }
  }, [sendStack, jobId]);

  // Closes an open confirm without doing anything
  const keep = useCallback(() => {
    if (STEP_ACTION.can(action, "keep")) {
      sendAction("keep");
      setActionId(null);
    }
  }, [action, sendAction]);

  // Closes the date box and any confirm
  const closeExtras = useCallback(() => {
    setDateFor(null);
    keep();
  }, [keep]);

  // Unfolds pages back to the chosen step, lowest first
  const unfoldTo = useCallback((target) => {
    const all = stepsRef.current;
    const flagsNow = turnedFlags();
    const back = all.filter((step, index) => flagsNow[index] && index <= target);

    closeExtras();

    if (!back.length) {
      return;
    }

    animate(all[topIndex(flagsNow)].id, 0, EAR_MS);
    setTurned(new Set([...turnedRef.current].filter((id) => !back.some((step) => step.id === id))));
    setAnnouncement(`Back to ${all[topIndex(turnedFlags())].status}`);
    back.forEach((step, order) => {
      setTimeout(() => {
        const index = stepsRef.current.findIndex((each) => each.id === step.id);

        if (index !== -1) {
          animate(step.id, restOf(index), FOLD_MS * 0.8);
        }
      }, order * RETURN_STAGGER);
    });
  }, [animate, closeExtras, restOf, setTurned, turnedFlags]);

  // Tells whether a removal or an undo is under way, during which the pages stay as they are
  function actionUnderWay() {
    return STEP_ACTION.can(action, "finish");
  }

  // Unfolds back to a step and moves focus to its status menu once it can take focus
  function returnTo(target) {
    if (actionUnderWay()) {
      return;
    }

    if (turnedRef.current.size) {
      focusAfter.current = stepsRef.current[target]?.id;
    }

    unfoldTo(target);
  }

  // Folds the top page back one step; the page beneath shows its folded corner once the fold lands
  function foldNext() {
    const index = topIndex(turnedFlags());
    const page = steps[index];

    if (index === 0 || actionUnderWay()) {
      return;
    }

    closeExtras();
    setTurned(new Set([...turnedRef.current, page.id]));

    const shown = steps[index - 1];

    setAnnouncement(`Showing ${shown.status} from ${shortDate(shown.date)}, step ${index} of ${steps.length}`);

    if (index === 1) {
      focusAfter.current = { dateOf: steps[0].id };
    }

    animate(page.id, 1, FOLD_MS, { done: settleTop });
  }

  // Applies an option picked from a step's menu: a new current status, a changed earlier step, or Undo
  function choose(index, option) {
    const step = steps[index];

    if (option.action === "undo") {
      ask(step.id, "askUndo");
      return;
    }

    if (option.status === step.status && !option.repeat) {
      return;
    }

    if (index === steps.length - 1) {
      onAddStep(job.id, option.status);
    } else {
      onChangeStep(job.id, step.id, { status: option.status });
    }
  }

  // Shows a page's confirm for an action, unless another action is under way
  function ask(id, move) {
    if (STEP_ACTION.can(action, move)) {
      setActionId(id);
      sendAction(move);
    }
  }

  // Ends a removal or an undo once its page is gone, and hands the removal to the parent
  function finishRemoving(id) {
    const index = stepsRef.current.findIndex((step) => step.id === id);

    focusAfter.current = stepsRef.current[index - 1]?.id;
    sendAction("finish");
    setActionId(null);
    onRemoveStep(job.id, id);
  }

  // Closes a confirm on Keep and returns focus to the × that opened it
  function keepAndReturn() {
    focusAfter.current = { closeOf: actionId };
    keep();
  }

  /* Folds the current status away for good; the step before it becomes the current status again. That page takes
     the current status's look and shape as the fold starts, and grows its folded corner while the folded page fades
     as the fold lands, so nothing changes once the folded page is gone */
  function undoCurrent() {
    const id = current.id;
    const below = steps.length - 2;
    const corner = restAmount({ ...zoneOf(), count: below + 1 }, below, steps.slice(0, -1).map(() => false));

    undone.current = id;
    sendAction("confirm");
    draw(steps[below].id, 0);
    animate(id, 1, FOLD_MS, { ease: easeOut, done: () => finishRemoving(id) });
    setTimeout(() => {
      // The card takes the earlier status's tint under its old one, which fades off with the page, until the page is gone
      zoneRef.current?.closest(".app-card")?.style.setProperty("--status-soft", `var(--${steps[below].status.toLowerCase()}-soft)`);
      startFade(id, current.status, { out: true, ms: LAND_MS, ease: easeInOut });
      animate(steps[below].id, corner, LAND_MS);
    }, FOLD_MS - LAND_MS);
  }

  // Fades an earlier step out, then removes it
  function removeStep(id) {
    sendAction("confirm");
    setTimeout(() => finishRemoving(id), LEAVE_MS);
  }

  // Deletes the application
  function deleteApplication() {
    sendAction("confirm");
    setActionId(null);
    onDelete(job.id);
  }

  // Closes the date box and returns focus to the date it was opened from
  function closeDate() {
    const id = dateFor?.id;

    setDateFor(null);
    pageOf(id)?.el.querySelector(".step-dates")?.focus();
  }

  // Keeps the latest steps for the drawing code, before any other effect draws
  useLayoutEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  /* Keeps the parent's latest fold callback, which is a new function on every render: reading it through a ref keeps
     the callbacks and effects below from re-running with every render of the list */
  useLayoutEffect(() => {
    foldChange.current = onFoldChange;
  });

  // Lays the pages out now and whenever the area's size changes (a resize, or the phone layout)
  useLayoutEffect(() => {
    const el = zoneRef.current;

    // Measures the area again and redraws every page at rest
    const relay = () => {
      geometry.current = measure(el);
      layOut();
    };

    relay();

    if (typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(relay);

    observer.observe(el);

    return () => observer.disconnect();
  }, [layOut, phone]);

  // When the steps change, a new current status unfolds into place; any other change redraws the pages at rest
  useLayoutEffect(() => {
    const ids = steps.map((step) => step.id);
    const before = previousIds.current;

    previousIds.current = ids;

    // An undone page is drawn apart from the rest, and the card keeps the tint it faded to, until the page is gone
    if (undone.current && !ids.includes(undone.current)) {
      undone.current = null;
      zoneRef.current?.closest(".app-card")?.style.removeProperty("--status-soft");
    }

    if (!before) {
      return;
    }

    const pushed = ids.length === before.length + 1 && before.every((id, index) => ids[index] === id);
    const turnedBefore = [...turnedRef.current];
    // A new status arrives over every page, so a folded card unfolds (an accepted email update can add one while folded)
    const kept = new Set(pushed ? [] : turnedBefore.filter((id) => ids.includes(id)));

    if (kept.size !== turnedBefore.length) {
      setTurned(kept);
    }

    // Pages folded back under the old current one return to rest; the old one flattens under the new page below
    if (pushed) {
      turnedBefore
        .filter((id) => id !== before[before.length - 1])
        .forEach((id) => animate(id, restOf(ids.indexOf(id)), FOLD_MS * 0.8));
    }

    /* A saved step comes back from the server under its real ID, as a new element: it's drawn at once as folded as
       before, and its running fold, fade and arrival follow it there. This comes first, so the checks below see the
       step under its new ID and don't take it for one that's gone */
    if (ids.length === before.length) {
      before.forEach((id, index) => {
        const now = ids[index];

        if (id === now || !amounts.current.has(id)) {
          return;
        }

        const run = runs.current.get(id);

        if (run) {
          run.id = now;
          runs.current.delete(id);
          runs.current.set(now, run);
        }

        if (fade.current?.id === id) {
          fade.current.id = now;
        }

        if (arriving.current === id) {
          arriving.current = now;
        }

        amounts.current.set(now, amounts.current.get(id));
        amounts.current.delete(id);
        draw(now, amounts.current.get(now));
      });
    }

    // A new status the server refused is gone before it lands: its fade and arrival end, so the pages look as before
    if (fade.current && !ids.includes(fade.current.id)) {
      stopFade();
    }

    if (arriving.current && !ids.includes(arriving.current)) {
      stop(arriving.current);
    }

    /* A new current status unfolds into place over the old one, whose folded corner flattens under it: the reverse of
       an undo. Until it lands, the old one keeps the current status's shape and look (holding), and the new page fades
       in as the card's old tint fades off it, so its first strip grows out of the card's color */
    if (pushed) {
      const id = ids[ids.length - 1];
      const oldId = before[before.length - 1];

      if (arriving.current) {
        stop(arriving.current);
      }

      arriving.current = id;
      pageOf(oldId)?.el.classList.add("holding");
      startFade(id, steps[steps.length - 2].status);
      animate(oldId, 0, EAR_MS);
      draw(id, 1);
      animate(id, restOf(ids.length - 1), FOLD_MS, { ease: easeOut, ended: () => endArrival(oldId) });
      layOut();
    } else {
      const index = topIndex(turnedFlags());
      const run = runs.current.get(ids[index]);

      // The top page settles at rest, unless its running fold already takes it there
      layOut(true);

      if (run?.to !== restOf(index)) {
        settleTop();
      }
    }
  }, [steps, animate, draw, endArrival, layOut, pageOf, restOf, setTurned, settleTop, startFade, stop, stopFade, turnedFlags]);

  // Folding another card unfolds this one: the parent stops calling it the folded card
  useEffect(() => {
    if (wasFolded.current && !folded && turnedRef.current.size) {
      unfoldTo(stepsRef.current.length - 1);
    }

    wasFolded.current = folded;
  }, [folded, unfoldTo]);

  // Moves focus where the last fold, unfold or page action asked, once the page can take it
  useEffect(() => {
    const target = focusAfter.current;

    if (!target) {
      return;
    }

    focusAfter.current = null;

    if (target.dateOf) {
      pageOf(target.dateOf)?.el.querySelector(".step-dates")?.focus({ preventScroll: true });
    } else if (target.closeOf) {
      pageOf(target.closeOf)?.el.querySelector(".zone-x")?.focus({ preventScroll: true });
    } else {
      pageOf(target)?.el.querySelector(".status-select")?.focus({ preventScroll: true });
    }
  }, [turnedIds, action, steps, pageOf]);

  // Stops any running fold or fade when the card goes away
  useEffect(() => () => {
    runs.current.forEach((run) => cancelAnimationFrame(run.frame));
    cancelAnimationFrame(fade.current?.frame);
  }, []);

  // Handles clicks in the area: a strip returns to its step, and clicks on a page stay in the area
  function handleClick(event) {
    const front = event.target.closest?.(".zfront");
    const inside = zoneRef.current.contains(event.target);

    if (front && inside) {
      const id = front.closest(".zpage").dataset.step;
      const index = steps.findIndex((step) => step.id === id);

      if (flags[index] && !phone) {
        returnTo(index);
      }

      event.stopPropagation();
    } else if (!inside) {
      event.stopPropagation();
    }
  }

  // Lets a keyboard reach every step: Enter or Space on a strip returns to it, Escape returns to the current status
  function handleKeyDown(event) {
    const strip = event.target.closest?.(".zpage.turned > .zfront");

    if (strip && event.target === strip && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      returnTo(steps.findIndex((step) => step.id === strip.closest(".zpage").dataset.step));
    } else if (event.key === "Escape" && stack === "folded" && !dateFor) {
      returnTo(steps.length - 1);
    }
  }

  // Renders one page of the status area
  function renderPage(step, index) {
    const isCurrent = index === steps.length - 1;
    const turned = flags[index];
    const asking = actionId === step.id && STEP_ACTION.can(action, "keep") ? action : null;
    const firstLocked = !isCurrent && index === 0;
    const blocked = isCurrent ? "" : removeBlocked(steps, index);
    const stripLabel = isCurrent ? `Back to the current status, ${step.status}` : `Back to ${step.status}, ${shortDate(step.date)}`;
    const stripActive = turned && !phone;
    // Marks a control that is off only while a change saves, so it keeps its look instead of flickering dim
    const waiting = (off) => (busy && !off ? " waiting" : "");

    return (
      <div
        key={step.id}
        data-step={step.id}
        className={`zpage ${index >= lookCurrent ? "current" : "earlier"} ${statusClass(step.status)}${turned ? " turned" : ""}${shades[index] ? ` ${shades[index]}` : ""}${action === "removing" && actionId === step.id ? " leaving" : ""}`}
        style={{ zIndex: index + 1 }}
        inert={!turned && index !== top}
      >
        <div
          className="zfront"
          tabIndex={stripActive ? 0 : undefined}
          role={stripActive ? "button" : undefined}
          aria-label={stripActive ? stripLabel : undefined}
        >
          <div className="zone-controls" inert={turned}>
            {!asking && (
              <>
                <div className="slot">
                  {isCurrent && job.cv_job_id && <CvButton job={job} busy={cvBusy} onDownload={onDownloadCv} />}
                  <span className="pill-wrap">
                    <SelectInput
                      className={`status-select${waiting(firstLocked)}`}
                      floating
                      floatGap={MENU_GAP}
                      fitWidest
                      value={step.status}
                      options={menuOptions(steps, index, today)}
                      onChange={(_value, option) => choose(index, option)}
                      disabled={firstLocked || busy}
                      title={firstLocked ? `The first status is always ${FIRST_STATUS}.` : undefined}
                      aria-label={isCurrent ? `Change status for ${job.company}` : `Change the ${step.status} step for ${job.company}`}
                    />
                    <button
                      type="button"
                      className={`step-dates${waiting(false)}`}
                      disabled={busy}
                      title="Change when this step happened"
                      aria-label={`${step.status} on ${shortDate(step.date)}. Change date`}
                      onClick={(event) => {
                        keep();
                        setDateFor(dateFor?.id === step.id ? null : { id: step.id, anchor: event.currentTarget });
                      }}
                    >
                      {shortDate(step.date)}
                    </button>
                  </span>
                </div>
                {isCurrent ? (
                  <button
                    type="button"
                    className={`icon-btn zone-x${waiting(false)}`}
                    disabled={busy}
                    onClick={() => ask(step.id, "askDelete")}
                    aria-label={`Delete ${job.company} application`}
                    title="Delete application"
                  >
                    <CloseIcon />
                  </button>
                ) : index > 0 && (
                  <button
                    type="button"
                    className={`icon-btn zone-x${waiting(blocked)}`}
                    disabled={busy || Boolean(blocked)}
                    onClick={() => ask(step.id, "askRemove")}
                    aria-label={`Remove the ${step.status} step`}
                    title={blocked || "Remove this step"}
                  >
                    <CloseIcon />
                  </button>
                )}
              </>
            )}
            {asking === "delete" && (
              <ZoneConfirm question="Delete this application?" label="Delete" onKeep={keepAndReturn} onYes={() => deleteApplication()} />
            )}
            {asking === "remove" && (
              <ZoneConfirm question={`Remove ${step.status}?`} label="Remove" onKeep={keepAndReturn} onYes={() => removeStep(step.id)} />
            )}
            {asking === "undo" && (
              <ZoneConfirm question={`Back to ${steps[index - 1]?.status}?`} label="Undo" onKeep={keepAndReturn} onYes={() => undoCurrent()} />
            )}
          </div>
        </div>
        <div className="zshade" />
        <div className="zflap-wrap"><div className="zflap" /></div>
      </div>
    );
  }

  const dateIndex = steps.findIndex((step) => step.id === dateFor?.id);

  return (
    <div
      ref={zoneRef}
      className={`zone${top > 0 ? " can-fold" : ""}${undoingId ? " undoing" : ""}`}
      role="group"
      aria-label={`Status history: ${steps[top].status}, step ${top + 1} of ${steps.length}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {steps.map(renderPage)}
      <button
        type="button"
        className="zone-hit"
        onClick={(event) => {
          event.stopPropagation();
          foldNext();
        }}
        aria-label={top > 0 ? `Fold back to ${steps[top - 1].status}` : "Fold back one step"}
        title={top > 0 ? `Fold back to ${steps[top - 1].status}` : "Fold back one step"}
      />
      <p className="visually-hidden" aria-live="polite">{announcement}</p>
      {dateIndex !== -1 && (
        <StepDateBox
          anchor={dateFor.anchor}
          steps={steps}
          index={dateIndex}
          today={today}
          onSave={(date) => {
            closeDate();
            onChangeStep(job.id, dateFor.id, { date });
          }}
          onClose={closeDate}
        />
      )}
    </div>
  );
}

export default memo(StatusStack);
