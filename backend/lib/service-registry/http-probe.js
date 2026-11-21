'use strict';

const net = require('node:net');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { iconMime } = require('./http-store');
const { detectDockerGateway } = require('./http-gateway');

const trusted = new net.BlockList();
trusted.addSubnet('127.0.0.0', 8, 'ipv4');
trusted.addSubnet('10.0.0.0', 8, 'ipv4');
trusted.addSubnet('172.16.0.0', 12, 'ipv4');
trusted.addSubnet('192.168.0.0', 16, 'ipv4');
trusted.addAddress('::1', 'ipv6');
trusted.addSubnet('fc00::', 7, 'ipv6');

const MAX_HTML_BYTES = 256 * 1024;
const MAX_ICON_BYTES = 128 * 1024;
const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_ICON_ATTEMPTS = 5;
const MAX_PROBE_DURATION_MS = 8000;

function allowedHost(host) {
  const type = net.isIP(host);
  return Boolean(type && trusted.check(host, type === 4 ? 'ipv4' : 'ipv6'));
}

function readHttpMetadataConfig(env = process.env, dockerized = fs.existsSync('/.dockerenv'),
  discoverGateway = detectDockerGateway) {
  const value = env.SERVICE_REGISTRY_HTTP_ENABLED;
  if (value !== undefined && value !== 'true' && value !== 'false') {
    throw new TypeError('SERVICE_REGISTRY_HTTP_ENABLED must be true or false');
  }
  const requested = value !== 'false';
  const supplied = (env.SERVICE_REGISTRY_HTTP_HOST || '').trim();
  if (requested && supplied && (!allowedHost(supplied) || supplied.includes('%'))) {
    throw new TypeError('SERVICE_REGISTRY_HTTP_HOST must be a private/loopback IP literal');
  }
  const detected = requested && dockerized && !supplied ? discoverGateway() : null;
  // Never fall back to the container's loopback for host-side services.
  const host = supplied || (dockerized ? detected : '127.0.0.1');
  const validHost = Boolean(host && allowedHost(host));
  const enabled = requested && validHost;
  const mode = !requested ? 'disabled' : supplied ? 'explicit' :
    dockerized ? 'docker_gateway' : 'native_loopback';
  return {
    requested, enabled, host: enabled ? host : null, mode,
    missingHost: requested && !validHost,
    reason: !requested ? 'disabled_by_user' : !validHost ? 'gateway_unavailable' : null,
  };
}

function cleanText(value) {
  const noTags = String(value).replace(/<[^>]*>/g, ' ');
  const decoded = noTags.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,8}|amp|lt|gt|quot|apos|nbsp);/gi,
    (_whole, entity) => {
      const text = entity.toLowerCase();
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (named[text]) return named[text];
      const code = text.startsWith('#x') ? parseInt(text.slice(2), 16) : Number(text.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : '';
    });
  return Array.from(decoded, ch => ch.codePointAt(0) < 32 ? ' ' : ch)
    .join('').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function attribute(tag, key) {
  const re = new RegExp('(?:^|\\s)' + key + '\\s*=\\s*(?:"([^"]{0,2048})"|\\x27([^\\x27]{0,2048})\\x27|([^\\s>]{1,2048}))', 'i');
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function extractRootMetadata(html) {
  const titleMatch = /<title\b[^>]{0,100}>([\s\S]{0,4096}?)<\/title\s*>/i.exec(html);
  const title = titleMatch ? cleanText(titleMatch[1]) : '';
  let href = null;
  for (const m of html.matchAll(/<link\b[^>]{0,2048}>/gi)) {
    const rel = attribute(m[0], 'rel');
    if (!rel || !rel.toLowerCase().split(/\s+/).includes('icon')) continue;
    href = attribute(m[0], 'href');
    if (href) break;
  }
  return { title, iconHref: href ? cleanText(href) : null };
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// Only file-like icon URLs on the original literal-IP origin can be probed.
function extractIconHints(html) {
  const icons = [];
  let manifestHref = null;
  let scanned = 0;
  for (const match of html.matchAll(/<link\b[^>]{0,2048}>/gi)) {
    if (++scanned > 32) break;
    const rel = (attribute(match[0], 'rel') || '').toLowerCase().split(/\s+/);
    const href = attribute(match[0], 'href');
    if (!href) continue;
    if (rel.includes('manifest') && !manifestHref) manifestHref = cleanText(href);
    if (rel.includes('icon') || rel.includes('apple-touch-icon') ||
        rel.includes('apple-touch-icon-precomposed')) {
      if (icons.length < 12) icons.push(cleanText(href));
    }
  }
  return { icons, manifestHref };
}

function safeIconUrl(href, base, origin) {
  if (typeof href !== 'string' || !href || href.length > 2048) return null;
  try {
    const url = new URL(href, base);
    if (url.origin !== origin || url.username || url.password ||
        url.href.length > 2400 || url.pathname.length > 768 ||
        url.search.length > 512 || !['http:', 'https:'].includes(url.protocol)) return null;
    const filename = url.pathname.split('/').pop() || '';
    const raster = /\.(ico|png|jpe?g|gif|webp)$/i.test(filename);
    const extensionless = /(?:^|[-_.])(favicon|icon|logo|apple-touch)(?:[-_.]|$)/i.test(filename) &&
      !/\.[a-z0-9]{1,8}$/i.test(filename);
    if (!raster && !extensionless) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

function manifestIconHints(bytes) {
  try {
    const data = JSON.parse(bytes.toString('utf8'));
    if (!data || !Array.isArray(data.icons)) return [];
    return data.icons.slice(0, 16)
      .map(icon => icon && typeof icon.src === 'string' ? icon.src : null)
      .filter(Boolean);
  } catch { return []; }
}

/**
 * All requests use a literal IP in the URL. No DNS lookups, credentials,
 * cookies, proxy settings, cross-origin redirects, or JavaScript execution.
 */
async function requestBounded(initial, { maxBytes, timeoutMs = 2500, accept = '*/*' }) {
  const origin = initial.origin;
  const deadline = Date.now() + timeoutMs;
  let target = initial;
  for (let redirectCount = 0; redirectCount <= 2; redirectCount++) {
    if (target.origin !== origin || target.username || target.password ||
        !['http:', 'https:'].includes(target.protocol) ||
        target.href.length > 2400) throw fail('external_redirect');
    const remaining = deadline - Date.now();
    if (remaining < 1) throw fail('timeout');
    const response = await new Promise((resolve, reject) => {
      const transport = target.protocol === 'https:' ? https : http;
      const request = transport.request(target, {
        agent: false, method: 'GET', timeout: remaining,
        signal: AbortSignal.timeout(remaining),
        rejectUnauthorized: true,
        headers: {
          Accept: accept, 'User-Agent': 'Portracker-Metadata/1.0',
          'Accept-Encoding': 'identity', Connection: 'close',
        },
      }, incoming => {
        const code = incoming.statusCode || 0;
        const ct = String(incoming.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if ([301, 302, 303, 307, 308].includes(code)) {
          incoming.resume();
          resolve({ code, location: incoming.headers.location, contentType: ct });
          return;
        }
        if (Number(incoming.headers['content-length']) > maxBytes) {
          reject(fail('too_large'));
          incoming.destroy();
          return;
        }
        const chunks = [];
        let size = 0;
        incoming.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) {
            reject(fail('too_large'));
            incoming.destroy();
          } else chunks.push(chunk);
        });
        incoming.once('error', () => reject(fail('network_error')));
        incoming.once('aborted', () => reject(fail('network_error')));
        incoming.once('end', () => resolve({ code, contentType: ct, bytes: Buffer.concat(chunks) }));
      });
      request.on('error', error => reject(error.code === 'ABORT_ERR'
        ? fail('timeout')
        : error.code === 'CERT_HAS_EXPIRED' || error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
          error.code === 'SELF_SIGNED_CERT_IN_CHAIN' || error.code === 'ERR_TLS_CERT_ALTNAME_INVALID'
          ? fail('tls_untrusted') : fail('network_error')));
      request.on('timeout', () => request.destroy(fail('timeout')));
      request.end();
    });
    if (!response.location) return { ...response, finalUrl: target };
    if (redirectCount === 2 || typeof response.location !== 'string' ||
        response.location.length > 2048) throw fail('external_redirect');
    const next = new URL(response.location, target);
    if (next.origin !== origin || next.username || next.password) throw fail('external_redirect');
    target = next;
  }
  throw fail('external_redirect');
}

async function probeWebMetadata({ host, port, timeoutMs = 2500 }) {
  if (!allowedHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw fail('blocked_target');
  }
  const bracketed = net.isIP(host) === 6 ? '[' + host + ']' : host;
  const scheme = [443, 8443, 9443, 10443].includes(port) ? 'https' : 'http';
  const rootUrl = new URL(scheme + '://' + bracketed + ':' + port + '/');
  const deadline = Date.now() + MAX_PROBE_DURATION_MS;
  async function bounded(url, maxBytes, accept) {
    const remaining = deadline - Date.now();
    if (remaining < 1) throw fail('timeout');
    return requestBounded(url, { maxBytes, timeoutMs: Math.min(timeoutMs, remaining), accept });
  }

  const page = await bounded(rootUrl, MAX_HTML_BYTES, 'text/html,application/xhtml+xml');
  const html = page.code === 200 &&
    ['text/html', 'application/xhtml+xml'].includes(page.contentType);
  const text = html ? page.bytes.toString('utf8') : '';
  const { title } = extractRootMetadata(text);
  const hints = extractIconHints(text);
  const candidates = [];
  const seen = new Set();
  function addIcon(href, base) {
    const url = safeIconUrl(href, base, rootUrl.origin);
    if (url && !seen.has(url.href)) {
      seen.add(url.href);
      candidates.push(url);
    }
  }

  let iconBytes = null;
  let iconType = null;
  let attempted = 0;
  let cursor = 0;
  async function tryCandidates() {
    while (!iconBytes && cursor < candidates.length && attempted < MAX_ICON_ATTEMPTS &&
        Date.now() < deadline) {
      const icon = candidates[cursor++];
      attempted++;
      try {
        const result = await bounded(icon, MAX_ICON_BYTES,
          'image/png,image/jpeg,image/gif,image/webp,image/x-icon,image/vnd.microsoft.icon');
        if (result.code !== 200) continue;
        const detected = iconMime(result.bytes);
        const declared = result.contentType;
        // Opaque or missing MIME is accepted only with verified raster magic bytes.
        if (detected && (declared === detected ||
            (detected === 'image/x-icon' && declared === 'image/vnd.microsoft.icon') ||
            declared === 'application/octet-stream' || !declared)) {
          iconBytes = result.bytes;
          iconType = detected;
        }
      } catch { /* Failed icons never change listener state or remove cached metadata. */ }
    }
  }

  // Avoid an unnecessary manifest request when the HTML already supplies a working favicon.
  for (const href of hints.icons) addIcon(href, page.finalUrl);
  await tryCandidates();
  if (!iconBytes && hints.manifestHref && attempted < MAX_ICON_ATTEMPTS) {
    try {
      const manifest = new URL(hints.manifestHref, page.finalUrl);
      if (manifest.origin === rootUrl.origin && !manifest.username && !manifest.password &&
          manifest.href.length <= 2400 && manifest.pathname.length <= 768 &&
          /\.(webmanifest|json)$/i.test(manifest.pathname)) {
        const result = await bounded(manifest, MAX_MANIFEST_BYTES,
          'application/manifest+json,application/json');
        if (result.code === 200 &&
            ['application/manifest+json', 'application/json'].includes(result.contentType)) {
          for (const href of manifestIconHints(result.bytes)) addIcon(href, result.finalUrl);
          await tryCandidates();
        }
      }
    } catch { /* Invalid or unavailable manifest does not prevent default icon paths. */ }
  }
  if (!iconBytes) {
    for (const href of ['/favicon.ico', '/favicon.png', '/apple-touch-icon.png', '/icon.png']) {
      addIcon(href, rootUrl);
    }
    await tryCandidates();
  }
  if (!title && !iconBytes) throw fail(html ? 'no_metadata' : 'not_html');
  return { title, rootUrl: rootUrl.href, iconBytes, iconType };
}

module.exports = {
  allowedHost, readHttpMetadataConfig, extractRootMetadata,
  probeWebMetadata, requestBounded, extractIconHints, safeIconUrl,
};
