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
  const { appDebugEnabled = false, requireSecure = false } = options;
  try {
    if (appDebugEnabled) {
      debugWS("Attempting to auto-discover TrueNAS UI configuration...");
    }
    const uiConfig = await discoverUIConfig({ appDebugEnabled });

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
async function connectWs(options = {}) {
  const { apiKey, appDebugEnabled = false, host, port } = options;

  if (!apiKey) {
    if (appDebugEnabled) {
      debugWS(
        "connectWs called without an API key. This should not happen if TrueNASClient is working correctly."
      );
    }
    throw new Error("No API key provided for WebSocket authentication");
  }

  const urls = await getTrueNASWebSocketURLs({ appDebugEnabled, host, port, requireSecure: true });
  let ws,
    i = 0;
  let pingInterval = null;
  let authenticated = false;
  let currentConnectionAttempt = null;

  const requestQueue = [];
  let isConnecting = false;

  function next(resolve, reject) {
    if (i >= urls.length) {
      isConnecting = false;
      return reject(new Error("WebSocket connection failed for all endpoints"));
    }

    isConnecting = true;
    const currentUrl = urls[i++];
    if (appDebugEnabled) {
      debugWS(`Attempting connection to ${currentUrl}`);
    }

    if (currentConnectionAttempt && currentConnectionAttempt.timeoutId) {
      clearTimeout(currentConnectionAttempt.timeoutId);
    }

    currentConnectionAttempt = { url: currentUrl };

    ws = new WebSocket(currentUrl, {
      rejectUnauthorized: false,
    });

    ws.once("open", () => {
      if (appDebugEnabled) {
        debugWS(`WebSocket connected to ${currentUrl}, sending handshake`);
      }

      ws.send(
        JSON.stringify({
          msg: "connect",
          version: "1",
          support: ["1"],
        })
      );

      const connectHandler = (data) => {
        try {
          const message = JSON.parse(data);

          if (message.msg === "connected") {
            if (appDebugEnabled) {
              debugWS("WebSocket handshake completed, starting authentication");
            }
            ws.removeListener("message", connectHandler);

            if (appDebugEnabled) {
              debugWS("🔑 Authenticating with API key...");
            }

            const authId = Date.now() + Math.random();
            const authPayload = JSON.stringify({
              id: authId,
              msg: "method",
              method: "auth.login_with_api_key",
              params: [apiKey],
            });

            const authHandler = (authData) => {
              try {
                const authMessage = JSON.parse(authData);

                if (authMessage.id === authId && authMessage.msg === "result") {
                  if (appDebugEnabled) {
                    debugWS("Authentication response received");
                  }
                  ws.removeListener("message", authHandler);
                  clearTimeout(currentConnectionAttempt.authTimeoutId);

                  if (authMessage.error) {
                    if (appDebugEnabled) {
                      debugWS(
                        `Authentication failed for ${currentUrl}:`,
                        authMessage.error
                      );
                    }
                    ws.close();
                    return;
                  } else {
                    if (appDebugEnabled) {
                      debugWS(
                        `Successfully authenticated with API key via ${currentUrl}`
                      );
                    }
                    authenticated = true;
                    isConnecting = false;

                    if (pingInterval) clearInterval(pingInterval);
                    pingInterval = setInterval(() => {
                      if (ws && ws.readyState === WebSocket.OPEN) {
                        if (appDebugEnabled) {
                          debugWS("Sending keep-alive ping");
                        }
                        ws.send(JSON.stringify({ msg: "ping" }));
                      }
                    }, 20000);

                    requestQueue.forEach((queued) => queued.execute());
                    requestQueue.length = 0;

                    resolve({ requestFn: wrappedRequest, closeFn: close });
                  }
                }
              } catch (err) {
                if (appDebugEnabled) {
                  debugWS(
                    `Error parsing authentication response: ${err.message}`
                  );
                }
                ws.removeListener("message", authHandler);
                clearTimeout(currentConnectionAttempt.authTimeoutId);
                ws.close();
              }
            };

            ws.on("message", authHandler);
            ws.send(authPayload);

            currentConnectionAttempt.authTimeoutId = setTimeout(() => {
              if (!authenticated) {
                if (appDebugEnabled) {
                  debugWS(`Authentication timeout for ${currentUrl}`);
                }
                ws.removeListener("message", authHandler);
                ws.close();
              }
            }, 10000);
          }
        } catch (err) {
          if (appDebugEnabled) {
            debugWS(`Error parsing connect message: ${err.message}`);
          }
          ws.close();
        }
      };

      ws.on("message", connectHandler);

      currentConnectionAttempt.connectTimeoutId = setTimeout(() => {
        if (
          !authenticated &&
          ws.readyState !== WebSocket.CLOSED &&
          ws.readyState !== WebSocket.CLOSING
        ) {
          if (appDebugEnabled) {
            debugWS(`WebSocket connection handshake timeout for ${currentUrl}`);
          }
          ws.removeListener("message", connectHandler);
          ws.close();
        }
      }, 10000);
    });

    ws.once("error", (err) => {
      if (appDebugEnabled) {
        debugWS(`WebSocket error for ${currentUrl}: ${err.message}`);
      }
      if (pingInterval) clearInterval(pingInterval);
      clearTimeout(currentConnectionAttempt.connectTimeoutId);
      clearTimeout(currentConnectionAttempt.authTimeoutId);

      if (!authenticated && isConnecting) {
        next(resolve, reject);
      }
    });

    ws.on("close", () => {
      if (appDebugEnabled) {
        debugWS(`WebSocket connection closed for ${currentUrl}`);
      }
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      if (
        !authenticated &&
        isConnecting &&
        currentConnectionAttempt &&
        currentConnectionAttempt.url === currentUrl
      ) {
        if (ws.readyState !== WebSocket.OPEN) {
          next(resolve, reject);
        }
      }
    });
  }

  function wrappedRequest(method, params = []) {
    return new Promise((resolve, reject) => {
      const executeRequest = () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return reject(new Error("WebSocket not connected"));
        }
        if (!authenticated) {
          return reject(new Error("WebSocket not authenticated"));
        }

        const id = Date.now() + Math.random();
        const payload = JSON.stringify({ id, msg: "method", method, params });

        if (appDebugEnabled) {
          debugWS(`Sending authenticated request: ${method} (${id})`);
        }

        const messageHandler = (data) => {
          try {
            const message = JSON.parse(data);
            if (message.id === id && message.msg === "result") {
              if (appDebugEnabled) {
                debugWS(`Received response for ${method} (${id})`);
              }
              ws.removeListener("message", messageHandler);
              clearTimeout(requestTimeoutId);

              if (message.error) {
                const errorMsg =
                  typeof message.error === "object"
                    ? JSON.stringify(message.error)
                    : message.error;
                reject(new Error(errorMsg));
              } else {
                resolve(message.result);
              }
            }
          } catch (err) {
            if (appDebugEnabled) {
              debugWS(`Error parsing message: ${err.message}`);
            }
            ws.removeListener("message", messageHandler);
            clearTimeout(requestTimeoutId);
            reject(
              new Error(`Failed to parse WebSocket message: ${err.message}`)
            );
          }
        };

        ws.on("message", messageHandler);
        ws.send(payload);

        const requestTimeout = parseInt(process.env.TRUENAS_WS_REQUEST_TIMEOUT_MS || '40000', 10);
        const requestTimeoutId = setTimeout(() => {
          ws.removeListener("message", messageHandler);
          reject(new Error(`Request timeout for method ${method} after ${requestTimeout/1000}s`));
        }, requestTimeout);
      };

      if (
        isConnecting ||
        (!authenticated && ws && ws.readyState !== WebSocket.OPEN)
      ) {
        if (appDebugEnabled) {
          debugWS(
            `Queueing request ${method} as WebSocket is connecting/not ready.`
          );
        }
        requestQueue.push({ execute: executeRequest, resolve, reject });
      } else {
        executeRequest();
      }
    });
  }

  function close() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (ws) {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        if (appDebugEnabled) {
          debugWS("Closing WebSocket connection explicitly.");
        }
        authenticated = false;
        isConnecting = false;
        ws.close();
      } else {
        if (appDebugEnabled) {
          debugWS(
            "WebSocket not open or connecting, cannot close (already closed or never opened)."
          );
        }
      }
    } else {
      if (appDebugEnabled) {
        debugWS("No WebSocket instance to close.");
      }
    }
    requestQueue.forEach((queued) =>
      queued.reject(new Error("WebSocket closed while request was queued"))
    );
    requestQueue.length = 0;
  }

  return new Promise((resolve, reject) => {
    next(resolve, reject);
  });
}

module.exports = {
  connectWs,
};
