const COLUMNS = [
  ["company", "Company"],
  ["position", "Position"],
  ["location", "Location"],
  ["workplace_model", "Workplace"],
  ["status", "Status"],
  ["applied_at", "Applied on"],
  ["job_url", "Job URL"],
  ["notes", "Notes"],
  ["created_at", "Added at"]
];

// Escapes a value for a CSV cell
export function cell(value) {
  let text = value == null ? "" : String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

// Downloads the applications as a CSV file
export function downloadApplicationsCsv(applications) {
  const lines = [
    COLUMNS.map(([, label]) => cell(label)).join(","),
    ...applications.map((application) => COLUMNS.map(([key]) => cell(application[key])).join(","))
  ];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `job-applications-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
