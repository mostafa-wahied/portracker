const { requestAutoxposeJson } = require("./autoxpose-http");

function validatePeerUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Peer URL must be an absolute HTTP or HTTPS URL"); }
  if (typeof value !== "string" || !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash || value.includes("\\") || [...value].some(character => character.charCodeAt(0) <= 32)) {
    throw new Error("Peer URL must use HTTP or HTTPS without credentials, query or fragment");
  }
  return url.href;
}

async function requestPeer(server, endpoint, options = {}) {
  validatePeerUrl(server.url);
  if (!endpoint.startsWith("/api/") || endpoint.startsWith("//") || endpoint.includes("#")) throw new Error("Invalid peer endpoint");
  const key = server.remote_api_key ? options.openKey(server) : null;
  try {
    const result = await requestAutoxposeJson(new URL(server.url).origin, endpoint, {
      timeoutMs: 15000, ...options, headers: key ? { "X-API-Key": key } : {},
    });
    return { ok: result.ok, status: result.status, json: async () => result.data, text: async () => "Peer request failed" };
  } catch {
    throw new Error("Peer request failed; verify its address, reachability, certificate and credential configuration");
  }
}

module.exports = { requestPeer, validatePeerUrl };