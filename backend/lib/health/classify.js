'use strict';

const ROLES = Object.freeze({
  CORE_RUNTIME: 'core_runtime',
  CORE_ACCESS: 'core_access',
  SUPPORT: 'support',
  JOB_EXPECTED_EXIT: 'job_expected_exit',
  UNKNOWN: 'unknown',
});

function result(role, confidence, reason, ruleId) {
  return { role, confidence, reason, ruleId };
}

const ROLE_LABELS = {
  [ROLES.CORE_RUNTIME]: 'main service',
  [ROLES.CORE_ACCESS]: 'main service',
  [ROLES.SUPPORT]: 'helper',
  [ROLES.JOB_EXPECTED_EXIT]: 'finished job',
  [ROLES.UNKNOWN]: 'unknown',
};

function roleLabel(role) {
  return ROLE_LABELS[role] || 'unknown';
}

function classify(signals, context) {
  const s = signals || {};
  const ctx = context || {};

  if (ctx.override && typeof ctx.override === 'string') {
    return result(ctx.override, 'override', `Marked as ${roleLabel(ctx.override)} by you.`, 'R2');
  }

  if (s.hasHealthcheck && s.healthcheckStatus && s.containerState === 'running') {
    const hs = String(s.healthcheckStatus).toLowerCase();
    if (hs === 'healthy') {
      return result(ROLES.CORE_ACCESS, 'high', 'Container is healthy.', 'R1');
    }
    if (hs === 'unhealthy') {
      return result(ROLES.CORE_ACCESS, 'high', 'Container is unhealthy.', 'R1');
    }
    if (hs === 'starting') {
      return result(ROLES.CORE_ACCESS, 'medium', 'Container is still starting.', 'R1');
    }
  }
  if (s.hasHealthcheck && s.containerState === 'created') {
    return result(ROLES.CORE_ACCESS, 'high', 'Container has not started.', 'R1');
  }
  if (s.hasHealthcheck && s.containerState === 'restarting') {
    return result(ROLES.CORE_ACCESS, 'medium', 'Container is restarting.', 'R1');
  }
  if (s.hasHealthcheck && s.containerState === 'exited') {
    const restart = String(s.restartPolicy || 'no').toLowerCase();
    if (s.exitCode === 0 && (restart === 'no' || restart === 'on-failure')) {
      return result(ROLES.JOB_EXPECTED_EXIT, 'medium', 'Finished cleanly (exit 0); no auto-restart configured.', 'R6');
    }
    return result(ROLES.CORE_ACCESS, 'high', 'Container has exited.', 'R1');
  }
  if (s.hasHealthcheck && s.containerState === 'dead') {
    return result(ROLES.CORE_ACCESS, 'high', 'Container is dead.', 'R1');
  }

  const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
  if (s.composeService && deps.length > 0 && Array.isArray(ctx.siblingServices) && ctx.siblingServices.length > 0) {
    const isDependency = ctx.siblingServices.some((sib) => deps.includes(sib));
    if (isDependency) {
      return result(ROLES.SUPPORT, 'medium', 'Other compose services depend on this one — treated as a helper.', 'R3');
    }
  }
  if (ctx.siblingDependsOnUs === true) {
    return result(ROLES.SUPPORT, 'medium', 'Other compose services depend on this one — treated as a helper.', 'R3');
  }

  if (s.isOnlyPublishedPort === true) {
    return result(ROLES.CORE_ACCESS, 'high', 'The only port this service publishes — treated as the main service.', 'R4');
  }

  const proto = String(s.protocol || '').toLowerCase();
  const bound = String(s.boundTo || '').toLowerCase();
  if (proto === 'udp' && ctx.serviceHasHttpResponder === true) {
    return result(ROLES.SUPPORT, 'medium', "UDP port alongside the service's HTTP port — treated as a helper.", 'R5');
  }
  if (bound === 'loopback') {
    return result(ROLES.SUPPORT, 'medium', 'Only listens on 127.0.0.1 — treated as a helper.', 'R5');
  }

  const restart = String(s.restartPolicy || 'no').toLowerCase();
  if (s.containerState === 'exited' && s.exitCode === 0 && (restart === 'no' || restart === 'on-failure')) {
    return result(ROLES.JOB_EXPECTED_EXIT, 'medium', 'Finished cleanly (exit 0); no auto-restart configured.', 'R6');
  }

  const hints = s.imageHints || {};
  if (hints.isExporterLike) {
    return result(ROLES.SUPPORT, 'low', 'Image name suggests a metrics or sidecar helper.', 'R7');
  }
  if (hints.isProxyLike && s.isOnlyPublishedPort === true) {
    return result(ROLES.CORE_ACCESS, 'low', 'Image name suggests a proxy, and this is the only published port — treated as the main service.', 'R7');
  }

  return result(ROLES.UNKNOWN, 'low', "Couldn't tell if this is a main service or a helper. Use the dropdown to set it.", 'R8');
}

module.exports = {
  classify,
  ROLES,
};
