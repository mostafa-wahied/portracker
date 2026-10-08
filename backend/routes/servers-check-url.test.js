const http = require("http");
const { once } = require("node:events");
const {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} = require("@jest/globals");
const { registerServerRoutes, buildPeerHealthUrl } = require("./servers");

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

async function checkUrl(body, deps) {
  const handlers = collectRoutes(deps)["/api/servers/check-url"];
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

let peer;
let peerUrl;
const peerRequests = [];

beforeAll(async () => {
  peer = http.createServer((req, res) => {
    peerRequests.push(req.url);
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", secret: "not-forwarded" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  peer.listen(0, "127.0.0.1");
  await once(peer, "listening");
  peerUrl = `http://127.0.0.1:${peer.address().port}`;
});

afterAll(async () => {
  peer.close();
  await once(peer, "close");
});

describe("buildPeerHealthUrl", () => {
  test("targets /api/health on the peer origin", () => {
    expect(buildPeerHealthUrl("http://10.0.0.5:4999")).toBe("http://10.0.0.5:4999/api/health");
    expect(buildPeerHealthUrl("https://peer.local/")).toBe("https://peer.local/api/health");
    expect(buildPeerHealthUrl("10.0.0.5:4999")).toBe("http://10.0.0.5:4999/api/health");
    expect(buildPeerHealthUrl("http://peer.local/other/path?x=1#y")).toBe(
      "http://peer.local/api/health"
    );
  });

  test.each([
    "",
    "   ",
    null,
    42,
    "ftp://peer.local",
    "file:///etc/hosts",
    "http://user:pass@peer.local",
    "http://",
  ])("rejects %p", (value) => {
    expect(buildPeerHealthUrl(value)).toBeNull();
  });
});

describe("POST /api/servers/check-url", () => {
  test("is registered behind requireAuth", () => {
    const handlers = collectRoutes()["/api/servers/check-url"];
    expect(handlers[0]).toBe(requireAuth);
  });

  test("reports a reachable peer without returning its body", async () => {
    const result = await checkUrl({ url: peerUrl });
    expect(result).toEqual({ statusCode: 200, payload: { reachable: true, status: 200 } });
    expect(peerRequests).toContain("/api/health");
  });

  test("only requests /api/health even when the url has a path", async () => {
    peerRequests.length = 0;
    await checkUrl({ url: `${peerUrl}/api/servers/local/scan` });
    expect(peerRequests).toEqual(["/api/health"]);
  });

  test("reports a non-ok status from the peer", async () => {
    const fetchImpl = async () => new Response("nope", { status: 503 });
    const result = await checkUrl({ url: peerUrl }, { fetchImpl });
    expect(result.payload).toEqual({ reachable: false, status: 503 });
  });

  test("does not follow redirects", async () => {
    let options = null;
    const fetchImpl = async (_url, opts) => {
      options = opts;
      return new Response(null, { status: 302, headers: { location: "http://elsewhere/" } });
    };
    const result = await checkUrl({ url: peerUrl }, { fetchImpl });
    expect(options.redirect).toBe("manual");
    expect(result.payload).toEqual({ reachable: false, status: 302 });
  });

  test("reports a refused connection", async () => {
    const closed = http.createServer();
    closed.listen(0, "127.0.0.1");
    await once(closed, "listening");
    const { port } = closed.address();
    closed.close();
    await once(closed, "close");

    const result = await checkUrl({ url: `http://127.0.0.1:${port}` });
    expect(result.statusCode).toBe(200);
    expect(result.payload).toEqual({ reachable: false, error: "ECONNREFUSED" });
  });

  test("reports a timeout", async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    const result = await checkUrl({ url: peerUrl }, { fetchImpl, timeoutMs: 20 });
    expect(result.payload).toEqual({ reachable: false, error: "Connection timeout" });
  });

  test("rejects an invalid url without making a request", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
    };
    const result = await checkUrl({ url: "ftp://peer.local" }, { fetchImpl });
    expect(result.statusCode).toBe(400);
    expect(called).toBe(false);
  });
});
