const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { describe, test, expect } = require("@jest/globals");
const { createPeerKeyStore } = require("./peer-key-store");

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "peer-key-test-"));
  const file = path.join(directory, "database.sqlite");
  const keyFile = path.join(directory, "peer.key");
  const db = new Database(file);
  db.exec("CREATE TABLE servers (id TEXT PRIMARY KEY, url TEXT, remote_api_key TEXT)");
  const peer = { id: "fixture", url: "http://peer.invalid:4999" };
  try { run({ db, file, keyFile, peer, directory }); }
  finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}

describe("encrypted outbound peer keys", () => {
  test("migrates plaintext and preserves keys across restart and restore", () => fixture(({ db, file, keyFile, peer, directory }) => {
    db.prepare("INSERT INTO servers VALUES (?, ?, ?)").run(peer.id, peer.url, "synthetic-peer-secret");
    const store = createPeerKeyStore(db, { keyFile });
    const saved = db.prepare("SELECT * FROM servers").get();
    expect(saved.remote_api_key).not.toContain("synthetic-peer-secret");
    expect(store.open(saved)).toBe("synthetic-peer-secret");
    expect(createPeerKeyStore(db, { keyFile }).open(saved)).toBe("synthetic-peer-secret");
    expect(fs.readFileSync(file).includes(Buffer.from("synthetic-peer-secret"))).toBe(false);
    expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
    const restoredKey = path.join(directory, "restored.key");
    fs.copyFileSync(keyFile, restoredKey); fs.chmodSync(restoredKey, 0o600);
    const restoredDb = path.join(directory, "restored.sqlite");
    fs.copyFileSync(file, restoredDb);
    const copy = new Database(restoredDb);
    try { expect(createPeerKeyStore(copy, { keyFile: restoredKey }).open(saved)).toBe("synthetic-peer-secret"); }
    finally { copy.close(); }
  }));

  test("uses fresh nonces and binds keys to peer identity and destination", () => fixture(({ db, keyFile, peer }) => {
    const store = createPeerKeyStore(db, { keyFile });
    const remote_api_key = store.seal(peer, "synthetic-key");
    expect(store.seal(peer, "synthetic-key")).not.toBe(remote_api_key);
    expect(store.open({ ...peer, remote_api_key })).toBe("synthetic-key");
    expect(() => store.open({ ...peer, id: "other", remote_api_key })).toThrow("cannot be decrypted");
    expect(() => store.open({ ...peer, url: "http://other.invalid", remote_api_key })).toThrow("cannot be decrypted");
    expect(() => store.open({ ...peer, remote_api_key: remote_api_key.slice(0, -4) + "xxxx" })).toThrow("cannot be decrypted");
  }));

  test("does not regenerate missing or accept incorrect keys for encrypted databases", () => fixture(({ db, keyFile, peer }) => {
    const store = createPeerKeyStore(db, { keyFile });
    db.prepare("INSERT INTO servers VALUES (?, ?, ?)").run(peer.id, peer.url, store.seal(peer, "synthetic-key"));
    fs.unlinkSync(keyFile);
    expect(() => createPeerKeyStore(db, { keyFile })).toThrow("missing");
    expect(fs.existsSync(keyFile)).toBe(false);
    fs.writeFileSync(keyFile, Buffer.alloc(32), { mode: 0o600 });
    expect(() => createPeerKeyStore(db, { keyFile })).toThrow("cannot be decrypted");
  }));

  test("rejects insecure permissions, symlinks and malformed keys", () => fixture(({ db, keyFile, peer, directory }) => {
    fs.writeFileSync(keyFile, Buffer.alloc(32), { mode: 0o644 });
    expect(() => createPeerKeyStore(db, { keyFile }).seal(peer, "synthetic-key")).toThrow("mode-600");
    fs.chmodSync(keyFile, 0o600);
    const link = path.join(directory, "linked.key"); fs.symlinkSync(keyFile, link);
    expect(() => createPeerKeyStore(db, { keyFile: link }).seal(peer, "synthetic-key")).toThrow();
    fs.writeFileSync(keyFile, "short");
    expect(() => createPeerKeyStore(db, { keyFile }).seal(peer, "synthetic-key")).toThrow("32 bytes");
  }));

  test("does not partially migrate when an existing encrypted row fails validation", () => fixture(({ db, keyFile, peer }) => {
    const store = createPeerKeyStore(db, { keyFile });
    db.prepare("INSERT INTO servers VALUES (?, ?, ?)").run(peer.id, peer.url, store.seal(peer, "synthetic-key") + "bad");
    db.prepare("INSERT INTO servers VALUES (?, ?, ?)").run("legacy", peer.url, "synthetic-legacy");
    expect(() => createPeerKeyStore(db, { keyFile })).toThrow();
    expect(db.prepare("SELECT remote_api_key FROM servers WHERE id='legacy'").get().remote_api_key).toBe("synthetic-legacy");
  }));
});