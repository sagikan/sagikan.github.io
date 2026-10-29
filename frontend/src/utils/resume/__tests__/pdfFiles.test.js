import { describe, expect, it } from "vitest";
import { MAX_CV_MB, MAX_GRADES_MB, checkPdf } from "../pdfFiles";

// Builds a file stand-in with a name, type and size
function file(name, type, size = 1024) {
  return { name, type, size };
}

describe("checkPdf", () => {
  it("accepts a PDF within the limit", () => {
    expect(checkPdf(file("cv.pdf", "application/pdf"), MAX_CV_MB)).toBe("");
  });

  it("accepts a file named .pdf even when the browser gives no type", () => {
    expect(checkPdf(file("CV.PDF", ""), MAX_CV_MB)).toBe("");
  });

  it("accepts a PDF type under another extension", () => {
    expect(checkPdf(file("cv", "application/pdf"), MAX_CV_MB)).toBe("");
  });

  it("asks for a file when there is none", () => {
    expect(checkPdf(null, MAX_CV_MB)).toBe("Choose a file.");
  });

  it("rejects other file types", () => {
    expect(checkPdf(file("cv.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), MAX_CV_MB)).toBe("Only PDF files are allowed.");
  });

  it("accepts a file exactly at the size limit and rejects one byte over", () => {
    const limit = MAX_GRADES_MB * 1024 * 1024;

    expect(checkPdf(file("grades.pdf", "application/pdf", limit), MAX_GRADES_MB)).toBe("");
    expect(checkPdf(file("grades.pdf", "application/pdf", limit + 1), MAX_GRADES_MB)).toBe("The file must be 2 MB or smaller.");
  });
});
