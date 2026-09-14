const { describe, expect, test, jest: jestObject } = require("@jest/globals");
const { registerServerRoutes } = require("./servers");
const Database = require("better-sqlite3");
const { createPeerKeyStore } = require("../lib/peer-key-store");

describe("peer configuration confidentiality", () => {
  test("encrypts submitted keys, preserves label edits and clears changed destinations", async () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE servers (id TEXT PRIMARY KEY,label TEXT,url TEXT,parentId TEXT,type TEXT,unreachable INTEGER,platform_type TEXT,remote_api_key TEXT,position INTEGER)");
    db.peerKeys = createPeerKeyStore(db);
    let handler;
    registerServerRoutes({ get() {}, put() {}, post: (_route, ...handlers) => { handler = handlers.at(-1); } }, {
      db, logger: { debug() {}, info() {}, error() {} }, requireAuth() {}, validateServerInput() {},
    });
    const save = async body => {
      const response = { status: jestObject.fn().mockReturnThis(), json: jestObject.fn() };
      await handler({ body }, response);
      expect(response.status).toHaveBeenCalledWith(expect.any(Number));
      return db.prepare("SELECT * FROM servers WHERE id='fixture'").get();
    };
    try {
      const body = { id: "fixture", label: "Peer", url: "http://peer.invalid", type: "peer", platform_type: "docker" };
      let row = await save({ ...body, apiKey: "synthetic-peer-key" });
      expect(row.remote_api_key).not.toContain("synthetic-peer-key");
      expect(db.peerKeys.open(row)).toBe("synthetic-peer-key");
      const ciphertext = row.remote_api_key;
      row = await save({ ...body, label: "Renamed" });
      expect(row.remote_api_key).toBe(ciphertext);
      row = await save({ ...body, url: "http://changed.invalid" });
      expect(row.remote_api_key).toBeNull();
    } finally { db.close(); }
  });
  test("does not log or return a submitted key after a database failure", async () => {
    let handler;
    const logger = { debug() {}, info() {}, error: jestObject.fn() };
    registerServerRoutes({
      get() {}, put() {},
      post: (_route, ...handlers) => { handler = handlers.at(-1); },
    }, {
      db: { prepare: () => { throw new Error("datatype mismatch"); } },
      logger, requireAuth() {}, validateServerInput() {},
    });
    const response = { status: jestObject.fn().mockReturnThis(), json: jestObject.fn() };
    await handler({ body: { id: "fixture", type: "peer", url: "https://peer.invalid", apiKey: "synthetic-submitted-key" } }, response);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("synthetic-submitted-key");
    expect(JSON.stringify(response.json.mock.calls)).not.toContain("synthetic-submitted-key");
    expect(response.status).toHaveBeenCalledWith(500);
  });
});