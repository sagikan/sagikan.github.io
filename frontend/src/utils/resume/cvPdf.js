import { apiFile, apiRequest } from "../../api";
import { FONTS, cvDocument } from "./cvLayout";
import garamondRegular from "../../assets/fonts/ebgaramond/EBGaramond-Regular.ttf?url";
import garamondBold from "../../assets/fonts/ebgaramond/EBGaramond-Bold.ttf?url";
import garamondItalic from "../../assets/fonts/ebgaramond/EBGaramond-Italic.ttf?url";
import garamondBoldItalic from "../../assets/fonts/ebgaramond/EBGaramond-BoldItalic.ttf?url";

const FONT_URLS = {
  "EBGaramond-Regular.ttf": garamondRegular,
  "EBGaramond-Bold.ttf": garamondBold,
  "EBGaramond-Italic.ttf": garamondItalic,
  "EBGaramond-BoldItalic.ttf": garamondBoldItalic
};
let fontsLoaded = null;

function loadPdfMake() {
  fontsLoaded ??= (async () => {
    const [{ default: pdfMake }, { default: times }] = await Promise.all([
      import("pdfmake/build/pdfmake"),
      import("pdfmake/build/standard-fonts/Times")
    ]);
    const files = await Promise.all(Object.entries(FONT_URLS).map(async ([name, url]) => {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Could not load the resume fonts. Please try again.");
      }

      return [name, toBase64(new Uint8Array(await response.arrayBuffer()))];
    }));

    pdfMake.addFontContainer(times);
    pdfMake.addVirtualFileSystem(Object.fromEntries(files));
    pdfMake.addFonts(FONTS);
    pdfMake.setUrlAccessPolicy?.(() => false);
    return pdfMake;
  })().catch((err) => {
    fontsLoaded = null;
    throw err;
  });

  return fontsLoaded;
}

function toBase64(bytes) {
  let binary = "";

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

async function buildCvPdf(cv, gradeSheet = null) {
  const pdfMake = await loadPdfMake();
  const resume = await pdfMake.createPdf(cvDocument(cv)).getBuffer();

  if (!gradeSheet) {
    return new Blob([resume], { type: "application/pdf" });
  }

  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.load(resume);
  const extra = await PDFDocument.load(gradeSheet);
  const pages = await merged.copyPages(extra, extra.getPageIndices());

  pages.forEach((page) => merged.addPage(page));
  return new Blob([await merged.save()], { type: "application/pdf" });
}

function cvFileName(gradeSheetName = null) {
  if (gradeSheetName === null) {
    return "Resume.pdf";
  }

  const name = gradeSheetName.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `Resume + ${name || "Grade sheet"}.pdf`;
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function makeTailoredPdf(cv, includeGradeSheet) {
  const gradeSheet = includeGradeSheet ? await apiFile("/api/jobs/grade-sheet") : null;
  return {
    blob: await buildCvPdf(cv, gradeSheet?.bytes),
    fileName: cvFileName(gradeSheet ? gradeSheet.fileName : null)
  };
}

async function downloadTailoredCv(cv, includeGradeSheet) {
  const { blob, fileName } = await makeTailoredPdf(cv, includeGradeSheet);
  downloadBlob(blob, fileName);
}

export async function downloadSavedCv(jobId) {
  const { response, data } = await apiRequest(`/api/jobs/${jobId}/tailoring`);

  if (!response.ok || !data.tailoring) {
    throw new Error(data.error || "Could not find the resume for this application.");
  }

  await downloadTailoredCv(data.tailoring.cv, data.tailoring.include_grade_sheet);
}
