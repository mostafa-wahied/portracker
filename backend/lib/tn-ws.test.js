const { EventEmitter } = require("node:events");
const {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest: jestObject,
  test,
} = require("@jest/globals");

jestObject.mock("ws");
jestObject.mock("./truenas-auto-discover", () => {
  const { jest: mockApi } = require("@jest/globals");
  return { discoverUIConfig: mockApi.fn(), generateWebSocketURLs: mockApi.fn() };
});

const WebSocket = require("ws");
const { discoverUIConfig, generateWebSocketURLs } = require("./truenas-auto-discover");
const { connectWs } = require("./tn-ws");
let sockets;

beforeEach(() => {
  jestObject.useFakeTimers();
  sockets = [];
  discoverUIConfig.mockResolvedValue(null);
  generateWebSocketURLs.mockReturnValue(["wss://truenas.example/websocket"]);
  WebSocket.mockImplementation(() => {
    const socket = new EventEmitter();
    socket.readyState = WebSocket.CONNECTING;
    socket.send = jestObject.fn();
    socket.terminate = jestObject.fn(() => {
      socket.readyState = WebSocket.CLOSED;
      socket.emit("close");
    });
    sockets.push(socket);
    return socket;
  });
});

afterEach(() => {
  jestObject.clearAllTimers();
  jestObject.useRealTimers();
  jestObject.clearAllMocks();
});

describe("TrueNAS WebSocket connection lifecycle", () => {
  test("bounds a connection that never opens and terminates its socket", async () => {
    const pending = connectWs({ apiKey: "test-only", timeoutMs: 100 });
    let failure;
    pending.catch(error => { failure = error; });

    await jestObject.advanceTimersByTimeAsync(101);

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/timed out/i);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].terminate).toHaveBeenCalledTimes(1);
  });

  test("includes discovery and prevents sockets after a late discovery result", async () => {
    let finishDiscovery;
    discoverUIConfig.mockImplementation(() => new Promise(resolve => { finishDiscovery = resolve; }));
    const pending = connectWs({ apiKey: "test-only", timeoutMs: 100 });
    const failure = expect(pending).rejects.toThrow(/timed out/i);

    await jestObject.advanceTimersByTimeAsync(101);
    await failure;
    finishDiscovery(null);
    await jestObject.advanceTimersByTimeAsync(1);

    expect(WebSocket).not.toHaveBeenCalled();
    expect(jestObject.getTimerCount()).toBe(0);
  });

  test("bounds open sockets that never finish the handshake", async () => {
    const pending = connectWs({ apiKey: "test-only", timeoutMs: 100 });
    const failure = expect(pending).rejects.toThrow(/timed out/i);
    await jestObject.advanceTimersByTimeAsync(0);
    sockets[0].readyState = WebSocket.OPEN;
    sockets[0].emit("open");
    await jestObject.advanceTimersByTimeAsync(101);
    await failure;
    expect(sockets[0].terminate).toHaveBeenCalledTimes(1);
    expect(jestObject.getTimerCount()).toBe(0);
  });

  test("shares the deadline across fallback attempts and ignores stale events", async () => {
    generateWebSocketURLs.mockReturnValue([
      "ws://insecure.example/websocket",
      "wss://first.example/websocket",
      "wss://second.example/websocket",
    ]);
    const pending = connectWs({ apiKey: "test-only", timeoutMs: 100 });
    await jestObject.advanceTimersByTimeAsync(51);
    expect(sockets).toHaveLength(2);
    sockets[0].emit("error", new Error("late failure"));
    sockets[0].emit("close");
    authenticate(sockets[1]);
    const session = await pending;
    expect(session.isConnected()).toBe(true);
    expect(WebSocket).toHaveBeenCalledTimes(2);
    session.closeFn();
    expect(jestObject.getTimerCount()).toBe(0);
  });

  test.each([false, { error: { reason: "denied" } }])("rejects unsuccessful authentication without fallback: %j", async result => {
    generateWebSocketURLs.mockReturnValue(["wss://first.example/websocket", "wss://second.example/websocket"]);
    const pending = connectWs({ apiKey: "test-only", timeoutMs: 100 });
    const failure = expect(pending).rejects.toMatchObject({ code: "TRUENAS_AUTH_FAILED" });
    await jestObject.advanceTimersByTimeAsync(0);
    authenticate(sockets[0], result);
    await failure;
    expect(WebSocket).toHaveBeenCalledTimes(1);
    expect(sockets[0].terminate).toHaveBeenCalledTimes(1);
    expect(jestObject.getTimerCount()).toBe(0);
  });

  test("parent cancellation terminates the attempt without trying another endpoint", async () => {
    generateWebSocketURLs.mockReturnValue(["wss://first.example/websocket", "wss://second.example/websocket"]);
    const controller = new AbortController();
    const pending = connectWs({ apiKey: "test-only", signal: controller.signal, timeoutMs: 100 });
    const failure = expect(pending).rejects.toThrow("cancelled");
    await jestObject.advanceTimersByTimeAsync(0);
    controller.abort(new Error("cancelled"));
    await failure;
    expect(WebSocket).toHaveBeenCalledTimes(1);
    expect(sockets[0].terminate).toHaveBeenCalledTimes(1);
    expect(jestObject.getTimerCount()).toBe(0);
  });

  test("rejects in-flight requests on remote close and removes their timers", async () => {
    const pending = connectWs({ apiKey: "test-only", timeoutMs: 100 });
    await jestObject.advanceTimersByTimeAsync(0);
    authenticate(sockets[0]);
    const session = await pending;
    const request = session.requestFn("system.info");
    const failure = expect(request).rejects.toThrow(/closed/i);
    sockets[0].readyState = WebSocket.CLOSED;
    sockets[0].emit("close");
    await failure;
    expect(session.isConnected()).toBe(false);
    expect(jestObject.getTimerCount()).toBe(0);
  });
});

describe("TrueNAS real WebSocket transport", () => {
  test("real TLS WebSocket authenticates and returns RPC data", async () => {
    jestObject.useRealTimers();
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { once } = require("node:events");
    const { execFileSync } = require("node:child_process");
    const https = require("node:https");
    const ActualWebSocket = jestObject.requireActual("ws");
    WebSocket.mockImplementation((...args) => new ActualWebSocket(...args));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "portracker-tls-"));
    let server;
    let websocketServer;
    let session;
    try {
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${directory}/key.pem`, "-out", `${directory}/cert.pem`, "-subj", "/CN=localhost", "-days", "1"], { stdio: "ignore", timeout: 10000 });
      server = https.createServer({ key: fs.readFileSync(`${directory}/key.pem`), cert: fs.readFileSync(`${directory}/cert.pem`) });
      websocketServer = new ActualWebSocket.Server({ server });
      websocketServer.on("connection", socket => {
        socket.on("message", data => {
          const message = JSON.parse(data);
          if (message.msg === "connect") socket.send(JSON.stringify({ msg: "connected" }));
          else if (message.method === "auth.login_with_api_key") socket.send(JSON.stringify({ msg: "result", id: message.id, result: message.params[0] === "test-only" }));
          else socket.send(JSON.stringify({ msg: "result", id: message.id, result: { hostname: "fixture" } }));
        });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      generateWebSocketURLs.mockReturnValue([`wss://127.0.0.1:${server.address().port}/websocket`]);
      session = await connectWs({ apiKey: "test-only", timeoutMs: 1500 });
      await expect(session.requestFn("system.info")).resolves.toEqual({ hostname: "fixture" });
      expect(session.isConnected()).toBe(true);
    } finally {
      session?.closeFn();
      websocketServer?.clients.forEach(socket => socket.terminate());
      if (websocketServer) await new Promise(resolve => websocketServer.close(resolve));
      if (server) await new Promise(resolve => server.close(resolve));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("real TCP endpoint that never negotiates TLS is bounded and cleaned up", async () => {
    jestObject.useRealTimers();
    const net = require("node:net");
    const { once } = require("node:events");
    const ActualWebSocket = jestObject.requireActual("ws");
    WebSocket.mockImplementation((...args) => new ActualWebSocket(...args));
    const connections = new Set();
    const server = net.createServer(socket => {
      connections.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => connections.delete(socket));
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      generateWebSocketURLs.mockReturnValue([`wss://127.0.0.1:${server.address().port}/websocket`]);
      const started = Date.now();
      await expect(connectWs({ apiKey: "test-only", timeoutMs: 100 })).rejects.toThrow(/timed out/i);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      connections.forEach(socket => socket.destroy());
      await new Promise(resolve => server.close(resolve));
    }
  });
});

function authenticate(socket, result = true) {
  socket.readyState = WebSocket.OPEN;
  socket.emit("open");
  socket.emit("message", Buffer.from(JSON.stringify({ msg: "connected" })));
  socket.emit("message", Buffer.from(JSON.stringify({ msg: "result", id: "auth", ...(result?.error ? result : { result }) })));
}