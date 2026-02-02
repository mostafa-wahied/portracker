const API_BASE = "/api/autoxpose";

export async function getAutoxposeStatus() {
  const res = await fetch(`${API_BASE}/status`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch status: ${res.status}`);
  }
  return res.json();
}

export async function connectAutoxpose(url) {
  const res = await fetch(`${API_BASE}/connect`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { success: false, error: data.error || `HTTP ${res.status}` };
  }
  return res.json();
}

export async function disconnectAutoxpose() {
  const res = await fetch(`${API_BASE}/disconnect`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to disconnect: ${res.status}`);
  }
  return res.json();
}

export async function setAutoxposeDisplayMode(mode) {
  const res = await fetch(`${API_BASE}/display-mode`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    throw new Error(`Failed to set display mode: ${res.status}`);
  }
  return res.json();
}

export async function setAutoxposeUrlStyle(style) {
  const res = await fetch(`${API_BASE}/url-style`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ style }),
  });
  if (!res.ok) {
    throw new Error(`Failed to set URL style: ${res.status}`);
  }
  return res.json();
}

export async function getAutoxposeServices() {
  const res = await fetch(`${API_BASE}/services`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch services: ${res.status}`);
  }
  return res.json();
}

export async function getAutoxposeDomain() {
  const res = await fetch(`${API_BASE}/domain`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch domain: ${res.status}`);
  }
  return res.json();
}
