'use strict';

const http = require('node:http');
const { describe, expect, test } = require('@jest/globals');
const {
  allowedHost, readHttpMetadataConfig, extractRootMetadata, probeWebMetadata,
} = require('./http-probe');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WkW3+IAAAAASUVORK5CYII=',
  'base64'
);

async function withHttpServer(listener, run) {
  const server = http.createServer(listener);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try { return await run(server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

describe('explicit local-host probe policy', () => {
  test('permits only literal loopback/private IPs, never metadata or global addresses', () => {
    for (const host of ['127.0.0.1', '10.1.2.3', '172.17.0.1', '192.168.1.1', '::1', 'fd00::1']) {
      expect(allowedHost(host)).toBe(true);
    }
    for (const host of ['localhost', 'example.com', '8.8.8.8', '169.254.169.254',
      '0.0.0.0', '224.0.0.1', '::', 'fe80::1']) {
      expect(allowedHost(host)).toBe(false);
    }
  });

  test('HTTP enrichment defaults on, selects safe private gateway, and degrades gracefully', () => {
    expect(readHttpMetadataConfig({}, false)).toMatchObject({
      requested: true, enabled: true, host: '127.0.0.1', mode: 'native_loopback',
      missingHost: false, reason: null,
    });
    expect(readHttpMetadataConfig({}, true, () => '172.18.0.1')).toMatchObject({
      requested: true, enabled: true, host: '172.18.0.1', mode: 'docker_gateway',
      missingHost: false,
    });
    expect(readHttpMetadataConfig({}, true, () => null)).toMatchObject({
      requested: true, enabled: false, host: null, missingHost: true,
      reason: 'gateway_unavailable',
    });
    expect(readHttpMetadataConfig({}, true, () => '8.8.8.8')).toMatchObject({
      requested: true, enabled: false, host: null, missingHost: true,
      reason: 'gateway_unavailable',
    });
    expect(readHttpMetadataConfig({
      SERVICE_REGISTRY_HTTP_ENABLED: 'true', SERVICE_REGISTRY_HTTP_HOST: '172.17.0.1',
    }, true, () => { throw new Error('auto-detect must not run'); })).toMatchObject({
      enabled: true, host: '172.17.0.1', mode: 'explicit',
    });
    expect(readHttpMetadataConfig({
      SERVICE_REGISTRY_HTTP_ENABLED: 'false',
      SERVICE_REGISTRY_HTTP_HOST: '169.254.169.254',
    }, true)).toMatchObject({ requested: false, enabled: false, host: null,
      reason: 'disabled_by_user' });
    expect(() => readHttpMetadataConfig({
      SERVICE_REGISTRY_HTTP_ENABLED: 'true', SERVICE_REGISTRY_HTTP_HOST: '169.254.169.254',
    }, false)).toThrow();
    expect(() => readHttpMetadataConfig({
      SERVICE_REGISTRY_HTTP_ENABLED: 'yes',
    }, false)).toThrow();
  });

  test('parses bounded non-executable HTML title and conventional icon links', () => {
    expect(extractRootMetadata(
      '<!doctype html><title>BuildPro &amp; Local</title>' +
      '<link rel="shortcut icon" href="/logo.png?ver=1&amp;dark=0">'
    )).toEqual({ title: 'BuildPro & Local', iconHref: '/logo.png?ver=1&dark=0' });
    expect(extractRootMetadata('<script>document.title="hidden"</script>'))
      .toEqual({ title: '', iconHref: null });
  });

  test('captures actual root HTML title and relative PNG favicon', async () => {
    const paths = [];
    await withHttpServer((req, res) => {
      paths.push(req.url);
      expect(req.headers.cookie).toBeUndefined();
      expect(req.headers.authorization).toBeUndefined();
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>Local Dev &amp; Test</title><link rel="icon" href="/favicon.png">');
      } else if (req.url === '/favicon.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG);
      } else { res.writeHead(404); res.end(); }
    }, async port => {
      const meta = await probeWebMetadata({ host: '127.0.0.1', port });
      expect(meta.title).toBe('Local Dev & Test');
      expect(meta.rootUrl).toBe('http://127.0.0.1:' + port + '/');
      expect(meta.iconType).toBe('image/png');
      expect(meta.iconBytes.equals(PNG)).toBe(true);
      expect(paths).toEqual(['/', '/favicon.png']);
    });
  });

  test('follows bounded same-origin redirect and /favicon.ico fallback', async () => {
    await withHttpServer((req, res) => {
      if (req.url === '/') { res.writeHead(302, { Location: '/login' }); res.end(); }
      else if (req.url === '/login') {
        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>Login page</title>');
      } else if (req.url === '/favicon.ico') {
        res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG);
      } else { res.writeHead(404); res.end(); }
    }, async port => {
      const meta = await probeWebMetadata({ host: '127.0.0.1', port });
      expect(meta.title).toBe('Login page');
      expect(meta.iconBytes.equals(PNG)).toBe(true);
    });
  });

  test('blocks cross-origin HTML redirect before any follow-up network request', async () => {
    await withHttpServer((_req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    }, async port => {
      await expect(probeWebMetadata({ host: '127.0.0.1', port }))
        .rejects.toMatchObject({ code: 'external_redirect' });
    });
  });

  test('never downloads external CDN icon or embedded JavaScript', async () => {
    const visits = [];
    await withHttpServer((req, res) => {
      visits.push(req.url);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<title>Private App</title><script src="http://example.com/stuff.js"></script>' +
        '<link rel="icon" href="https://example.com/track.svg">');
    }, async port => {
      const meta = await probeWebMetadata({ host: '127.0.0.1', port });
      expect(meta.title).toBe('Private App');
      expect(meta.iconBytes).toBeNull();
      expect(visits[0]).toBe('/');
      expect(visits.length).toBeLessThanOrEqual(6);
      expect(visits.every(path => path === '/' ||
        /^\/(favicon\.(ico|png)|apple-touch-icon\.png|icon\.png)$/.test(path))).toBe(true);
    });
  });

  test('a stalled HTTP page is abandoned within a bounded timeout', async () => {
    await withHttpServer(() => {}, async port => {
      await expect(probeWebMetadata({ host: '127.0.0.1', port, timeoutMs: 120 }))
        .rejects.toMatchObject({ code: 'timeout' });
    });
  });

  test('rejects oversized HTML and refuses non-HTML responses', async () => {
    await withHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('x'.repeat(257 * 1024));
    }, async port => {
      await expect(probeWebMetadata({ host: '127.0.0.1', port }))
        .rejects.toMatchObject({ code: 'too_large' });
    });
    await withHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    }, async port => {
      await expect(probeWebMetadata({ host: '127.0.0.1', port }))
        .rejects.toMatchObject({ code: 'not_html' });
    });
  });

  test('rejects MIME-confused icon data while retaining the real title', async () => {
    await withHttpServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<title>Still Recorded</title><link rel="icon" href="/icon.png">');
      } else {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end('<script>alert(1)</script>');
      }
    }, async port => {
      const meta = await probeWebMetadata({ host: '127.0.0.1', port });
      expect(meta.title).toBe('Still Recorded');
      expect(meta.iconBytes).toBeNull();
    });
  });

  test('does not attempt arbitrary target addresses or ports', async () => {
    for (const host of ['example.com', '169.254.169.254', '8.8.8.8']) {
      await expect(probeWebMetadata({ host, port: 3000 }))
        .rejects.toMatchObject({ code: 'blocked_target' });
    }
    await expect(probeWebMetadata({ host: '127.0.0.1', port: 65536 }))
      .rejects.toMatchObject({ code: 'blocked_target' });
  });
  test('captures Apple touch icons used by local developer dashboards', async () => {
    const visits = [];
    await withHttpServer((req, res) => {
      visits.push(req.url);
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<title>Hermes</title><link rel="apple-touch-icon" href="/assets/apple-icon.png">');
      } else if (req.url === '/assets/apple-icon.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG);
      } else { res.writeHead(404); res.end(); }
    }, async port => {
      const meta = await probeWebMetadata({ host: '127.0.0.1', port });
      expect(meta.title).toBe('Hermes');
      expect(meta.iconBytes.equals(PNG)).toBe(true);
      expect(visits).toContain('/assets/apple-icon.png');
    });
  });

  test('uses a bounded same-origin PWA manifest for web IDE icons', async () => {
    const visits = [];
    await withHttpServer((req, res) => {
      visits.push(req.url);
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<title>code-server</title><link rel="manifest" href="/site.webmanifest">');
      } else if (req.url === '/site.webmanifest') {
        res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
        res.end(JSON.stringify({ icons: [{ src: '/assets/code-192.png', sizes: '192x192' }] }));
      } else if (req.url === '/assets/code-192.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG);
      } else { res.writeHead(404); res.end(); }
    }, async port => {
      const meta = await probeWebMetadata({ host: '127.0.0.1', port });
      expect(meta.iconBytes.equals(PNG)).toBe(true);
      expect(visits).toEqual(['/', '/site.webmanifest', '/assets/code-192.png']);
    });
  });

  test('tries favicon.png after absent favicon.ico and supports icon-only auth roots', async () => {
    for (const rootStatus of [200, 401]) {
      const visits = [];
      await withHttpServer((req, res) => {
        visits.push(req.url);
        if (req.url === '/') {
          res.writeHead(rootStatus, { 'Content-Type': rootStatus === 200 ? 'text/html' : 'text/plain' });
          res.end(rootStatus === 200 ? '<title>VS Code</title>' : 'Login required');
        } else if (req.url === '/favicon.png') {
          res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG);
        } else { res.writeHead(404); res.end(); }
      }, async port => {
        const meta = await probeWebMetadata({ host: '127.0.0.1', port });
        expect(meta.title).toBe(rootStatus === 200 ? 'VS Code' : '');
        expect(meta.iconBytes.equals(PNG)).toBe(true);
        expect(visits).toEqual(['/', '/favicon.ico', '/favicon.png']);
      });
    }
  });

  test('accepts extensionless local icon route with verified raster bytes', async () => {
    await withHttpServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<title>IDE</title><link rel="icon" href="/api/favicon?rev=4">');
      } else if (req.url === '/api/favicon?rev=4') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(PNG);
      } else { res.writeHead(404); res.end(); }
    }, async port => {
      const meta = await probeWebMetadata({ host: '127.0.0.1', port });
      expect(meta.iconBytes.equals(PNG)).toBe(true);
      expect(meta.iconType).toBe('image/png');
    });
  });

  test('never executes SVG, cross-origin manifest icons or unbounded candidate lists', async () => {
    const visits = [];
    await withHttpServer((req, res) => {
      visits.push(req.url);
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<title>Safe</title><link rel="manifest" href="/manifest.json">' +
          Array.from({ length: 10 }, (_, i) =>
            '<link rel="icon" href="/assets/icon-' + i + '.png">').join(''));
      } else if (req.url === '/manifest.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ icons: [
          { src: 'http://169.254.169.254/admin.png' }, { src: '/unsafe.svg' },
        ] }));
      } else {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
      }
    }, async port => {
      const meta = await probeWebMetadata({ host: '127.0.0.1', port });
      expect(meta.title).toBe('Safe');
      expect(meta.iconBytes).toBeNull();
      expect(visits.length).toBeLessThanOrEqual(7);
      expect(visits.every(url => url.startsWith('/'))).toBe(true);
      expect(visits).not.toContain('/unsafe.svg');
    });
  });

});
