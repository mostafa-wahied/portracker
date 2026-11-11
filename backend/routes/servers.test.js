const {
  afterAll,
  beforeEach,
  describe,
  expect,
  test,
} = require("@jest/globals");

const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = ":memory:";

const db = require("../db");
const { registerServerRoutes } = require("./servers");

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const routes = {};
registerServerRoutes(
  {
    get() {},
    put() {},
    post(path, ...handlers) {
      routes[path] = handlers[handlers.length - 1];
    },
  },
  { db, logger, requireAuth: () => {}, validateServerInput: () => {} }
);

function postServer(body) {
  let statusCode = null;
  let payload = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
      return this;
    },
  };
  routes["/api/servers"]({ body }, res);
  return { statusCode, payload };
}

function getServer(id) {
  return db.prepare("SELECT * FROM servers WHERE id = ?").get(id);
}

beforeEach(() => {
  db.prepare("DELETE FROM servers").run();
  db.ensureLocalServer(4999);
});

afterAll(() => {
  db.close();
  if (originalDatabasePath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = originalDatabasePath;
  }
});

describe("POST /api/servers", () => {
  test("renames the local server without a url and keeps its managed fields", () => {
    const result = postServer({
      id: "local",
      label: "My Host",
      url: null,
      parentId: null,
      type: "peer",
      unreachable: true,
      platform_type: "unknown",
    });

    expect(result.statusCode).toBe(200);
    expect(getServer("local")).toMatchObject({
      label: "My Host",
      url: "http://localhost:4999",
      type: "local",
      unreachable: 0,
      platform_type: "auto",
    });
  });

  test("ignores a url sent for the local server", () => {
    const result = postServer({
      id: "local",
      label: "My Host",
      url: "http://example.invalid:1234",
      type: "local",
      platform_type: "unknown",
    });

    expect(result.statusCode).toBe(200);
    expect(getServer("local")).toMatchObject({
      label: "My Host",
      url: "http://localhost:4999",
      type: "local",
    });
  });

  test("keeps the stored url and api key when a peer is updated without a url", () => {
    postServer({
      id: "peer-1",
      label: "Peer",
      url: "http://10.0.0.5:4999",
      type: "peer",
      platform_type: "unknown",
      apiKey: "synthetic-peer-key",
    });
    const sealedKey = getServer("peer-1").remote_api_key;
    expect(sealedKey).not.toBeNull();

    const result = postServer({
      id: "peer-1",
      label: "Peer Renamed",
      url: null,
      type: "peer",
      unreachable: true,
      platform_type: "unknown",
    });

    expect(result.statusCode).toBe(200);
    expect(getServer("peer-1")).toMatchObject({
      label: "Peer Renamed",
      url: "http://10.0.0.5:4999",
      type: "peer",
      unreachable: 1,
    });
    expect(getServer("peer-1").remote_api_key).toBe(sealedKey);
    expect(db.peerKeys.open(getServer("peer-1"))).toBe("synthetic-peer-key");
  });

  test("lets a peer stored with type local be switched back and have its url fixed", () => {
    db.prepare(
      "INSERT INTO servers (id, label, url, type, unreachable, platform_type) VALUES ('peer-3', 'Peer', 'http://10.0.0.6:4999', 'local', 0, 'unknown')"
    ).run();

    const result = postServer({
      id: "peer-3",
      label: "Peer",
      url: "http://10.0.0.7:4999",
      type: "peer",
      platform_type: "unknown",
    });

    expect(result.statusCode).toBe(200);
    expect(getServer("peer-3")).toMatchObject({
      url: "http://10.0.0.7:4999",
      type: "peer",
    });
  });

  test("still requires a url when adding a reachable peer", () => {
    const result = postServer({
      id: "peer-2",
      label: "New Peer",
      url: null,
      type: "peer",
      platform_type: "unknown",
    });

    expect(result.statusCode).toBe(400);
    expect(result.payload.field).toBe("url");
    expect(getServer("peer-2")).toBeUndefined();
  });
});
