'use strict';

const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, expect, test } = require('@jest/globals');
const { createServiceRegistry } = require('./registry');
const {
  createRecoveryNotesStore, RecoveryNotesConflict, readRecoveryConfig,
} = require('./recovery-notes');

function fixture(run) {
  const db = new Database(':memory:');
  try {
    const registry = createServiceRegistry(db);
    return run(db, registry, createRecoveryNotesStore(db));
  } finally { db.close(); }
}

function observed(registry, pid = 123) {
  return registry.observe({
    host_ip: '127.0.0.1', host_port: 3000, protocol: 'tcp',
    owner: 'node', source: 'system', pid,
  });
}

describe('per-service recovery notes and concurrency', () => {
  test('requires authenticated explicit opt-in, not browser settings', () => {
    expect(readRecoveryConfig({})).toEqual({ enabled: false, requiresAuth: false });
    expect(readRecoveryConfig({ SERVICE_REGISTRY_RECOVERY_ENABLED: 'true' }))
      .toEqual({ enabled: false, requiresAuth: true });
    expect(readRecoveryConfig({
      SERVICE_REGISTRY_RECOVERY_ENABLED: 'true', ENABLE_AUTH: 'true',
    })).toEqual({ enabled: true, requiresAuth: false });
  });

  test('new notes have revision zero; save increases revision atomically', () => fixture((_db, registry, store) => {
    const record = observed(registry);
    expect(store.get(record.id)).toEqual({ text: '', version: 0, updatedAt: null });
    expect(store.saveNotes(record.id, 'cd /home/dev && pnpm dev', 0, 1000))
      .toEqual({ text: 'cd /home/dev && pnpm dev', version: 1, updatedAt: 1000 });
    expect(store.saveNotes(record.id, 'nix develop then pnpm dev', 1, 2000))
      .toEqual({ text: 'nix develop then pnpm dev', version: 2, updatedAt: 2000 });
  }));

  test('stale updates receive a conflict instead of overwriting another user', () => fixture((_db, registry, store) => {
    const record = observed(registry);
    store.saveNotes(record.id, 'updated by the first editor', 0, 1000);
    expect(() => store.saveNotes(record.id, 'stale note', 0, 2000))
      .toThrow(RecoveryNotesConflict);
    expect(store.get(record.id).text).toBe('updated by the first editor');
    expect(() => store.saveNotes(record.id, 'new note', 3, 2000))
      .toThrow(RecoveryNotesConflict);
  }));

  test('forget one historical service clears only its manual notes', () => fixture((db, registry, store) => {
    const a = observed(registry, 123);
    const b = observed(registry, 456);
    store.saveNotes(a.id, 'A', 0);
    store.saveNotes(b.id, 'B', 0);
    expect(registry.forgetService(a.id)).toBe(true);
    expect(store.get(a.id)).toEqual({ text: '', version: 0, updatedAt: null });
    expect(store.get(b.id).text).toBe('B');
    expect(db.prepare('SELECT COUNT(*) AS n FROM registry_recovery_notes').get().n).toBe(1);
  }));

  test('notes are inert text and never stored as executable scripts', () => fixture((db, registry, store) => {
    const record = observed(registry);
    const text = "nix develop\n# Do not copy secrets; run 'pnpm dev' manually";
    store.saveNotes(record.id, text, 0);
    expect(store.get(record.id).text).toBe(text);
    expect(db.prepare('SELECT notes FROM registry_recovery_notes').get().notes).toBe(text);
  }));

  test('rejects control characters, oversized notes, invalid revisions and unknown IDs', () => fixture((_db, registry, store) => {
    const record = observed(registry);
    expect(() => store.saveNotes(record.id, '\u0000secret', 0)).toThrow();
    expect(() => store.saveNotes(record.id, 'x'.repeat(4001), 0)).toThrow();
    expect(() => store.saveNotes(record.id, 'hello', -1)).toThrow();
    expect(() => store.saveNotes(record.id, 'hello', '0')).toThrow();
    expect(store.saveNotes('not-a-real-service', 'hello', 0)).toBeNull();
  }));

  test('service notes persist after SQLite close/reopen, even when service is offline', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-recovery-'));
    const file = path.join(dir, 'registry.sqlite');
    try {
      const db = new Database(file);
      const registry = createServiceRegistry(db);
      const record = observed(registry);
      createRecoveryNotesStore(db).saveNotes(record.id, 'remember this service', 0, 1000);
      createRecoveryNotesStore(db).saveStart(record.id, 'pnpm dev', '/home/dev/project', 0, 1000);
      registry.reconcileSource({ source: 'system', complete: true, rows: [], at: 2000 });
      db.close();

      const reopened = new Database(file);
      try {
        const after = createServiceRegistry(reopened);
        const saved = createRecoveryNotesStore(reopened).get(record.id);
        expect(saved).toEqual({
          text: 'remember this service', version: 1, updatedAt: 1000,
        });
        expect(after.getService(record.id).status).toBe('offline');
        const preferred = createRecoveryNotesStore(reopened).getStart(record.id);
        expect(preferred).toMatchObject({
          command: 'pnpm dev', cwd: '/home/dev/project', version: 1,
        });
        expect(preferred.line).toContain('&& pnpm dev');
      } finally { reopened.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('preferred start command is one-line and cwd is shell-quoted without execution', () => fixture((db, registry, store) => {
    const record = observed(registry);
    expect(store.getStart(record.id)).toEqual({
      command: '', cwd: '', version: 0, updatedAt: null, line: '',
    });
    const saved = store.saveStart(record.id, 'pnpm dev', "/home/dev/it's my project", 0, 1000);
    expect(saved).toMatchObject({
      command: 'pnpm dev', cwd: "/home/dev/it's my project", version: 1,
    });
    expect(saved.line).toContain("cd -- '/home/dev/it'");
    expect(saved.line).toContain('&& pnpm dev');
    expect(store.get(record.id).text).toBe('');
    store.saveNotes(record.id, 'manual notes remain separate', 0);
    expect(store.getStart(record.id).line).toBe(saved.line);
    expect(db.prepare('SELECT start_command FROM registry_recovery_notes').get().start_command)
      .toBe('pnpm dev');
    expect(() => store.saveStart(record.id, 'old', '', 0)).toThrow('changed elsewhere');
    expect(() => store.saveStart(record.id, 'bad\ncommand', '', 1)).toThrow();
    expect(() => store.saveStart(record.id, 'cmd', 'relative/path', 1)).toThrow();
    expect(() => store.saveStart(record.id, 'cmd', '/bad\npath', 1)).toThrow();
    expect(() => store.saveStart(record.id, 'x'.repeat(2001), '', 1)).toThrow();
    expect(store.saveStart('not-a-service', 'echo ok', '', 0)).toBeNull();
    expect(registry.forgetService(record.id)).toBe(true);
    expect(store.getStart(record.id).command).toBe('');
  }));

  test('migration v9 is idempotent after reopening the registry', () => fixture((db) => {
    createServiceRegistry(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM registry_schema_versions').get().n).toBe(10);
  }));
});
