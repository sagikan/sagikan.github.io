import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pdfjs } = vi.hoisted(() => ({ pdfjs: { GlobalWorkerOptions: {}, getDocument: vi.fn() } }));
const context = { fake: "context", drawImage: vi.fn() };

vi.mock("pdfjs-dist", () => pdfjs);

// Builds a stand-in for a PDF with the given pages and a page whose size is known
function pdfOf({ pages = 2, width = 600, height = 800, renderFails = false, loadFails = false } = {}) {
  const renders = [];
  const page = {
    getViewport: ({ scale }) => ({ width: width * scale, height: height * scale }),
    render: vi.fn(() => {
      const render = { promise: renderFails ? Promise.reject(new Error("render failed")) : Promise.resolve(), cancel: vi.fn() };

      renders.push(render);

      return render;
    })
  };
  const pdf = { numPages: pages, getPage: vi.fn(async () => page) };
  const task = { promise: loadFails ? Promise.reject(new Error("bad PDF")) : Promise.resolve(pdf), destroy: vi.fn(async () => {}) };

  pdfjs.getDocument.mockReturnValue(task);

  return { page, pdf, task, renders };
}

// Loads the module fresh, since it remembers that pdf.js was loaded
async function freshModule() {
  vi.resetModules();

  return import("../pdfPreview");
}

// Makes the page look zoomed by the site's CSS zoom
function zoomPage(zoom) {
  const real = window.getComputedStyle;

  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => (
    element === document.documentElement ? { zoom: String(zoom) } : real(element)
  ));
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  vi.stubGlobal("devicePixelRatio", 1);
  context.drawImage.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pixelRatio", () => {
  it.each([
    [1, null, 1],
    [2, null, 2],
    [1, 1.35, 1.35],
    [2, 1.5, 3]
  ])("returns %s screen pixels times a page zoom of %s as %s", async (density, zoom, expected) => {
    vi.stubGlobal("devicePixelRatio", density);

    if (zoom) zoomPage(zoom);
    const { pixelRatio } = await freshModule();

    expect(pixelRatio()).toBeCloseTo(expected);
  });
});

describe("nextZoom", () => {
  it.each([
    [1, 1, 1.25],
    [1, -1, 0.75],
    [0.9, 1, 1],
    [0.9, -1, 0.75],
    [3, 1, null],
    [0.5, -1, null],
    [0.3, 1, 0.5],
    [4, -1, 3]
  ])("returns the step from %s going %s as %s", async (zoom, direction, expected) => {
    const { nextZoom } = await freshModule();

    expect(nextZoom(zoom, direction)).toBe(expected);
  });
});

describe("openPdf", () => {
  it("reads the PDF's bytes, points pdf.js at its worker and gets every page", async () => {
    const { pdf } = pdfOf({ pages: 3 });
    const { openPdf } = await freshModule();

    await openPdf(new Blob(["%PDF-1"]));

    expect(pdfjs.getDocument).toHaveBeenCalledWith({ data: new Uint8Array([37, 80, 68, 70, 45, 49]) });
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toEqual(expect.stringContaining("pdf.worker"));
    expect(pdf.getPage.mock.calls).toEqual([[1], [2], [3]]);
  });

  it("sets up pdf.js once, however many PDFs are opened", async () => {
    pdfOf();
    const { openPdf } = await freshModule();

    await openPdf(new Blob(["%PDF-"]));
    pdfjs.GlobalWorkerOptions.workerSrc = "changed since";
    await openPdf(new Blob(["%PDF-"]));

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe("changed since");
  });

  it("draws at the screen's pixel ratio, counting the page zoom, so the page isn't stretched", async () => {
    const { page } = pdfOf();

    vi.stubGlobal("devicePixelRatio", 2);
    zoomPage(1.5);
    const { openPdf } = await freshModule();
    const pdf = await openPdf(new Blob(["%PDF-"]));

    await pdf.drawPage(0, document.createElement("canvas"), 300).promise;

    expect(page.render).toHaveBeenCalledWith({ canvasContext: context, viewport: expect.objectContaining({ width: 900, height: 1200 }) });
  });

  it("sets the canvas to a whole number of pixels", async () => {
    pdfOf({ width: 612, height: 792 });
    const { openPdf } = await freshModule();
    const pdf = await openPdf(new Blob(["%PDF-"]));
    const canvas = document.createElement("canvas");

    await pdf.drawPage(0, canvas, 250).promise;

    expect(canvas.width).toBe(250);
    expect(canvas.height).toBe(Math.round(792 * (250 / 612)));
  });

  it("lists every page's size in CSS pixels at 100%", async () => {
    pdfOf({ pages: 2, width: 612, height: 792 });
    const { openPdf } = await freshModule();
    const pdf = await openPdf(new Blob(["%PDF-"]));

    expect(pdf.pages).toEqual([{ width: 816, height: 1056 }, { width: 816, height: 1056 }]);
  });

  it("draws a page off screen, then copies it into the canvas when it's done", async () => {
    pdfOf();
    const { openPdf } = await freshModule();
    const pdf = await openPdf(new Blob(["%PDF-"]));
    const canvas = document.createElement("canvas");

    await pdf.drawPage(1, canvas, 300).promise;

    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(400);
    expect(context.drawImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 0, 0);
    expect(context.drawImage.mock.calls[0][0]).not.toBe(canvas);
  });

  it("keeps the canvas's last drawing when a drawing fails", async () => {
    pdfOf({ renderFails: true });
    const { openPdf } = await freshModule();
    const pdf = await openPdf(new Blob(["%PDF-"]));
    const canvas = document.createElement("canvas");

    canvas.width = 120;
    await expect(pdf.drawPage(0, canvas, 300).promise).rejects.toThrow("render failed");

    expect(canvas.width).toBe(120);
    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it("cancels a drawing in progress", async () => {
    const { renders } = pdfOf();
    const { openPdf } = await freshModule();
    const pdf = await openPdf(new Blob(["%PDF-"]));

    pdf.drawPage(0, document.createElement("canvas"), 300).cancel();

    expect(renders[0].cancel).toHaveBeenCalledOnce();
  });

  it("keeps a large zoom within the browser's canvas size limit", async () => {
    const { page } = pdfOf({ width: 612, height: 792 });

    vi.stubGlobal("devicePixelRatio", 3);
    const { openPdf } = await freshModule();
    const pdf = await openPdf(new Blob(["%PDF-"]));

    await pdf.drawPage(0, document.createElement("canvas"), 2448).promise;
    const { width, height } = page.render.mock.calls[0][0].viewport;

    expect(width * height).toBeLessThanOrEqual(4096 * 4096 + 1);
    expect(width / height).toBeCloseTo(612 / 792);
  });

  it("frees the PDF once, however often it's closed", async () => {
    const { task } = pdfOf();
    const { openPdf } = await freshModule();
    const pdf = await openPdf(new Blob(["%PDF-"]));

    pdf.close();
    pdf.close();

    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it("frees the loading task and rejects when the PDF can't be read", async () => {
    const { task } = pdfOf({ loadFails: true });
    const { openPdf } = await freshModule();

    await expect(openPdf(new Blob(["nope"]))).rejects.toThrow("bad PDF");
    expect(task.destroy).toHaveBeenCalledOnce();
  });
});
