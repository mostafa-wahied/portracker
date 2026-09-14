const { requestAutoxposeJson } = require("./autoxpose-http");
const DEFAULT_PEER_RESPONSE_BYTES = 8 * 1024 * 1024;

function peerResponseLimit() {
  const configured = process.env.PEER_MAX_RESPONSE_BYTES;
  if (configured === undefined) return DEFAULT_PEER_RESPONSE_BYTES;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("PEER_MAX_RESPONSE_BYTES must be a positive integer byte limit");
  return value;
}

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
  const maxResponseBytes = peerResponseLimit();
  try {
    const result = await requestAutoxposeJson(new URL(server.url).origin, endpoint, {
      timeoutMs: 15000, maxResponseBytes, ...options, headers: key ? { "X-API-Key": key } : {},
    });
    return { ok: result.ok, status: result.status, json: async () => result.data, text: async () => "Peer request failed" };
  } catch (error) {
    if (error.code === "RESPONSE_TOO_LARGE") {
      const failure = new Error("Peer response exceeds PEER_MAX_RESPONSE_BYTES; increase this byte limit for a trusted larger inventory");
      failure.code = "PEER_RESPONSE_TOO_LARGE";
      throw failure;
    }
    throw new Error("Peer request failed; verify its address, reachability, certificate and credential configuration");
  }
}

module.exports = { requestPeer, validatePeerUrl };