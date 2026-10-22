import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let pdfjsLoaded = null;

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

export async function renderFirstPage(blob, width) {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;

  try {
    const page = await pdf.getPage(1);
    const scale = (width * (window.devicePixelRatio || 1)) / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    return { image: canvas.toDataURL("image/png"), pages: pdf.numPages };
  } finally {
    pdf.destroy();
  }
}
