const STORAGE_KEY = 'portracker_nudge_state';

const COMMONLY_EXPOSED_SERVICES = [
  'vaultwarden',
  'bitwarden',
  'nextcloud',
  'immich',
  'paperless',
  'home-assistant',
  'homeassistant',
  'frigate',
  'plex',
  'jellyfin',
  'emby',
  'gitea',
  'gitlab',
  'code-server',
  'element',
  'syncthing',
  'photoprism',
  'mealie',
  'calibre-web'
];

const MAX_NUDGES = 3;
const INTERVALS_MS = [0, 30 * 24 * 60 * 60 * 1000, 90 * 24 * 60 * 60 * 1000];

function getNudgeState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { count: 0, lastShown: 0 };
    return JSON.parse(stored);
  } catch {
    return { count: 0, lastShown: 0 };
  }
}

function setNudgeState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
  }
}

export function shouldShowNudge() {
  const state = getNudgeState();
  if (state.count >= MAX_NUDGES) return false;

  const requiredInterval = INTERVALS_MS[state.count] || 0;
  const elapsed = Date.now() - state.lastShown;
  return elapsed >= requiredInterval;
}

export function markNudgeDismissed() {
  const state = getNudgeState();
  setNudgeState({
    count: state.count + 1,
    lastShown: Date.now()
  });
}

function normalizeServiceName(name) {
  return (name || '').toLowerCase().replace(/[_\s]/g, '-');
}

function matchesService(serviceName) {
  for (const target of COMMONLY_EXPOSED_SERVICES) {
    if (serviceName.includes(target)) {
      return target;
    }
  }
  return null;
}

export function findEligibleService(servers) {
  if (!servers?.length) return null;

  for (const server of servers) {
    const ports = server.data || server.ports || [];
    for (const port of ports) {
      const rawName = port.customServiceName || port.originalServiceName || port.owner;
      const serviceName = normalizeServiceName(rawName);
      const matched = matchesService(serviceName);
      if (matched) {
        return {
          name: rawName,
          displayName: formatDisplayName(matched)
        };
      }
    }
  }
  return null;
}

function formatDisplayName(name) {
  if (!name) return '';
  const normalized = name.replace(/[-_]/g, ' ');
  return normalized
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
