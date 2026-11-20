import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const CSS_PX_PER_PT = 96 / 72;
const MAX_CANVAS_PIXELS = 4096 * 4096;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
let pdfjsLoaded = null;

// Loads pdf.js on first use
function loadPdfjs() {
  pdfjsLoaded ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

    return pdfjs;
  }).catch((err) => {
    pdfjsLoaded = null;
    throw err;
  });

  return pdfjsLoaded;
}

// Returns how many screen pixels a CSS pixel covers, counting the CSS zoom the site sets on the page
export function pixelRatio() {
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;

  return (window.devicePixelRatio || 1) * zoom;
}

// Returns the zoom step past the current zoom, going up (1) or down (-1), or null when there is none
export function nextZoom(zoom, direction) {
  const steps = direction > 0 ? ZOOM_STEPS : ZOOM_STEPS.toReversed();

  return steps.find((step) => (direction > 0 ? step > zoom + 0.001 : step < zoom - 0.001)) ?? null;
}

// Starts drawing a page into a canvas at a CSS width, sharp on the screen but within the browser's canvas size limit
function renderInto(page, canvas, cssWidth) {
  const base = page.getViewport({ scale: 1 });
  const wanted = (cssWidth * pixelRatio()) / base.width;
  const scale = Math.min(wanted, Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)));
  const viewport = page.getViewport({ scale });

  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  return page.render({ canvasContext: canvas.getContext("2d"), viewport });
}

/* Opens a PDF to draw its pages. pages lists each page's size in CSS pixels at 100%; drawPage returns
   { promise, cancel } and keeps the canvas's last drawing until the new one is done; close frees the PDF */
export async function openPdf(blob) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  let pdf;

  try {
    pdf = await task.promise;
  } catch (err) {
    task.destroy();
    throw err;
  }

  const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, index) => pdf.getPage(index + 1)));
  let closed = false;

  // Draws one page off screen, then copies it into the canvas
  function drawPage(index, canvas, cssWidth) {
    const scratch = document.createElement("canvas");
    const render = renderInto(pages[index], scratch, cssWidth);
    const promise = render.promise.then(() => {
      canvas.width = scratch.width;
      canvas.height = scratch.height;
      canvas.getContext("2d").drawImage(scratch, 0, 0);
    });

    return { promise, cancel: () => render.cancel() };
  }

  // Frees the PDF, once however often it's called
  function close() {
    if (!closed) {
      closed = true;
      task.destroy();
    }
  }

  return {
    pages: pages.map((page) => {
      const { width, height } = page.getViewport({ scale: 1 });

      return { width: width * CSS_PX_PER_PT, height: height * CSS_PX_PER_PT };
    }),
    drawPage,
    close
  };
}
