import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { nextZoom, openPdf } from "../../utils/resume/pdfPreview";
import { useMachine } from "../../hooks/useMachine";
import { PDF_PREVIEW } from "../../utils/resume/resumeMachines";

const PAGE_INSET = 16;
const PAGE_TOP = 8;
const KEYS = { "+": 1, "=": 1, "-": -1 };
const SCROLL_SHOW_MS = 1200;
const MIN_FIT_ZOOM = 0.1;

// Returns the page area's right padding, so the page's edge lines up with the close button whatever the scrollbar's width
function rightInset(bar) {
  return Math.max(0, PAGE_INSET - bar);
}

// One page of the PDF, redrawn sharp whenever its size changes
function PdfPage({ pdf, index, width, height }) {
  const ref = useRef(null);

  useEffect(() => {
    const drawing = pdf.drawPage(index, ref.current, width);

    // A cancelled or failed drawing keeps the page's last one
    drawing.promise.catch(() => {});

    return () => drawing.cancel();
  }, [pdf, index, width]);

  return <canvas ref={ref} className="pdf-peek-page" style={{ width, height }} role="img" aria-label={`Page ${index + 1}`} />;
}

/* Small dialog over the tailor window showing every page of the resume PDF. It holds only the pages, a control with
   the current page and zoom that shows while the mouse is over them or they scroll, and a close button; a click
   outside closes it too */
function PdfPreviewDialog({ getPdf, onClose }) {
  const [status, send] = useMachine(PDF_PREVIEW);
  const [doc, setDoc] = useState(null);
  const [view, setView] = useState({ fit: true, zoom: 1, fitZoom: 1, bar: 0 });
  const [currentPage, setCurrentPage] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const [marker, setMarker] = useState({ key: null, x: 0, width: 0, placed: false, jump: false, fromKeys: false });
  const titleId = useId();
  const dialogRef = useRef(null);
  const scrollRef = useRef(null);
  const place = useRef(null);
  const scrollTimer = useRef(null);
  const loading = status === "loading";
  const zoom = view.fit ? view.fitZoom : view.zoom;
  const zoomIn = nextZoom(zoom, 1);
  const zoomOut = nextZoom(zoom, -1);
  const markerShown = marker.key !== null && !(marker.key === "out" && !zoomOut) && !(marker.key === "in" && !zoomIn);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();

    return () => dialog.close();
  }, []);

  useEffect(() => () => clearTimeout(scrollTimer.current), []);

  // Builds and opens the PDF whenever the table is in loading: on opening, and again on Try again
  useEffect(() => {
    if (!loading) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const { blob, fileName } = await getPdf();
        const opened = await openPdf(blob);

        if (cancelled) {
          opened.close();

          return;
        }

        setDoc({ pdf: opened, fileName });
        send("loaded");
      } catch {
        if (!cancelled) send("fail");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getPdf, loading, send]);

  // Frees each opened PDF when the dialog closes
  useEffect(() => () => doc?.pdf.close(), [doc]);

  useLayoutEffect(() => {
    const box = scrollRef.current;

    if (!box || !doc) {
      return undefined;
    }

    const widest = Math.max(...doc.pdf.pages.map((page) => page.width));

    /* Fits the widest page between the insets that line it up with the title and the close button. The scrollbar
       sits inside the right inset, so its width comes off that side's padding */
    const measure = () => {
      const bar = Math.max(0, box.offsetWidth - box.clientWidth);

      setView((current) => ({ ...current, bar, fitZoom: Math.max(MIN_FIT_ZOOM, (box.clientWidth - PAGE_INSET - rightInset(bar)) / widest) }));
    };

    measure();
    box.focus({ preventScroll: true });
    const observer = new ResizeObserver(measure);
    observer.observe(box);

    return () => observer.disconnect();
  }, [doc]);

  useLayoutEffect(() => {
    const box = scrollRef.current;

    if (box && place.current) {
      box.scrollTop = place.current.top * box.scrollHeight;
      box.scrollLeft = place.current.left * box.scrollWidth;
      place.current = null;
    }
  }, [zoom]);

  // Remembers where the scroll area is, so the next zoom keeps the same part of the document in sight
  const keepPlace = useCallback(() => {
    const box = scrollRef.current;

    if (box?.scrollHeight) {
      place.current = { top: box.scrollTop / box.scrollHeight, left: box.scrollLeft / box.scrollWidth };
    }
  }, []);

  // Zooms one step in (1) or out (-1) from the latest zoom, so quick clicks each count
  const zoomBy = useCallback((direction) => {
    keepPlace();
    setView((current) => {
      const target = nextZoom(current.fit ? current.fitZoom : current.zoom, direction);

      return target ? { ...current, fit: false, zoom: target } : current;
    });
  }, [keepPlace]);

  // Fits the widest page to the width again
  const fitWidth = useCallback(() => {
    keepPlace();
    setView((current) => ({ ...current, fit: true }));
  }, [keepPlace]);

  /* Finds the page that covers the top third of the view, and shows the control for a moment, since the page number
     matters most while scrolling. Rectangles only, so the site's CSS zoom can't skew the comparison */
  function onScroll() {
    const box = scrollRef.current;
    const area = box.getBoundingClientRect();
    const line = area.top + area.height / 3;
    const tops = [...box.querySelectorAll(".pdf-peek-page")].map((page) => page.getBoundingClientRect().top);
    const index = tops.findLastIndex((top) => top <= line);

    setCurrentPage(Math.max(0, index));
    setScrolling(true);
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => setScrolling(false), SCROLL_SHOW_MS);
  }

  /* Slides the hover marker under a zoom button, as the site's pill groups do. Its first appearance jumps into place
     instead of sliding in from the corner */
  function markHover(key, button, fromKeys) {
    setMarker((current) => ({ key, x: button.offsetLeft, width: button.offsetWidth, placed: true, jump: !current.placed, fromKeys }));
  }

  /* Props that move the hover marker with the pointer or keyboard focus. Only a marker the keyboard placed leaves on
     blur, since pressing a button blurs the one before it, which mustn't undo the pointer's hover */
  function markerProps(key) {
    return {
      onPointerEnter: (event) => markHover(key, event.currentTarget, false),
      onFocus: (event) => event.currentTarget.matches(":focus-visible") && markHover(key, event.currentTarget, true),
      onBlur: () => setMarker((current) => (current.fromKeys ? { ...current, key: null } : current))
    };
  }

  useEffect(() => {
    // Zooms with + and - and fits the width with 0, leaving the browser's own Ctrl shortcuts alone
    function onKey(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || !doc) return;

      if (event.key === "0") {
        fitWidth();
      } else if (KEYS[event.key]) {
        zoomBy(KEYS[event.key]);
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [doc, zoomBy, fitWidth]);

  const pageCount = doc ? doc.pdf.pages.length : 0;

  return (
    <dialog
      ref={dialogRef}
      className="pdf-peek"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <header className="pdf-peek-header">
        <h2 id={titleId} className="pdf-peek-title">{doc ? doc.fileName : "Preview"}</h2>
        <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="pdf-peek-stage">
        {status !== "ready" && (
          <div className="pdf-peek-placeholder">
            <div className="pdf-peek-blank" aria-live="polite">
              {status === "loading" && (
                <>
                  <span className="spinner" aria-hidden="true" />
                  <span className="visually-hidden">Preparing the preview…</span>
                </>
              )}
              {status === "failed" && (
                <div className="pdf-peek-failed" role="alert">
                  <p>Couldn't show the preview.</p>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => send("retry")}
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {status === "ready" && (
          <>
            <div className="pdf-peek-scroll" ref={scrollRef} tabIndex={0} aria-label="Resume pages" onScroll={onScroll}>
              <div className="pdf-peek-pages" style={{ padding: `${PAGE_TOP}px ${rightInset(view.bar)}px ${PAGE_INSET}px ${PAGE_INSET}px` }}>
                {doc.pdf.pages.map((page, index) => (
                  <PdfPage key={index} pdf={doc.pdf} index={index} width={Math.floor(page.width * zoom)} height={Math.floor(page.height * zoom)} />
                ))}
              </div>
            </div>

            <div
              className="pdf-peek-controls"
              role="toolbar"
              aria-label="Page and zoom"
              data-active={scrolling}
              onPointerLeave={() => setMarker((current) => ({ ...current, key: null }))}
            >
              <span
                className={`pdf-peek-marker${markerShown ? " is-shown" : ""}${marker.jump ? " jump" : ""}`}
                style={{ transform: `translateX(${marker.x}px)`, width: marker.width }}
                aria-hidden="true"
              />
              <span className="pdf-peek-page-number" aria-label={`Page ${currentPage + 1} of ${pageCount}`}>
                {currentPage + 1} / {pageCount}
              </span>
              <span className="pdf-peek-separator" aria-hidden="true" />
              <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={!zoomOut} onClick={() => zoomBy(-1)} {...markerProps("out")}>
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  <path d="M5 10h10" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                </svg>
              </button>
              <button type="button" className="pdf-peek-percent" aria-label={`Zoom ${Math.round(zoom * 100)}%, fit to width`} title="Fit to width (0)" aria-pressed={view.fit} onClick={fitWidth} {...markerProps("fit")}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={!zoomIn} onClick={() => zoomBy(1)} {...markerProps("in")}>
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  <path d="M5 10h10M10 5v10" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

export default PdfPreviewDialog;
