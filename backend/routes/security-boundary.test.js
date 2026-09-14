const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const { once } = require("node:events");
const { createRequire } = require("node:module");
const express = require("express");
const {
  afterEach,
  describe,
  expect,
  jest: jestObject,
  test,
} = require("@jest/globals");

const originalAuth = process.env.ENABLE_AUTH;
const originalCorsOrigin = process.env.CORS_ORIGIN;
const originalPortLimit = process.env.MAX_INTERNAL_PORTS_PER_CONTAINER;
jestObject.mock("../lib/api-key-manager", () => ({
  validateAnyApiKey: async key => ({ valid: key === "synthetic-peer-key", serverId: "fixture" }),
}));
const { requireAllowedOrigin, requireAuth, requireAuthOrApiKey } = require("../middleware/auth");
const expressRequire = createRequire(require.resolve("express"));
const qs = expressRequire("qs");
const { sanitizeDockerInspection } = require("../lib/docker/internal-ports");

function runRequireAuth(pathname, session) {
  let statusCode = null;
  let payload = null;
  let nextCalled = false;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };

  requireAuth(
    { path: pathname, session },
    response,
    () => {
      nextCalled = true;
    }
  );

  return { statusCode, payload, nextCalled };
}

afterEach(() => {
  if (originalPortLimit === undefined) delete process.env.MAX_INTERNAL_PORTS_PER_CONTAINER;
  else process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = originalPortLimit;
  if (originalAuth === undefined) {
    delete process.env.ENABLE_AUTH;
  } else {
    process.env.ENABLE_AUTH = originalAuth;
  }
  if (originalCorsOrigin === undefined) {
    delete process.env.CORS_ORIGIN;
  } else {
    process.env.CORS_ORIGIN = originalCorsOrigin;
  }
});

describe("router authentication", () => {
  test("the production app mounts both routers behind requireAuth", () => {
    const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    expect(source).toContain(
      "app.use('/api/settings', requireAuth, settingsRoutes);"
    );
    expect(source).toContain(
      "app.use('/api/autoxpose', requireAuth, autoxposeRoutes);"
    );
  });

  test("the production app fails closed when trusted settings storage is unavailable", () => {
    const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    const guard = source.indexOf("if (!settingsManager.initializeSettingsStorage())");
    const guardBlock = source.slice(guard, guard + 220);

    expect(guard).toBeGreaterThan(-1);
    expect(guardBlock).toContain("process.exit(1)");
  });

  test("the production app enables CORS only for configured origins", () => {
    const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    const guard = source.indexOf("if (corsOrigins.length)");
    const middleware = source.indexOf("app.use(cors({", guard);

    expect(guard).toBeGreaterThan(-1);
    expect(middleware).toBeGreaterThan(guard);
  });

  test("the Vite proxy preserves the browser host for origin checks", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../frontend/vite.config.js"),
      "utf8"
    );

    expect(source).toContain("changeOrigin: false");
  });

  test.each([
    "/api/settings",
    "/api/settings/defaults",
    "/api/autoxpose/status",
    "/api/autoxpose/connect",
    "/api/autoxpose/disconnect",
    "/api/autoxpose/display-mode",
    "/api/autoxpose/url-style",
    "/api/autoxpose/services",
    "/api/autoxpose/domain",
  ])("rejects unauthenticated access to %s", (route) => {
    process.env.ENABLE_AUTH = "true";

    expect(runRequireAuth(route)).toEqual({
      statusCode: 401,
      payload: {
        error: "Authentication required",
        authEnabled: true,
      },
      nextCalled: false,
    });
  });

  test("allows an authenticated session", () => {
    process.env.ENABLE_AUTH = "true";

    expect(runRequireAuth("/api/autoxpose/status", { userId: "test-user" })).toEqual({
      statusCode: null,
      payload: null,
      nextCalled: true,
    });
  });

  test("preserves auth-disabled behavior", () => {
    process.env.ENABLE_AUTH = "false";

    expect(runRequireAuth("/api/settings")).toEqual({
      statusCode: null,
      payload: null,
      nextCalled: true,
    });
  });
});

describe("port generation authentication", () => {
  test.each([
    ["anonymous", "true", false, null, 401],
    ["invalid key", "true", false, "invalid-fixture-key", 401],
    ["peer key", "true", false, "synthetic-peer-key", 200],
    ["session", "true", true, null, 200],
    ["auth disabled", "false", false, null, 200],
    ["auth unset", undefined, false, null, 200],
  ])("checks %s before reading or contacting a peer", async (_label, auth, session, key, expected) => {
    if (auth === undefined) delete process.env.ENABLE_AUTH;
    else process.env.ENABLE_AUTH = auth;
    const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    const route = source.match(/app\.post\("\/api\/servers\/:id\/generate-port",[\s\S]+?\n\}\);/)[0];
    const databaseReads = [];
    const outbound = [];
    const app = express();
    app.use((request, _response, next) => {
      if (session) request.session = { userId: "fixture-user" };
      next();
    });
    vm.runInNewContext(route, {
      app, requireAuthOrApiKey, process, URL, AbortController, setTimeout, clearTimeout,
      generatePortLimit: (_request, _response, next) => next(),
      BASE_DEBUG: false,
      logger: { setDebugEnabled() {}, warn() {}, error() {}, debug() {} },
      db: { peerKeys: { open: () => "synthetic-outbound-key" }, prepare: () => ({ get: id => {
        databaseReads.push(id);
        return { type: "peer", url: "http://peer.invalid", remote_api_key: "synthetic-outbound-key" };
      } }) },
      peerRequest: async (server, endpoint, options) => {
        outbound.push({ url: new URL(endpoint, server.url).href, options: { ...options, headers: { 'X-API-Key': 'synthetic-outbound-key' } } });
        return { ok: true, json: async () => ({ port: 12345 }) };
      },
    });
    const server = app.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const headers = { Connection: "close" };
      if (key) headers["X-API-Key"] = key;
      const response = await globalThis.fetch(`http://127.0.0.1:${server.address().port}/api/servers/fixture/generate-port`, {
        method: "POST", headers,
      });
      expect(response.status).toBe(expected);
      expect(databaseReads).toHaveLength(expected === 200 ? 1 : 0);
      expect(outbound).toHaveLength(expected === 200 ? 1 : 0);
      if (expected === 200) {
        expect(await response.json()).toEqual({ port: 12345 });
        expect(outbound[0].options.headers["X-API-Key"]).toBe("synthetic-outbound-key");
      }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});

describe("container inspection confidentiality", () => {
  test.each([1, 101])("omits environment values with %i unpublished ports", count => {
    delete process.env.MAX_INTERNAL_PORTS_PER_CONTAINER;
    const inspection = {
      Id: "fixture-container",
      Config: {
        Env: ["DATABASE_PASSWORD=synthetic-sensitive-value", "UNUSUAL_NAME=synthetic-peer-value"],
        Image: "fixture:1",
        ExposedPorts: Object.fromEntries(Array.from({ length: count }, (_, index) => [`${20000 + index}/tcp`, {}])),
      },
      HostConfig: { PortBindings: { "80/tcp": [{ HostPort: "18080", HostIp: "0.0.0.0" }] } },
    };
    const before = JSON.stringify(inspection);
    const sanitized = sanitizeDockerInspection(inspection);
    expect(sanitized.Config).not.toHaveProperty("Env");
    expect(JSON.stringify(sanitized)).not.toContain("synthetic-sensitive-value");
    expect(JSON.stringify(sanitized)).not.toContain("synthetic-peer-value");
    expect(sanitized.Config.Image).toBe("fixture:1");
    expect(sanitized.HostConfig.PortBindings["80/tcp"][0].HostPort).toBe("18080");
    expect(JSON.stringify(inspection)).toBe(before);
    expect(sanitizeDockerInspection(sanitized)).toEqual(sanitized);
  });
});

describe("browser origin policy", () => {
  function runOriginPolicy(origin, host = "portracker.local:4999") {
    let statusCode = null;
    let payload = null;
    let nextCalled = false;
    const response = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      },
    };

    requireAllowedOrigin(
      { headers: { origin, host } },
      response,
      () => {
        nextCalled = true;
      }
    );
    return { statusCode, payload, nextCalled };
  }

  test("allows same-origin and non-browser requests", () => {
    expect(runOriginPolicy("http://portracker.local:4999").nextCalled).toBe(true);
    expect(runOriginPolicy(undefined).nextCalled).toBe(true);
  });

  test("blocks an unconfigured cross-origin browser request", () => {
    expect(runOriginPolicy("https://other.example")).toEqual({
      statusCode: 403,
      payload: { error: "Cross-origin request blocked" },
      nextCalled: false,
    });
  });

  test("allows an explicitly configured cross-origin request", () => {
    process.env.CORS_ORIGIN = "https://trusted.example";

    expect(runOriginPolicy("https://trusted.example").nextCalled).toBe(true);
  });

  test("ignores wildcard CORS configuration", () => {
    process.env.CORS_ORIGIN = "*";

    expect(runOriginPolicy("https://other.example").statusCode).toBe(403);
  });
});

describe("patched Express request parsing", () => {
  test("serializes parsed constructor.isBuffer input without throwing", () => {
    const parsed = qs.parse("x[constructor][isBuffer]=y", { plainObjects: true });

    expect(() => qs.stringify(parsed)).not.toThrow();
  });

  test("enforces the array limit for bracketed comma-separated input", () => {
    expect(() => qs.parse("ports[]=1,2,3,4", {
      comma: true,
      arrayLimit: 3,
      throwOnLimitExceeded: true,
    })).toThrow(RangeError);
  });

  test("preserves Express query, JSON, and form request handling", async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.get("/echo", (request, response) => response.json(request.query));
    app.post("/echo", (request, response) => response.json(request.body));
    const server = app.listen(0, "127.0.0.1");

    try {
      await once(server, "listening");
      const url = `http://127.0.0.1:${server.address().port}/echo`;
      const query = await globalThis.fetch(`${url}?filter[name]=demo&ports[]=80&ports[]=443`, {
        headers: { Connection: "close" },
      });
      expect(query.status).toBe(200);
      expect(await query.json()).toEqual({
        filter: { name: "demo" },
        ports: ["80", "443"],
      });
      const payload = { theme: "dark", showServiceIcons: true };
      const json = await globalThis.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Connection: "close" },
        body: JSON.stringify(payload),
      });
      expect(json.status).toBe(200);
      expect(await json.json()).toEqual(payload);
      const form = await globalThis.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Connection: "close" },
        body: "filter[name]=demo&ports[]=80&ports[]=443",
      });
      expect(form.status).toBe(200);
      expect(await form.json()).toEqual({
        filter: { name: "demo" },
        ports: ["80", "443"],
      });
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});