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

  test("keeps the stored url when a peer is updated without one", () => {
    postServer({
      id: "peer-1",
      label: "Peer",
      url: "http://10.0.0.5:4999",
      type: "peer",
      platform_type: "unknown",
    });

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
