'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Database = require('better-sqlite3');
const { describe, test, expect } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');
const { createRegistryScanner } = require('./scanner');
const { createHttpMetadataStore } = require('./http-store');
const { createHttpMetadataWorker } = require('./http-worker');
const { createLinuxProvenanceStore } = require('./linux-provenance-store');
const { createRecoveryNotesStore } = require('./recovery-notes');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WkW3+IAAAAASUVORK5CYII=',
  'base64'
);
const BOOT = 'a1b2c3d4-0000-4444-8888-eeeeffffffff';

async function serveWebFixture() {
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>NixOS Dev Panel</title><link rel="icon" href="/favicon.png">');
    } else if (req.url === '/favicon.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PNG);
    } else { res.writeHead(404); res.end(); }
  });
  // The worker deliberately probes only likely-web ports.
  for (let port = 4200; port < 4230; port++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListen); reject(error); };
        const onListen = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListen);
        server.listen(port, '127.0.0.1');
      });
      return { port, close: () => new Promise(resolve => server.close(resolve)) };
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No free test port in the web-fixture range');
}

function temporaryDatabase(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-acceptance-'));
  const file = path.join(dir, 'test.sqlite');
  return Promise.resolve().then(() => run(file)).finally(() =>
    fs.rmSync(dir, { recursive: true, force: true })
  );
}

const nativeRow = (port, pid, ticks) => ({
  source: 'system', protocol: 'tcp', host_ip: '127.0.0.1',
  host_port: port, owner: 'node', pid, boot_id: BOOT,
  process_start_ticks: ticks,
  provenance: {
    kind: 'systemd_user_service', unitName: 'dev-panel.service',
    unitScope: 'user', confidence: 'observed',
    pid, uid: 1000, startTicks: ticks, bootId: BOOT,
    cwd: '/home/dev/demo', executablePath: '/nix/store/node/bin/node',
  },
  internal: false,
});

describe('registry cross-layer acceptance independent of the browser', () => {
  test('HTTP metadata, persistence, reboot, offline, notes and port reuse', async () => {
    const web = await serveWebFixture();
    try {
      await temporaryDatabase(async file => {
        let db = new Database(file);
        let registry = createServiceRegistry(db);
        let httpStore = createHttpMetadataStore(db);
        let noteStore = createRecoveryNotesStore(db);
        let linuxStore = createLinuxProvenanceStore(db);
        let current = nativeRow(web.port, 77001, '101');
        let listening = true;
        const captureHost = async () => ({
          source: 'system', complete: true, rows: listening ? [current] : [],
        });
        const captureDocker = async () => ({ source: 'docker', complete: true, rows: [] });
        let clock = 1000000;
        const createScanner = () => {
          const worker = createHttpMetadataWorker({
            store: httpStore, enabled: true, host: '127.0.0.1', now: () => clock,
          });
          return createRegistryScanner({
            registry, provenanceStore: linuxStore, now: () => clock,
            captureHost, captureDocker, onCycle: worker.enrich,
          });
        };
        await createScanner().scanOnce(); // No browser tab is involved.
        const first = registry.listServices().items[0];
        expect(first.status).toBe('listening');
        expect(httpStore.getMetadata(first.id)).toMatchObject({
          httpTitle: 'NixOS Dev Panel',
          httpRootUrl: 'http://127.0.0.1:' + web.port + '/',
        });
        const savedHash = httpStore.getMetadata(first.id).iconHash;
        expect(httpStore.getIcon(savedHash).bytes.equals(PNG)).toBe(true);
        expect(linuxStore.get(first.id).unitName).toBe('dev-panel.service');
        noteStore.saveNotes(first.id, 'nix develop then pnpm dev', 0, clock);

        // A monitor restart does not prove a service stopped.
        db.close();
        db = new Database(file);
        registry = createServiceRegistry(db);
        httpStore = createHttpMetadataStore(db);
        linuxStore = createLinuxProvenanceStore(db);
        noteStore = createRecoveryNotesStore(db);
        registry.markStale('local');
        expect(registry.getService(first.id).status).toBe('unknown');
        expect(noteStore.get(first.id).text).toBe('nix develop then pnpm dev');

        listening = false;
        clock += 60000;
        await createScanner().scanOnce();
        expect(registry.getService(first.id).status).toBe('offline');
        expect(httpStore.getMetadata(first.id).httpTitle).toBe('NixOS Dev Panel');
        expect(httpStore.getIcon(savedHash).bytes.equals(PNG)).toBe(true);

        listening = true;
        current = nativeRow(web.port, 77002, '202');
        clock += 60000;
        await createScanner().scanOnce();
        const records = registry.listServices();
        expect(records.total).toBe(1);
        expect(records.items[0].id).toBe(first.id);
        expect(records.items[0].status).toBe('listening');
        expect(registry.getService(first.id).runCount).toBe(2);
        expect(noteStore.get(first.id).text).toBe('nix develop then pnpm dev');
        db.close();
      });
    } finally { await web.close(); }
  });

  test('400 unique listeners persist; partial scans cannot fabricate offline', () => {
    const db = new Database(':memory:');
    try {
      const registry = createServiceRegistry(db);
      const rows = Array.from({ length: 400 }, (_, i) => ({
        source: 'system', protocol: 'tcp', host_ip: '127.0.0.1',
        host_port: 12000 + i, owner: 'node', pid: 20000 + i,
      }));
      expect(registry.reconcileSource({
        source: 'system', rows, complete: true, at: 1000,
      }).count).toBe(400);
      expect(registry.listServices().total).toBe(400);
      registry.reconcileSource({
        source: 'system', rows: rows.slice(0, 200), complete: false,
        at: 2000, errorCode: 'untrusted_scan_scope',
      });
      expect(registry.listServices({ status: 'offline' }).total).toBe(0);
      expect(registry.listServices({ status: 'unknown' }).total).toBe(200);
      registry.reconcileSource({
        source: 'system', rows: [], complete: true, at: 3000,
      });
      expect(registry.listServices({ status: 'offline' }).total).toBe(400);
      expect(db.prepare('SELECT COUNT(*) AS n FROM registry_services').get().n).toBe(400);
      const pageBytes = db.pragma('page_size', { simple: true });
      const pageCount = db.pragma('page_count', { simple: true });
      expect(pageBytes * pageCount).toBeLessThan(8 * 1024 * 1024);
    } finally { db.close(); }
  });

  test('migration preserves unrelated legacy records and manual notes', () =>
    temporaryDatabase(file => {
      const db = new Database(file);
      db.exec('CREATE TABLE legacy_manual_notes (id TEXT PRIMARY KEY, note TEXT)');
      db.prepare('INSERT INTO legacy_manual_notes VALUES (?, ?)').run('original', 'keep unchanged');
      const registry = createServiceRegistry(db);
      const service = registry.observe(nativeRow(4242, 7777, '123'));
      createRecoveryNotesStore(db).saveNotes(service.id, 'start manually', 0, 1000);
      db.close();
      const reopened = new Database(file);
      try {
        createServiceRegistry(reopened);
        expect(reopened.prepare('SELECT note FROM legacy_manual_notes').get().note)
          .toBe('keep unchanged');
        expect(createRecoveryNotesStore(reopened).get(service.id).text).toBe('start manually');
        expect(reopened.prepare('SELECT COUNT(*) AS n FROM registry_schema_versions').get().n)
          .toBe(10);
      } finally { reopened.close(); }
    })
  );
});
