'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'image/x-icon', 'image/vnd.microsoft.icon',
]);
const MAX_ICON_BYTES = 128 * 1024;
const MAX_CACHED_ICONS = 128;

function iconMime(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 6 || bytes.length > MAX_ICON_BYTES) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    return 'image/x-icon';
  }
  return null;
}

function verifiedRootUrl(value) {
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return ['http:', 'https:'].includes(url.protocol) && net.isIP(host) > 0 &&
      !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash &&
      Number(url.port || (url.protocol === 'https:' ? 443 : 80)) >= 1;
  } catch { return false; }
}

function createHttpMetadataStore(db) {
  // Conservative best-effort web classification avoids sending HTTP GETs to
  // obvious SSH/database/message-queue ports while covering normal dev UIs.
  const likelyWeb = alias =>
    '(' + alias + '.host_port IN (80,81,443,800,8080,8081,8443,8888,9090,9443,10000,54321) ' +
    'OR ' + alias + '.host_port BETWEEN 3000 AND 5999 ' +
    'OR ' + alias + '.host_port BETWEEN 8000 AND 9999) ' +
    'AND ' + alias + '.host_port NOT IN (3306,5432,5433,5672,6379,9092)';
  const candidates = db.prepare(
    'SELECT s.id AS service_id, ' +
    '(SELECT e.host_port FROM registry_endpoints e WHERE e.service_id = s.id ' +
    "AND e.protocol = 'tcp' AND e.internal = 0 AND " + likelyWeb('e') +
    ' ORDER BY e.last_seen_at DESC, e.id LIMIT 1) AS host_port ' +
    'FROM registry_services s LEFT JOIN registry_http_metadata m ON m.service_id = s.id ' +
    "WHERE s.server_id = 'local' AND s.status = 'listening' AND " +
    "EXISTS (SELECT 1 FROM registry_endpoints ep WHERE ep.service_id = s.id " +
    "AND ep.protocol = 'tcp' AND ep.internal = 0 AND " + likelyWeb('ep') + ') AND ' +
    '(m.last_attempt_at IS NULL OR m.last_attempt_at <= ?) AND ' +
    '(m.fetched_at IS NULL OR m.fetched_at <= ?) ' +
    'ORDER BY s.last_seen_at DESC, s.id LIMIT ?'
  );

  const getSummary = db.prepare(
    'SELECT title, visit_url, icon_hash, fetched_at FROM registry_http_metadata WHERE service_id = ?'
  );
  const getCachedIcon = db.prepare('SELECT mime, bytes FROM registry_icons WHERE hash = ?');
  const saveAttempt = db.prepare(
    'INSERT INTO registry_http_metadata (service_id, last_attempt_at, error_code) ' +
    'VALUES (?, ?, ?) ON CONFLICT(service_id) DO UPDATE SET ' +
    'last_attempt_at = MAX(last_attempt_at, excluded.last_attempt_at), ' +
    'error_code = excluded.error_code'
  );
  const saveSuccess = db.prepare(
    'INSERT INTO registry_http_metadata ' +
    '(service_id, title, visit_url, icon_hash, fetched_at, last_attempt_at, error_code) ' +
    'VALUES (?, ?, ?, ?, ?, ?, NULL) ' +
    'ON CONFLICT(service_id) DO UPDATE SET ' +
    'title = COALESCE(NULLIF(excluded.title, \'\'), registry_http_metadata.title), ' +
    'visit_url = excluded.visit_url, ' +
    'icon_hash = COALESCE(excluded.icon_hash, registry_http_metadata.icon_hash), ' +
    'fetched_at = excluded.fetched_at, last_attempt_at = excluded.last_attempt_at, error_code = NULL'
  );

  function getCandidates({ at = Date.now(), limit = 4, ttlMs = 86400000, retryMs = 300000 } = {}) {
    if (!Number.isSafeInteger(at) || !Number.isInteger(limit) || limit < 1 || limit > 16) {
      throw new TypeError('Invalid metadata scan bounds');
    }
    return candidates.all(at - retryMs, at - ttlMs, limit)
      .filter(row => Number.isInteger(row.host_port) && row.host_port >= 1);
  }

  function getMetadata(serviceId) {
    const row = getSummary.get(serviceId);
    if (!row) return null;
    return {
      httpTitle: row.title,
      httpRootUrl: row.visit_url,
      iconHash: row.icon_hash,
      metadataFetchedAt: row.fetched_at,
    };
  }

  function recordFailure(serviceId, at, code) {
    if (!/^[a-z][a-z_]{0,49}$/.test(code)) throw new TypeError('Invalid failure category');
    saveAttempt.run(serviceId, at, code);
  }

  const recordSuccess = db.transaction((serviceId, { title, rootUrl, iconBytes, iconType }, at) => {
    if (!verifiedRootUrl(rootUrl)) throw new TypeError('Unverified metadata URL');
    const safeTitle = typeof title === 'string' ?
      Array.from(title, ch => ch.codePointAt(0) < 32 ? ' ' : ch).join('').trim().slice(0, 180) : '';
    let iconHash = null;
    const actualMime = iconMime(iconBytes);
    if (actualMime && ALLOWED_MIME.has(iconType) &&
        (actualMime === iconType || (actualMime === 'image/x-icon' &&
          iconType === 'image/vnd.microsoft.icon'))) {
      iconHash = crypto.createHash('sha256').update(iconBytes).digest('hex');
      const exists = getCachedIcon.get(iconHash);
      if (!exists) {
        // Evict only unreferenced images, never history or referenced icons.
        db.prepare('DELETE FROM registry_icons WHERE hash NOT IN ' +
          '(SELECT icon_hash FROM registry_http_metadata WHERE icon_hash IS NOT NULL)').run();
        if (db.prepare('SELECT COUNT(*) AS total FROM registry_icons').get().total < MAX_CACHED_ICONS) {
          db.prepare('INSERT INTO registry_icons (hash, mime, bytes, created_at) VALUES (?, ?, ?, ?)')
            .run(iconHash, actualMime, iconBytes, at);
        } else iconHash = null;
      }
    }
    saveSuccess.run(serviceId, safeTitle, rootUrl, iconHash, at, at);
    return getMetadata(serviceId);
  });

  function getIcon(hash) {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return null;
    return getCachedIcon.get(hash) || null;
  }

  return { getCandidates, getMetadata, recordFailure, recordSuccess, getIcon };
}

module.exports = { createHttpMetadataStore, iconMime, verifiedRootUrl };
