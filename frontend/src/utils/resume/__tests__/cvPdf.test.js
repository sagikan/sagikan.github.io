import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FONTS } from "../cvLayout";

const { api, pdfMake } = vi.hoisted(() => ({
  api: { apiFile: vi.fn(), apiRequest: vi.fn() },
  pdfMake: { addFontContainer: vi.fn(), addVirtualFileSystem: vi.fn(), addFonts: vi.fn(), setUrlAccessPolicy: vi.fn(), createPdf: vi.fn() }
}));

vi.mock("../../../lib/api", () => api);
vi.mock("pdfmake/build/pdfmake", () => ({ default: pdfMake }));
vi.mock("pdfmake/build/standard-fonts/Times", () => ({ default: { times: true } }));

const CV = { name: "Dana Levi", location: "", phone: "", email: "", links: [], summary: "", education: [], experience: [], projects: [], skills: [], extras: [] };

// Builds the bytes of a PDF with the given number of pages
async function pdfWithPages(count) {
  const doc = await PDFDocument.create();

  for (let page = 0; page < count; page++) doc.addPage();

  return doc.save();
}

// Counts the pages of a PDF blob
async function pageCount(blob) {
  return (await PDFDocument.load(await blob.arrayBuffer())).getPageCount();
}

// Loads the module fresh, since it remembers whether the fonts were loaded
async function freshModule() {
  vi.resetModules();

  return import("../cvPdf");
}

beforeEach(async () => {
  const resume = await pdfWithPages(2);

  pdfMake.createPdf.mockReturnValue({ getBuffer: async () => resume });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
});

describe("makeTailoredPdf", () => {
  it("builds the resume PDF from the layout, named Resume.pdf", async () => {
    const { makeTailoredPdf } = await freshModule();
    const { blob, fileName } = await makeTailoredPdf(CV, false);

    expect(fileName).toBe("Resume.pdf");
    expect(blob.type).toBe("application/pdf");
    expect(await pageCount(blob)).toBe(2);
    expect(pdfMake.createPdf).toHaveBeenCalledWith(expect.objectContaining({ pageSize: "LETTER", info: { title: "Dana Levi - Resume" } }));
    expect(api.apiFile).not.toHaveBeenCalled();
  });

  it("loads the four fonts as base64 and blocks the PDF from fetching anything itself", async () => {
    const { makeTailoredPdf } = await freshModule();

    await makeTailoredPdf(CV, false);

    const files = pdfMake.addVirtualFileSystem.mock.calls[0][0];

    expect(Object.keys(files).sort()).toEqual(["EBGaramond-Bold.ttf", "EBGaramond-BoldItalic.ttf", "EBGaramond-Italic.ttf", "EBGaramond-Regular.ttf"]);
    expect(Object.values(files)).toEqual(Array(4).fill("AQID"));
    expect(pdfMake.addFontContainer).toHaveBeenCalledWith({ times: true });
    expect(pdfMake.addFonts).toHaveBeenCalledWith(FONTS);
    expect(pdfMake.setUrlAccessPolicy.mock.calls[0][0]()).toBe(false);
  });

  it("loads the fonts once, however many resumes are built", async () => {
    const { makeTailoredPdf } = await freshModule();

    await makeTailoredPdf(CV, false);
    await makeTailoredPdf(CV, false);

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(pdfMake.addFonts).toHaveBeenCalledOnce();
  });

  it("reports a font that couldn't be loaded, and tries again next time", async () => {
    const { makeTailoredPdf } = await freshModule();

    fetch.mockResolvedValue(new Response("missing", { status: 404 }));

    await expect(makeTailoredPdf(CV, false)).rejects.toThrow("Could not load the resume fonts. Please try again.");

    fetch.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));

    expect((await makeTailoredPdf(CV, false)).fileName).toBe("Resume.pdf");
  });

  describe("with a grade sheet", () => {
    // Mocks the grade sheet the server returns
    async function gradeSheet(pages, fileName) {
      api.apiFile.mockResolvedValue({ bytes: await pdfWithPages(pages), fileName });
    }

    it("adds the grade sheet's pages after the resume's, and names the file after it", async () => {
      await gradeSheet(3, "Grades 2024.pdf");
      const { makeTailoredPdf } = await freshModule();
      const { blob, fileName } = await makeTailoredPdf(CV, true);

      expect(api.apiFile).toHaveBeenCalledWith("/api/jobs/grade-sheet");
      expect(await pageCount(blob)).toBe(5);
      expect(fileName).toBe("Resume + Grades 2024.pdf");
    });

    it.each([
      ["removes characters that aren't allowed in file names", "My/Grades:2024?.PDF", "Resume + My Grades 2024.pdf"],
      ["collapses spaces", "  Grades    final  .pdf", "Resume + Grades final.pdf"],
      ["falls back to a generic name", "???.pdf", "Resume + Grade sheet.pdf"]
    ])("%s", async (_title, name, expected) => {
      await gradeSheet(1, name);
      const { makeTailoredPdf } = await freshModule();

      expect((await makeTailoredPdf(CV, true)).fileName).toBe(expected);
    });
  });
});

describe("downloadBlob", () => {
  const downloads = [];

  beforeEach(() => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function recordDownload() {
      downloads.push({ name: this.download, href: this.href });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    downloads.length = 0;
  });

  it("downloads the blob under the given name and removes its link", async () => {
    const { downloadBlob } = await freshModule();

    downloadBlob(new Blob(["pdf"]), "Resume.pdf");

    expect(downloads).toEqual([{ name: "Resume.pdf", href: "blob:test" }]);
    expect(document.querySelector("a")).toBeNull();
  });

  it("releases the blob URL after 10 seconds, not before", async () => {
    const { downloadBlob } = await freshModule();

    downloadBlob(new Blob(["pdf"]), "Resume.pdf");
    vi.advanceTimersByTime(9_999);

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});

describe("downloadSavedCv", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
  });

  it("builds the resume saved for the job and downloads it", async () => {
    const clicks = [];

    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function recordDownload() {
      clicks.push(this.download);
    });
    api.apiRequest.mockResolvedValue({ response: { ok: true }, data: { tailoring: { cv: CV, include_grade_sheet: false } } });
    const { downloadSavedCv } = await freshModule();

    await downloadSavedCv(12);

    expect(api.apiRequest).toHaveBeenCalledWith("/api/jobs/12/tailoring");
    expect(clicks).toEqual(["Resume.pdf"]);
  });

  it("includes the grade sheet when the saved resume had it", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    api.apiRequest.mockResolvedValue({ response: { ok: true }, data: { tailoring: { cv: CV, include_grade_sheet: true } } });
    api.apiFile.mockResolvedValue({ bytes: await pdfWithPages(1), fileName: "Grades.pdf" });
    const { downloadSavedCv } = await freshModule();

    await downloadSavedCv(12);

    expect(api.apiFile).toHaveBeenCalledWith("/api/jobs/grade-sheet");
  });

  it.each([
    ["the server's own message", { response: { ok: false }, data: { error: "Not yours." } }, "Not yours."],
    ["a default message when it gives none", { response: { ok: false }, data: {} }, "Could not find the resume for this application."],
    ["a default message when nothing was saved", { response: { ok: true }, data: { tailoring: null } }, "Could not find the resume for this application."]
  ])("reports %s", async (_title, reply, message) => {
    api.apiRequest.mockResolvedValue(reply);
    const { downloadSavedCv } = await freshModule();

    await expect(downloadSavedCv(12)).rejects.toThrow(message);
  });
});
