const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { describe, expect, test, jest: jestObject } = require("@jest/globals");
const { registerServerRoutes } = require("./servers");

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const requireAuth = () => {};

function collectRoutes(deps = {}) {
  const routes = {};
  registerServerRoutes(
    {
      get() {},
      put() {},
      post(path, ...handlers) {
        routes[path] = handlers;
      },
    },
    { db: null, logger, requireAuth, validateServerInput: () => {}, ...deps }
  );
  return routes;
}

async function checkUrl(body, peerRequestOptions) {
  const handlers = collectRoutes({ peerRequestOptions })["/api/servers/check-url"];
  let statusCode = 200;
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
  await handlers[handlers.length - 1]({ body }, res);
  return { statusCode, payload };
}

function peerFixture({ status = 200, body = { status: "healthy", secret: "synthetic-not-forwarded" }, address = "192.168.1.20", respond = true } = {}) {
  const calls = [];
  const request = jestObject.fn((url, options, callback) => {
    calls.push({ url, options });
    const outgoing = new EventEmitter();
    outgoing.destroy = () => {};
    outgoing.end = () => {
      if (!respond) return;
      const response = Readable.from([JSON.stringify(body)]);
      response.statusCode = status;
      callback(response);
    };
    return outgoing;
  });
  const lookup = async () => [{ address, family: address.includes(":") ? 6 : 4 }];
  return { calls, options: { request, lookup } };
}

describe("POST /api/servers/check-url", () => {
  test("is registered behind requireAuth", () => {
    const handlers = collectRoutes()["/api/servers/check-url"];
    expect(handlers[0]).toBe(requireAuth);
  });

  test("reports a reachable peer without returning its response body", async () => {
    const peer = peerFixture();
    const result = await checkUrl({ url: "http://peer.invalid:4999" }, peer.options);
    expect(result.statusCode).toBe(200);
    expect(result.payload).toEqual({ reachable: true, status: 200 });
    expect(JSON.stringify(result.payload)).not.toContain("synthetic-not-forwarded");
  });

  test("requests only /api/health on the peer origin", async () => {
    const peer = peerFixture();
    await checkUrl({ url: "http://peer.invalid:4999/some/base" }, peer.options);
    expect(peer.calls).toHaveLength(1);
    expect(peer.calls[0].url.origin).toBe("http://peer.invalid:4999");
    expect(peer.calls[0].url.pathname).toBe("/api/health");
  });

  test("never sends a peer API key", async () => {
    const peer = peerFixture();
    await checkUrl({ url: "http://peer.invalid:4999" }, peer.options);
    expect(peer.calls[0].options.headers["X-API-Key"]).toBeUndefined();
  });

  test("reports a non ok status as not reachable", async () => {
    const peer = peerFixture({ status: 503 });
    const result = await checkUrl({ url: "http://peer.invalid:4999" }, peer.options);
    expect(result.payload).toEqual({ reachable: false, status: 503 });
  });

  test.each([301, 302, 307, 308])("does not follow a %i redirect", async status => {
    const peer = peerFixture({ status });
    const result = await checkUrl({ url: "http://peer.invalid:4999" }, peer.options);
    expect(result.payload).toEqual({ reachable: false, status });
    expect(peer.calls).toHaveLength(1);
  });

  test.each(["127.0.0.1", "169.254.169.254", "::1", "::ffff:169.254.169.254"])(
    "refuses a peer that resolves to %s without sending a request",
    async address => {
      const peer = peerFixture({ address });
      const result = await checkUrl({ url: "http://peer.invalid:4999" }, peer.options);
      expect(result.statusCode).toBe(200);
      expect(result.payload.reachable).toBe(false);
      expect(result.payload.error).toContain("Peer request failed");
      expect(peer.options.request).not.toHaveBeenCalled();
    }
  );

  test("reports a timeout as not reachable", async () => {
    const peer = peerFixture({ respond: false });
    const result = await checkUrl({ url: "http://peer.invalid:4999" }, { ...peer.options, timeoutMs: 20 });
    expect(result.payload.reachable).toBe(false);
    expect(result.payload.error).toContain("Peer request failed");
  });

  test.each([
    undefined,
    "",
    "not a url",
    "peer.invalid:4999",
    "ftp://peer.invalid",
    "http://user:synthetic@peer.invalid",
    "http://peer.invalid/?x=1",
    "http://peer.invalid/#x",
    "http://peer.invalid\\other",
  ])("rejects %s with 400 the same way Save does, without making a request", async url => {
    const peer = peerFixture();
    const result = await checkUrl({ url }, peer.options);
    expect(result.statusCode).toBe(400);
    expect(result.payload.field).toBe("url");
    expect(peer.options.request).not.toHaveBeenCalled();
  });
});
