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

function overrideReason(role) {
  return `Marked as ${roleLabel(role)} by you.`;
}

function classify(signals, context) {
  const observed = signals || {};
  const supplied = context || {};
  if (Object.values(ROLES).includes(supplied.override)) {
    return result(supplied.override, 'override', overrideReason(supplied.override), 'R2');
  }
  if (observed.expectedCompletion === true) {
    return result(ROLES.JOB_EXPECTED_EXIT, 'high', 'Declared one-time setup task.', 'R6');
  }
  if (observed.isOnlyPublishedPort === true) {
    return result(ROLES.CORE_ACCESS, 'high', 'The only port this service publishes - treated as the main service.', 'R4');
  }
  return result(ROLES.UNKNOWN, 'low', "Component importance is not known. Set a role if needed.", 'R8');
}

module.exports = {
  classify,
  overrideReason,
  ROLES,
};
