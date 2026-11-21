export const PAGE_SIZE = 24;

export const STATUS_LABELS = Object.freeze({
  listening: "Listening",
  offline: "Offline",
  unknown: "Unknown",
});

export function parseRegistryPortFilter(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

export function registryPageCount(total, pageSize = PAGE_SIZE) {
  return Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / pageSize));
}

export function registryTimestamp(timestamp) {
  if (!Number.isFinite(Number(timestamp)) || timestamp === null) return "Unknown";
  const date = new Date(Number(timestamp));
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

export function registryStatusLabel(status) {
  return STATUS_LABELS[status] || "Unknown";
}
