/**
 * TrueNAS JSON-RPC client library
 *
 * Provides communication with TrueNAS middleware primarily via WebSocket.
 * An API key is required for full functionality. If no API key is provided,
 * the client operates in a graceful degradation mode.
 * (Legacy Unix socket connection paths are currently not actively used by this client).
 */

const { connectWs } = require("./tn-ws");
const { Logger } = require('./logger');

/**
 * TrueNAS middleware client using Unix socket first, WebSocket fallback
 */
class TrueNASClient {
  constructor(options = {}) {
    this.logger = new Logger("TrueNAS-RPC", { debug: options.debug || false });
    this.appDebugEnabled = options.debug || false;

    this.client = null;
    this.clientType = null;
    this.connected = false;
    this.apiKey = process.env.TRUENAS_API_KEY || options.apiKey;
    this.host = options.host;
    this.port = options.port;
    this.connectionPromise = null;
    this.connectionController = null;
    this.connectionError = null;
    this.retryAt = 0;
    this.sessionIsConnected = null;
  }

  /**
   * Log error message. This is now an unconditional error log.
   * @param {...any} args Arguments to log
   */
  logError(...args) {
    this.logger.error(...args);
  }

  async connect(options = {}) {
    if (this.connected && this.sessionIsConnected?.()) {
      return;
    }
    this.connected = false;
    if (this.connectionPromise) return this.connectionPromise;
    if (this.connectionError && Date.now() < this.retryAt) {
      throw this.connectionError;
    }
    const controller = new AbortController();
    this.connectionController = controller;
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const pending = this._doConnect({ ...options, signal });
    this.connectionPromise = pending;
    try {
      await pending;
    } finally {
      if (this.connectionPromise === pending) this.connectionPromise = null;
      if (this.connectionController === controller) this.connectionController = null;
    }
  }

  async _doConnect(options = {}) {
    try {
      if (this.appDebugEnabled) {
        this.logger.debug("Attempting WebSocket connection...");
      }

      if (!this.apiKey) {
        throw new Error("TrueNAS enhanced features are not configured");
      }

      if (this.appDebugEnabled) {
        this.logger.debug(
          "API key found - attempting authenticated WebSocket connection"
        );
      }
      const wsConnection = await connectWs({
        apiKey: this.apiKey,
        appDebugEnabled: this.appDebugEnabled,
        host: this.host,
        port: this.port,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      });
      if (options.signal?.aborted) {
        wsConnection.closeFn();
        options.signal.throwIfAborted();
      }
      this.client = wsConnection.requestFn;
      this.wsCloseFn = wsConnection.closeFn;
      this.sessionIsConnected = wsConnection.isConnected;
      this.clientType = "websocket";
      this.connected = true;
      this.connectionError = null;
      this.retryAt = 0;
      if (this.appDebugEnabled) {
        this.logger.info("Connected via WebSocket with authentication");
      }
    } catch (wsError) {
      if (this.appDebugEnabled) {
        this.logger.warn(`WebSocket connection failed: ${wsError.message}`);
      }
  this.logger.error("WebSocket connection error", { err: wsError });
      this.client = null;
      this.clientType = "unavailable";
      this.connected = false;
      this.connectionError = wsError;
      const retryDelay = Number(process.env.TRUENAS_RETRY_DELAY_MS || 60000);
      this.retryAt = wsError.code === "TRUENAS_AUTH_FAILED" ? Infinity :
        Date.now() + (Number.isFinite(retryDelay) && retryDelay > 0 ? retryDelay : 60000);
      throw wsError;
    }
  }

  async call(method, params = [], options = {}) {
    await this.connect(options);

    try {
      if (this.appDebugEnabled) {
        this.logger.debug(`Calling TrueNAS API method: ${method}`);
      }
      const result = await this.client(method, params, options);
      if (this.appDebugEnabled) {
        this.logger.debug(`Received response for ${method}`);
      }
      return result;
    } catch (err) {
      if (this.appDebugEnabled) {
        this.logger.warn(`Error calling TrueNAS API method ${method}:`, err.message);
      }
      this.logger.error(`TrueNAS RPC Error for method '${method}'`, { err });
      throw err;
    }
  }

  close() {
    this.connectionController?.abort(new Error("TrueNAS connection cancelled"));
    if (this.wsCloseFn) {
      if (this.appDebugEnabled) {
        this.logger.debug("Closing TrueNASClient WebSocket connection via wsCloseFn");
      }
      this.wsCloseFn();
      this.wsCloseFn = null;
    }
    this.client = null;
    this.connected = false;
    this.sessionIsConnected = null;
    if (this.appDebugEnabled) {
      this.logger.info("TrueNASClient connection closed and reset.");
    }
  }
}

module.exports = { TrueNASClient };
