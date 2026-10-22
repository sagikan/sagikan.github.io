export const MAX_CV_MB = 5;
export const MAX_GRADES_MB = 2;

export function checkPdf(file, maxMb) {
  if (!file) {
    return "Choose a file.";
  }

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return "Only PDF files are allowed.";
  }

  if (file.size > maxMb * 1024 * 1024) {
    return `The file must be ${maxMb} MB or smaller.`;
  }

  return "";
}
