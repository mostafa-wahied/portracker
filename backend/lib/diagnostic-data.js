const omitted = new Set(["env", "environment", "command", "cmd", "args", "entrypoint", "healthcheck", "containerconfig", "logconfig"]);
const labels = new Set(["com.docker.compose.project", "com.docker.compose.service", "com.docker.compose.container-number", "com.docker.compose.version"]);
const originalFields = new Set(["id", "name", "memory", "vcpus", "cpu", "status", "autostart"]);
const safeErrors = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN",
  "timeout", "healthcheck-unhealthy", "stale-completion", "docker-api-unavailable", "inspect-failed",
  "send-failed", "send-threw", "no-valid-host-port", "missing-container-id", "unreachable",
  "Peer response exceeds PEER_MAX_RESPONSE_BYTES; increase this byte limit for a trusted larger inventory",
  "PEER_MAX_RESPONSE_BYTES must be a positive integer byte limit",
  "Sign in on the remote server to view raw diagnostics.",
]);

function diagnosticError(error) {
  if (!error || safeErrors.has(error)) return error;
  if (typeof error === "string" && (/^exit-code--?\d{1,10}$/.test(error) ||
      /^not-exited-(created|running|paused|restarting|removing|exited|dead)$/.test(error))) return error;
  return "Diagnostic operation failed";
}

function redactDiagnosticData(value, depth = 0) {
  if (depth > 32) return null;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(item => redactDiagnosticData(item, depth + 1));
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const lower = key.toLowerCase();
    if (omitted.has(lower) || /password|passwd|secret|token|api[_-]?key|credential|private[_-]?key/.test(lower)) return [];
    if (lower === "labels") return [[key, Object.fromEntries(Object.entries(entry || {}).filter(([name]) => labels.has(name)))]];
    if (lower === "orig_data") entry = Object.fromEntries(Object.entries(entry || {}).filter(([name]) => originalFields.has(name)));
    if (lower === "health" && entry && typeof entry === "object") entry = { Status: entry.Status, FailingStreak: entry.FailingStreak };
    if (lower === "error") return [[key, diagnosticError(entry)]];
    return [[key, redactDiagnosticData(entry, depth + 1)]];
  }));
}

function sanitizeDiagnosticResponses(_request, response, next) {
  const json = response.json;
  response.json = function (body) { return json.call(this, redactDiagnosticData(body)); };
  next();
}

module.exports = { redactDiagnosticData, sanitizeDiagnosticResponses };