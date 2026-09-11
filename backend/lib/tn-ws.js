/**
 * TrueNAS WebSocket client library
 * Provides communication with TrueNAS middleware via WebSocket
 */

const WebSocket = require("ws");
const { Logger } = require('./logger');
const {
  discoverUIConfig,
  generateWebSocketURLs,
} = require("./truenas-auto-discover");

const logger = new Logger("TrueNAS-WS", { debug: process.env.DEBUG === 'true' });

function debugWS(message, ...args) {
  logger.debug(message, ...args);
}

/**
 * Get TrueNAS WebSocket URLs to try
 * @param {object} options - Options object
 * @param {boolean} options.appDebugEnabled - Whether application-level debug is enabled
 * @param {boolean} options.requireSecure - Whether to prioritize secure connections (for API key usage)
 */
async function getTrueNASWebSocketURLs(options = {}) {
  const { appDebugEnabled = false, requireSecure = false, signal } = options;
  try {
    if (appDebugEnabled) {
      debugWS("Attempting to auto-discover TrueNAS UI configuration...");
    }
    const uiConfig = await discoverUIConfig({ appDebugEnabled, signal });
    signal?.throwIfAborted();

    if (uiConfig) {
      if (appDebugEnabled) {
        debugWS("Successfully discovered UI configuration");
      }
    } else {
      if (appDebugEnabled) {
        debugWS("Could not discover UI configuration, using fallbacks");
      }
    }

    const urls = generateWebSocketURLs(uiConfig, { appDebugEnabled, requireSecure });
    if (appDebugEnabled) {
      debugWS(`Will try ${urls.length} WebSocket URLs: ${urls.join(", ")}`);
    }

    return urls;
  } catch (err) {
    signal?.throwIfAborted();
    if (appDebugEnabled) {
      debugWS(
        `Error during auto-discovery: ${err.message}, using fallback URLs`
      );
    }
    return generateWebSocketURLs(null, { appDebugEnabled, requireSecure });
  }
}

/**
 * Connect to TrueNAS middleware using WebSocket
 * Tries multiple endpoints with fallback
 * @param {object} options - Options object
 * @param {string} options.apiKey - The TrueNAS API key
 * @param {boolean} [options.appDebugEnabled=false] - Whether application-level debug is enabled
 * @param {string} [options.host] - Optional host for WebSocket connection (used by auto-discover)
 * @param {number} [options.port] - Optional port for WebSocket connection (used by auto-discover)
 * @returns {Promise<Function>} A request function for making middleware calls, and a close function
 */
function timeoutValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withAbort(signal, operation) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function createSession(socket) {
  const pending = new Map();
  let nextId = 0;
  let closed = false;
  const heartbeat = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return close();
    try { socket.send(JSON.stringify({ msg: "ping" })); } catch { close(); }
  }, 20000);
  heartbeat.unref?.();

  function settle(id, error, value) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    request.signal?.removeEventListener("abort", request.abort);
    if (error) request.reject(error);
    else request.resolve(value);
  }

  function receive(data) {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.msg === "result") {
      settle(message.id, message.error ? new Error("TrueNAS request failed") : null, message.result);
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const id of pending.keys()) settle(id, new Error("TrueNAS WebSocket closed"));
    socket.removeListener("message", receive);
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }

  function requestFn(method, params = [], options = {}) {
    return new Promise((resolve, reject) => {
      options.signal?.throwIfAborted();
      if (closed || socket.readyState !== WebSocket.OPEN) {
        return reject(new Error("TrueNAS WebSocket is not connected"));
      }
      const id = ++nextId;
      const timeout = timeoutValue(options.timeoutMs ?? process.env.TRUENAS_WS_REQUEST_TIMEOUT_MS, 40000);
      const timer = setTimeout(() => settle(id, new Error(`TrueNAS request timed out: ${method}`)), timeout);
      const abort = () => settle(id, options.signal.reason);
      pending.set(id, { resolve, reject, timer, signal: options.signal, abort });
      options.signal?.addEventListener("abort", abort, { once: true });
      try { socket.send(JSON.stringify({ id, msg: "method", method, params })); }
      catch (error) { settle(id, error); }
    });
  }

  socket.on("message", receive);
  socket.on("error", close);
  socket.on("close", close);
  return { requestFn, closeFn: close, isConnected: () => !closed && socket.readyState === WebSocket.OPEN };
}

function connectEndpoint(url, apiKey, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const socket = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: timeoutMs });
    let settled = false;
    let authenticating = false;

    function finish(error) {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      socket.removeListener("message", receive);
      socket.removeListener("open", open);
      socket.removeListener("close", disconnected);
      socket.removeListener("error", failed);
      if (error) {
        socket.on("error", () => {});
        socket.terminate();
        reject(error);
      } else {
        resolve(createSession(socket));
      }
    }

    function abort() { finish(signal.reason); }
    function failed() { finish(new Error("TrueNAS WebSocket connection failed")); }
    function disconnected() { finish(new Error("TrueNAS WebSocket closed before authentication")); }
    function send(message) {
      try { socket.send(JSON.stringify(message)); } catch (error) { finish(error); }
    }
    function open() { send({ msg: "connect", version: "1", support: ["1"] }); }

    function receive(data) {
      let message;
      try { message = JSON.parse(data); } catch { return finish(new Error("Invalid TrueNAS handshake response")); }
      if (message.msg === "connected" && !authenticating) {
        authenticating = true;
        send({ id: "auth", msg: "method", method: "auth.login_with_api_key", params: [apiKey] });
      } else if (authenticating && message.id === "auth" && message.msg === "result") {
        if (message.error || message.result !== true) {
          const error = new Error("TrueNAS API authentication rejected; review the configured API key and permissions");
          error.code = "TRUENAS_AUTH_FAILED";
          finish(error);
        } else {
          finish();
        }
      } else if (message.msg === "failed") {
        finish(new Error("TrueNAS WebSocket protocol handshake rejected"));
      }
    }

    signal.addEventListener("abort", abort, { once: true });
    socket.once("open", open);
    socket.on("message", receive);
    socket.once("error", failed);
    socket.once("close", disconnected);
    if (signal.aborted) abort();
  });
}

async function connectWs(options = {}) {
  if (!options.apiKey) throw new Error("No API key provided for WebSocket authentication");
  const timeoutMs = timeoutValue(options.timeoutMs ?? process.env.TRUENAS_WS_CONNECT_TIMEOUT_MS, 10000);
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const expiresAt = Date.now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(new Error("TrueNAS connection timed out")), timeoutMs);
  try {
    const urls = await withAbort(signal, () => getTrueNASWebSocketURLs({ ...options, signal, requireSecure: true }));
    const secureUrls = [...new Set(urls)].filter(url => url.startsWith("wss://"));
    let lastError = new Error("No secure TrueNAS WebSocket endpoints available");
    for (const [index, url] of secureUrls.entries()) {
      signal.throwIfAborted();
      const attempt = new AbortController();
      const budget = Math.max(1, Math.floor((expiresAt - Date.now()) / (secureUrls.length - index)));
      const attemptTimer = setTimeout(() => attempt.abort(new Error("TrueNAS connection attempt timed out")), budget);
      try {
        const session = await connectEndpoint(url, options.apiKey, AbortSignal.any([signal, attempt.signal]), budget);
        if (signal.aborted) { session.closeFn(); signal.throwIfAborted(); }
        return session;
      } catch (error) {
        lastError = error;
        signal.throwIfAborted();
        if (error.code === "TRUENAS_AUTH_FAILED") throw error;
        if (options.appDebugEnabled) logger.debug(`TrueNAS endpoint ${index + 1} failed: ${error.message}`);
      } finally {
        clearTimeout(attemptTimer);
      }
    }
    throw lastError;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  connectWs,
};
