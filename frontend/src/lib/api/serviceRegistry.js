const BASE = "/api/service-registry";

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `History request failed (HTTP ${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export function getRegistryServices(filters = {}, signal) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== "" && value !== null && value !== undefined) {
      query.set(key, String(value));
    }
  }
  return request(`${BASE}?${query.toString()}`, { signal });
}

export function getRegistryService(id, signal) {
  return request(`${BASE}/${encodeURIComponent(id)}`, { signal });
}

export function getRegistryScanStatus(signal) {
  return request(`${BASE}/scan-status`, { signal });
}

export function scanRegistryNow() {
  return request(`${BASE}/scan`, { method: "POST" });
}

export function forgetRegistryService(id) {
  return request(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function saveRegistryPreferredStart(id, command, cwd, version) {
  return request(`${BASE}/${encodeURIComponent(id)}/recovery-start`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, cwd, version }),
  });
}

export function saveRegistryRecoveryNotes(id, notes, version) {
  return request(`${BASE}/${encodeURIComponent(id)}/recovery-notes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes, version }),
  });
}
