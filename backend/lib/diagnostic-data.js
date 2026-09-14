const omitted = new Set(["env", "environment", "command", "cmd", "args", "entrypoint", "healthcheck", "containerconfig", "logconfig"]);
const labels = new Set(["com.docker.compose.project", "com.docker.compose.service", "com.docker.compose.container-number", "com.docker.compose.version"]);
const originalFields = new Set(["id", "name", "memory", "vcpus", "cpu", "status", "autostart"]);

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
    if (lower === "error") return [[key, entry ? "Diagnostic operation failed" : entry]];
    return [[key, redactDiagnosticData(entry, depth + 1)]];
  }));
}

function sanitizeDiagnosticResponses(request, response, next) {
  if (/^\/(?:ports|all-ports|services)(?:\/|$)|^\/servers\/[^/]+\/scan$|^\/containers\/[^/]+\/details$/.test(request.path)) {
    const json = response.json;
    response.json = function (body) { return json.call(this, redactDiagnosticData(body)); };
  }
  next();
}

module.exports = { redactDiagnosticData, sanitizeDiagnosticResponses };