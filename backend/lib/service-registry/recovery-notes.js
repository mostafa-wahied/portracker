'use strict';

function readRecoveryConfig(env = process.env) {
  const requested = env.SERVICE_REGISTRY_RECOVERY_ENABLED === 'true';
  const authenticated = env.ENABLE_AUTH === 'true';
  return { enabled: requested && authenticated, requiresAuth: requested && !authenticated };
}

class RecoveryNotesConflict extends Error {
  constructor() {
    super('Recovery notes were changed elsewhere; reload before saving');
    this.code = 'notes_conflict';
  }
}

function createRecoveryNotesStore(db) {
  const lookup = db.prepare(
    'SELECT notes, revision, updated_at FROM registry_recovery_notes WHERE service_id = ?'
  );
  const present = db.prepare('SELECT id FROM registry_services WHERE id = ?');
  const insert = db.prepare(
    'INSERT INTO registry_recovery_notes (service_id, notes, revision, updated_at) VALUES (?, ?, 1, ?)'
  );
  const update = db.prepare(
    'UPDATE registry_recovery_notes SET notes = ?, revision = revision + 1, ' +
    'updated_at = ? WHERE service_id = ? AND revision = ?'
  );

  function get(serviceId) {
    if (typeof serviceId !== 'string' || serviceId.length > 128) {
      throw new TypeError('Invalid service ID');
    }
    const row = lookup.get(serviceId);
    return row ? {
      text: row.notes, version: row.revision, updatedAt: row.updated_at,
    } : { text: '', version: 0, updatedAt: null };
  }

  const save = db.transaction((serviceId, notes, version, at) => {
    if (!present.get(serviceId)) return null;
    const current = lookup.get(serviceId);
    const expected = current?.revision || 0;
    if (version !== expected) throw new RecoveryNotesConflict();
    if (!current) insert.run(serviceId, notes, at);
    else update.run(notes, at, serviceId, version);
    return get(serviceId);
  });

  function saveNotes(serviceId, notes, version, at = Date.now()) {
    if (typeof serviceId !== 'string' || serviceId.length > 128 ||
        typeof notes !== 'string' || notes.length > 4000 ||
        !Number.isInteger(version) || version < 0 || version > 100000000 ||
        !Number.isSafeInteger(at) || at < 0) {
      throw new TypeError('Invalid recovery notes');
    }
    // Notes are inert user text, not commands run by the server. Reject NUL
    // and other control characters except line breaks and tabs.
    if (Array.from(notes).some(ch => {
      const code = ch.codePointAt(0);
      return code === 0 || code === 127 || (code < 32 && ![9, 10, 13].includes(code));
    })) throw new TypeError('Invalid recovery note characters');
    return save(serviceId, notes, version, at);
  }

  return { get, saveNotes };
}

module.exports = {
  createRecoveryNotesStore, RecoveryNotesConflict, readRecoveryConfig,
};
