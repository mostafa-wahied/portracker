const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const prefix = "pkey:v1:";

function peerIdentity(server) {
  return JSON.stringify([server.id, new URL(server.url).href]);
}

function loadKey(filename, encryptedRows) {
  if (!filename) {
    if (encryptedRows) throw new Error("Persistent peer encryption key is required");
    return crypto.randomBytes(32);
  }
  if (!path.isAbsolute(filename)) throw new Error("PEER_KEY_FILE must be an absolute path");
  if (!fs.existsSync(filename)) {
    if (encryptedRows) throw new Error("Peer encryption key is missing; restore the original PEER_KEY_FILE with the database");
    const descriptor = fs.openSync(filename, "wx", 0o600);
    try { fs.writeFileSync(descriptor, crypto.randomBytes(32)); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
  }
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size !== 32 || fs.lstatSync(filename).isSymbolicLink() ||
        (process.platform !== "win32" && (stat.mode & 0o077))) {
      throw new Error("Peer encryption key must be a private mode-600 regular file containing 32 bytes");
    }
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function createPeerKeyStore(db, { keyFile } = {}) {
  const rows = db.prepare("SELECT id, url, remote_api_key FROM servers WHERE remote_api_key IS NOT NULL").all();
  const encryptedRows = rows.some(row => row.remote_api_key.startsWith("pkey:"));
  let key = rows.length ? loadKey(keyFile, encryptedRows) : null;
  const seal = (server, value) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || value.length > 8192 || /[\r\n]/.test(value)) throw new Error("Invalid peer API key");
    key ||= loadKey(keyFile, false);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(peerIdentity(server)));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return prefix + [nonce, cipher.getAuthTag(), ciphertext].map(bytes => bytes.toString("base64url")).join(":");
  };
  const open = server => {
    if (!server.remote_api_key) return null;
    try {
      if (!key || !server.remote_api_key.startsWith(prefix)) throw new Error();
      const parts = server.remote_api_key.slice(prefix.length).split(":");
      if (parts.length !== 3 || parts.some(value => !/^[A-Za-z0-9_-]+$/.test(value))) throw new Error();
      const [nonce, tag, ciphertext] = parts.map(value => Buffer.from(value, "base64url"));
      if (nonce.length !== 12 || tag.length !== 16) throw new Error();
      const cipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(peerIdentity(server)));
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString("utf8");
    } catch {
      throw new Error("Peer credential cannot be decrypted; restore the matching key file or reconfigure this peer");
    }
  };
  const legacy = rows.filter(row => !row.remote_api_key.startsWith("pkey:"));
  rows.filter(row => row.remote_api_key.startsWith("pkey:")).forEach(open);
  if (legacy.length) {
    db.pragma("secure_delete = ON");
    const update = db.prepare("UPDATE servers SET remote_api_key = ? WHERE id = ?");
    db.transaction(() => {
      for (const row of legacy) update.run(seal(row, row.remote_api_key), row.id);
    })();
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.exec("VACUUM");
    db.pragma("wal_checkpoint(TRUNCATE)");
  }
  return { seal, open };
}

module.exports = { createPeerKeyStore, peerIdentity };