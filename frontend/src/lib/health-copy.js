export function humanizeProbeError(token) {
  if (!token || typeof token !== 'string') return token || null;

  if (token === 'timeout') return 'Connection timed out.';
  if (token === 'healthcheck-unhealthy') return 'Container reports unhealthy.';
  if (token === 'stale-completion') return 'Last finished too long ago to count as healthy.';
  if (token === 'docker-api-unavailable') return "Can't reach Docker.";
  if (token === 'inspect-failed') return "Couldn't inspect container.";
  if (token === 'send-failed' || token === 'send-threw') return "Couldn't send UDP packet.";
  if (token === 'no-valid-host-port') return 'No valid port to probe.';
  if (token === 'missing-container-id') return 'Container info missing.';
  if (token === 'unreachable') return 'Unreachable.';
  if (token === 'no-listener') return 'Nothing is listening inside the container.';

  const exit = token.match(/^exit-code-(-?\d+)$/);
  if (exit) return `Exited with error (code ${exit[1]}).`;

  const notExited = token.match(/^not-exited-(.+)$/);
  if (notExited) return `Container is ${notExited[1]}, not finished.`;

  const httpStatus = token.match(/^http-status-(5\d\d)$/);
  if (httpStatus) return `Answers with HTTP ${httpStatus[1]}.`;

  const closed = token.match(/^ports-closed-(\d+)$/);
  if (closed) return `${closed[1]} published port${closed[1] === '1' ? '' : 's'} not responding.`;

  return token;
}
