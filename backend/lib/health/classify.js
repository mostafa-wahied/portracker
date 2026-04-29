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

function classify(signals, context) {
  const s = signals || {};
  const ctx = context || {};

  if (ctx.override && typeof ctx.override === 'string') {
    return result(ctx.override, 'override', 'user override', 'R2');
  }

  if (s.hasHealthcheck && s.healthcheckStatus) {
    const hs = String(s.healthcheckStatus).toLowerCase();
    if (hs === 'healthy') {
      return result(ROLES.CORE_ACCESS, 'high', 'container reports healthy', 'R1');
    }
    if (hs === 'unhealthy') {
      return result(ROLES.CORE_ACCESS, 'high', 'container reports unhealthy', 'R1');
    }
    if (hs === 'starting') {
      return result(ROLES.CORE_ACCESS, 'medium', 'container is still starting', 'R1');
    }
  }

  const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
  if (s.composeService && deps.length > 0 && Array.isArray(ctx.siblingServices) && ctx.siblingServices.length > 0) {
    const isDependency = ctx.siblingServices.some((sib) => deps.includes(sib));
    if (isDependency) {
      return result(ROLES.SUPPORT, 'medium', `${s.composeService} is depended on by siblings; treat as support`, 'R3');
    }
  }
  if (ctx.siblingDependsOnUs === true) {
    return result(ROLES.SUPPORT, 'medium', 'compose depends_on: other services depend on this one', 'R3');
  }

  if (s.isOnlyPublishedPort === true) {
    return result(ROLES.CORE_ACCESS, 'high', 'only published port of the service', 'R4');
  }

  const proto = String(s.protocol || '').toLowerCase();
  const bound = String(s.boundTo || '').toLowerCase();
  if (proto === 'udp' && ctx.serviceHasHttpResponder === true) {
    return result(ROLES.SUPPORT, 'medium', 'UDP port alongside an HTTP-responding sibling port', 'R5');
  }
  if (bound === 'loopback') {
    return result(ROLES.SUPPORT, 'medium', 'bound to loopback only; not user-facing', 'R5');
  }

  const restart = String(s.restartPolicy || 'no').toLowerCase();
  if (s.containerState === 'exited' && s.exitCode === 0 && (restart === 'no' || restart === 'on-failure')) {
    return result(ROLES.JOB_EXPECTED_EXIT, 'medium', 'container exited 0 with non-always restart policy', 'R6');
  }

  const hints = s.imageHints || {};
  if (hints.isExporterLike) {
    return result(ROLES.SUPPORT, 'low', 'image name hints exporter/metrics/sidecar', 'R7');
  }
  if (hints.isProxyLike && s.isOnlyPublishedPort === true) {
    return result(ROLES.CORE_ACCESS, 'low', 'image name hints proxy and is sole published port', 'R7');
  }

  return result(ROLES.UNKNOWN, 'low', 'no matching rule; user override recommended', 'R8');
}

module.exports = {
  classify,
  ROLES,
};
