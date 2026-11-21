'use strict';

// Deliberately return only stable capability labels and timestamps: neither
// Docker socket URLs nor host network routes or probe error messages are safe
// to reflect to an authenticated browser.
function readDiscoveryCapabilities({ scanEnabled = false, scanSources = [],
  http = {}, httpWorker = null, dockerHost = null } = {}) {
  const docker = scanSources.find(source => source.source === 'docker');
  const lastHttp = httpWorker?.getStatus?.() || {};
  const dockerMode = dockerHost === 'tcp://docker-api-proxy:2375' ? 'restricted_proxy' :
    dockerHost ? 'custom_endpoint' : 'local_socket';
  const dockerReason = !scanEnabled ? 'registry_disabled' : !docker ?
    'awaiting_first_scan' : docker.outcome === 'complete' ? null :
      docker.outcome === 'partial' ? 'untrusted_scan_scope' : 'docker_api_unavailable';
  const httpReady = scanEnabled && Boolean(http.enabled);
  return {
    http: {
      requested: Boolean(http.requested), configured: httpReady,
      available: lastHttp.lastSuccessAt ? true :
        lastHttp.lastAttemptAt ? false : null,
      mode: http.mode || 'unknown',
      reason: !scanEnabled ? 'registry_disabled' : http.reason || null,
      lastAttemptAt: lastHttp.lastAttemptAt || null,
      lastSuccessAt: lastHttp.lastSuccessAt || null,
      lastIconSuccessAt: lastHttp.lastIconSuccessAt || null,
      lastFailureCode: lastHttp.lastFailureCode || null,
    },
    docker: {
      requested: Boolean(scanEnabled), configured: Boolean(scanEnabled),
      available: docker?.outcome === 'complete', mode: dockerMode,
      reason: dockerReason,
      lastAttemptAt: docker?.lastAttemptAt || null,
      lastSuccessAt: docker?.lastSuccessAt || null,
    },
  };
}

module.exports = { readDiscoveryCapabilities };
