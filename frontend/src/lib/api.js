export const API_URL = import.meta.env.VITE_API_URL;
export const STATUSES = ["Applied", "Interview", "Offer", "Rejected", "Withdrawn"];
export const WORKPLACE_MODELS = ["On-site", "Hybrid", "Remote"];

// Checks that the API is up
export async function checkHealth() {
  const response = await fetch(`${API_URL}/api/health`);

  if (!response.ok) {
    throw new Error("API request failed");
  }

  return response.json();
}

// Sends a JSON request and returns the response and data
export async function apiRequest(path, { method = "GET", body, csrfToken } = {}) {
  const headers = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));

  return { response, data };
}

// Uploads a file as the request body
export async function apiUpload(path, file, { csrfToken, method = "PUT" } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/pdf",
      "X-CSRF-Token": csrfToken,
      "X-File-Name": encodeURIComponent(file.name)
    },
    body: file
  });
  const data = await response.json().catch(() => ({}));

  return { response, data };
}

// Downloads a file and returns its bytes and name
export async function apiFile(path) {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include" });

  if (!response.ok) {
    return null;
  }

  let fileName;

  try {
    fileName = decodeURIComponent(response.headers.get("X-File-Name") || "");
  } catch {
    fileName = "";
  }

  return { bytes: new Uint8Array(await response.arrayBuffer()), fileName };
}

// Turns a date value into YYYY-MM-DD
export function toDateInput(value) {
  return value ? String(value).slice(0, 10) : "";
}

// Formats a date as a local YYYY-MM-DD
export function localISO(date) {
  // Pads a number to two digits
  const pad = (n) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Returns the day an application was made
export function jobDay(job) {
  return toDateInput(job.applied_at) || (job.created_at ? localISO(new Date(job.created_at)) : "");
}

// Formats a date for display
export function formatDate(value) {
  const date = toDateInput(value);

  if (!date) {
    return "";
  }

  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}
