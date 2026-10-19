const API_URL = import.meta.env.VITE_API_URL;

export const STATUSES = ["Applied", "Interview", "Offer", "Rejected", "Withdrawn"];

export const WORKPLACE_MODELS = ["On-site", "Hybrid", "Remote"];

export async function checkHealth() {
  const response = await fetch(`${API_URL}/api/health`);

  if (!response.ok) {
    throw new Error("API request failed");
  }

  return response.json();
}

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

export function toDateInput(value) {
  return value ? String(value).slice(0, 10) : "";
}

export function localISO(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function jobDay(job) {
  return toDateInput(job.applied_at) || (job.created_at ? localISO(new Date(job.created_at)) : "");
}

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
