import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pdfjs } = vi.hoisted(() => ({ pdfjs: { GlobalWorkerOptions: {}, getDocument: vi.fn() } }));

vi.mock("pdfjs-dist", () => pdfjs);

// Builds a stand-in for a PDF with the given pages and a page whose size is known
function pdfOf({ pages = 2, width = 600, height = 800, renderFails = false } = {}) {
  const page = {
    getViewport: ({ scale }) => ({ width: width * scale, height: height * scale }),
    render: vi.fn(() => ({ promise: renderFails ? Promise.reject(new Error("render failed")) : Promise.resolve() }))
  };
  const pdf = { numPages: pages, getPage: vi.fn(async () => page), destroy: vi.fn() };

  pdfjs.getDocument.mockReturnValue({ promise: Promise.resolve(pdf) });

  return { page, pdf };
}

// Loads the module fresh, since it remembers that pdf.js was loaded
async function freshModule() {
  vi.resetModules();

  return import("../pdfPreview");
}

describe("renderFirstPage", () => {
  const context = { fake: "context" };

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
    vi.stubGlobal("devicePixelRatio", 1);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the first page as an image sized to the width, and reports the page count", async () => {
    const { page, pdf } = pdfOf({ pages: 3 });
    const { renderFirstPage } = await freshModule();
    const result = await renderFirstPage(new Blob(["%PDF-"]), 300);

    expect(result).toEqual({ image: "data:image/png;base64,AAAA", pages: 3 });
    expect(pdf.getPage).toHaveBeenCalledWith(1);
    expect(page.render).toHaveBeenCalledWith({ canvasContext: context, viewport: expect.objectContaining({ width: 300, height: 400 }) });
  });

  it("renders sharper on high-density screens", async () => {
    const { page } = pdfOf();

    vi.stubGlobal("devicePixelRatio", 2);
    const { renderFirstPage } = await freshModule();

    await renderFirstPage(new Blob(["%PDF-"]), 300);

    expect(page.render.mock.calls[0][0].viewport).toMatchObject({ width: 600, height: 800 });
  });

  it("reads the PDF's bytes and points pdf.js at its worker", async () => {
    pdfOf();
    const { renderFirstPage } = await freshModule();

    await renderFirstPage(new Blob(["%PDF-1"]), 300);

    expect(pdfjs.getDocument).toHaveBeenCalledWith({ data: new Uint8Array([37, 80, 68, 70, 45, 49]) });
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toEqual(expect.stringContaining("pdf.worker"));
  });

  it("sets the canvas to a whole number of pixels", async () => {
    const canvases = [];
    const create = document.createElement.bind(document);

    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const element = create(tag);

      if (tag === "canvas") canvases.push(element);

      return element;
    });
    pdfOf({ width: 612, height: 792 });
    const { renderFirstPage } = await freshModule();

    await renderFirstPage(new Blob(["%PDF-"]), 250);

    expect(canvases[0].width).toBe(250);
    expect(canvases[0].height).toBe(Math.round(792 * (250 / 612)));
  });

  it("frees the PDF afterwards, even when rendering fails", async () => {
    const { pdf } = pdfOf({ renderFails: true });
    const { renderFirstPage } = await freshModule();

    await expect(renderFirstPage(new Blob(["%PDF-"]), 300)).rejects.toThrow("render failed");
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it("frees the PDF after a successful render too", async () => {
    const { pdf } = pdfOf();
    const { renderFirstPage } = await freshModule();

    await renderFirstPage(new Blob(["%PDF-"]), 300);

    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it("sets up pdf.js once, however many pages are rendered", async () => {
    pdfOf();
    const { renderFirstPage } = await freshModule();

    await renderFirstPage(new Blob(["%PDF-"]), 300);
    pdfjs.GlobalWorkerOptions.workerSrc = "changed since";
    await renderFirstPage(new Blob(["%PDF-"]), 300);

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe("changed since");
  });
});
