/**
 * TrueNAS Auto-Discovery Module
 * Automatically detects TrueNAS UI ports and WebSocket endpoints
 */

const fs = require("fs");
const { Logger } = require('./logger');

const logger = new Logger("TrueNAS-Discovery", { debug: process.env.DEBUG === 'true' });

function debugDiscovery(message, ...args) {
  logger.debug(message, ...args);
}

/**
 * Discover TrueNAS UI configuration via Unix socket
 * @param {object} [options={}] - Options object
 * @param {boolean} [options.appDebugEnabled=false] - Whether application-level debug is enabled
 * @returns {Promise<Object|null>} UI configuration or null if failed
 */
async function discoverUIConfig(options = {}) {
  const { appDebugEnabled = false } = options;
  const socketPaths = [
    "/var/run/middlewared.sock",
    "/run/middlewared.sock",
    "/run/middleware/middlewared.sock",
  ];

  for (const socketPath of socketPaths) {
    if (!fs.existsSync(socketPath)) continue;

    try {
      if (appDebugEnabled) {
        debugDiscovery(`Attempting to discover UI config via ${socketPath}`);
      }
      const result = await callSocketMethod(
        socketPath,
        "system.general.config",
        { appDebugEnabled }
      );

      if (result) {
        const config = {
          httpsPort: result.ui_httpsport,
          httpPort: result.ui_port || result.ui_httpport,
          httpsEnabled: result.ui_https || result.ui_httpsredirect,
          address: result.ui_address || "127.0.0.1",
          certificate: result.ui_certificate,
        };

        if (appDebugEnabled) {
          debugDiscovery("Successfully discovered UI config:", config);
        }
        return config;
      }
    } catch (err) {
      if (appDebugEnabled) {
        debugDiscovery(`Failed to discover via ${socketPath}: ${err.message}`);
      }
      try {
        if (appDebugEnabled) {
          debugDiscovery(
            `Trying alternative method name (system.general.config again) for ${socketPath}`
          );
        }
        const result = await callSocketMethod(
          socketPath,
          "system.general.config",
          { appDebugEnabled }
        );
        if (result) {
          const config = {
            httpsPort: result.ui_httpsport,
            httpPort: result.ui_port || result.ui_httpport,
            httpsEnabled: result.ui_https || result.ui_httpsredirect,
            address: result.ui_address || "127.0.0.1",
            certificate: result.ui_certificate,
          };
          if (appDebugEnabled) {
            debugDiscovery(
              "Alternative method call worked for UI config:",
              config
            );
          }
          return config;
        }
      } catch (err2) {
        if (appDebugEnabled) {
          debugDiscovery(
            `Alternative method call also failed for ${socketPath}: ${err2.message}`
          );
        }
      }
    }
  }

  if (appDebugEnabled) {
    debugDiscovery("No UI config discovered from any socket");
  }
  return null;
}

/**
 * Call a method via Unix socket using HTTP protocol
 * @param {string} socketPath Path to Unix socket
 * @param {string} method Method to call
 * @param {object} [options={}] - Options object
 * @param {boolean} [options.appDebugEnabled=false] - Whether application-level debug is enabled
 * @returns {Promise<any>}
 */
function callSocketMethod(socketPath, method, options = {}) {
  const { appDebugEnabled = false } = options;
  return new Promise((resolve, reject) => {
    const http = require("http");

    const body =
      JSON.stringify({ id: 1, msg: "method", method, params: [] }) + "\n";

    const req = http.request(
      {
        socketPath: socketPath,
        path: "/_middleware",
        method: "POST",
        headers: {
          Host: "localhost",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let responseData = "";

        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          try {
            if (appDebugEnabled) {
              debugDiscovery(
                `HTTP response status from ${socketPath} for ${method}: ${res.statusCode}`
              );
            }
            if (res.statusCode !== 200) {
              return reject(
                new Error(`HTTP ${res.statusCode}: ${responseData}`)
              );
            }

            const response = JSON.parse(responseData);

            if (response.error) {
              reject(new Error(JSON.stringify(response.error)));
            } else {
              resolve(response.result);
            }
          } catch (err) {
            reject(
              new Error(
                `Failed to parse response from ${socketPath} for ${method}: ${err.message}`
              )
            );
          }
        });
      }
    );

    req.on("error", (err) => {
      if (appDebugEnabled) {
        debugDiscovery(
          `Socket request error for ${socketPath} method ${method}: ${err.message}`
        );
      }
      reject(err);
    });

    req.setTimeout(5000, () => {
      req.destroy(new Error("Socket timeout"));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Returns a list of host addresses suitable for connecting to the TrueNAS UI, adapting to local or containerized environments.
 *
 * If running inside a container, attempts to detect the default gateway IP and includes additional container-specific addresses.
 * @returns {Array<string>} Array of host addresses to attempt for network connections.
 */
function detectHostAddresses() {
  const hostAddresses = [];

  hostAddresses.push("127.0.0.1", "localhost");

  const isContainerEnvironment =
    process.env.DOCKER_HOST || fs.existsSync("/.dockerenv");

  if (isContainerEnvironment) {
    try {
      const fs = require("fs");
      if (fs.existsSync("/proc/net/route")) {
        const routes = fs.readFileSync("/proc/net/route", "utf8");
        const lines = routes.split("\n");
        for (const line of lines) {
          const fields = line.split("\t");
          if (fields[1] === "00000000" && fields[7] === "00000000") {
            const gatewayHex = fields[2];
            const gateway = [
              parseInt(gatewayHex.substr(6, 2), 16),
              parseInt(gatewayHex.substr(4, 2), 16),
              parseInt(gatewayHex.substr(2, 2), 16),
              parseInt(gatewayHex.substr(0, 2), 16)
            ].join(".");
            
            if (!hostAddresses.includes(gateway)) {
              hostAddresses.unshift(gateway);
            }
            break;
          }
        }
      }
    } catch {
      void 0;
    }
    
    hostAddresses.push("host.docker.internal");
    hostAddresses.push("172.17.0.1");
  }
  
  return hostAddresses;
}

/**
 * Generate WebSocket URLs based on discovered or fallback configuration
 * @param {Object|null} uiConfig Discovered UI configuration
 * @param {object} [options={}] - Options object
 * @param {boolean} [options.appDebugEnabled=false] - Whether application-level debug is enabled
 * @param {boolean} [options.requireSecure=false] - Whether to prioritize secure connections (wss) over insecure (ws)
 * @returns {Array<string>} Array of WebSocket URLs to try
 */
function generateWebSocketURLs(uiConfig = null, options = {}) {
  const { appDebugEnabled = false, requireSecure = false } = options;
  const urls = [];

  const explicitBase = process.env.TRUENAS_WS_BASE;
  if (explicitBase) {
    const normalizedBase = explicitBase.replace(/\/+$/, "");
    let wsBase = normalizedBase.replace(/^http/i, "ws");
    if (requireSecure && /^ws:\/\//i.test(wsBase)) {
      wsBase = wsBase.replace(/^ws:\/\//i, "wss://");
      if (appDebugEnabled) {
        debugDiscovery(
          `TRUENAS_WS_BASE uses insecure scheme; upgrading to secure WebSocket base: ${wsBase}`
        );
      }
    }

    const explicitWsUrl = `${wsBase}/websocket`;
    if (!requireSecure || /^wss:\/\//i.test(explicitWsUrl)) {
      urls.push(explicitWsUrl);
    } else if (appDebugEnabled) {
      debugDiscovery(
        `Ignoring insecure explicit WebSocket URL in secure mode: ${explicitWsUrl}`
      );
    }

    if (appDebugEnabled) {
      debugDiscovery(`Added explicit WebSocket URL: ${explicitWsUrl}`);
    }
    if (urls.length > 0) {
      return urls;
    }
  }

  const hostAddresses = detectHostAddresses({ appDebugEnabled });

  if (uiConfig) {
    if (appDebugEnabled) {
      debugDiscovery(
        "Using discovered UI configuration for WebSocket URLs:",
        uiConfig
      );
    }
    
    if (requireSecure) {
      for (const host of hostAddresses) {
        if (uiConfig.httpsEnabled && uiConfig.httpsPort) {
          const url = `wss://${host}:${uiConfig.httpsPort}/websocket`;
          urls.push(url);
          if (appDebugEnabled) {
            debugDiscovery(`Added discovered HTTPS WebSocket (secure): ${url}`);
          }
        }
      }
    } else {
      for (const host of hostAddresses) {
        if (uiConfig.httpsEnabled && uiConfig.httpsPort) {
          const url = `wss://${host}:${uiConfig.httpsPort}/websocket`;
          urls.push(url);
          if (appDebugEnabled) {
            debugDiscovery(`Added discovered HTTPS WebSocket: ${url}`);
          }
        }

        if (uiConfig.httpPort) {
          const url = `ws://${host}:${uiConfig.httpPort}/websocket`;
          urls.push(url);
          if (appDebugEnabled) {
            debugDiscovery(`Added discovered HTTP WebSocket: ${url}`);
          }
        }
      }
    }
  }

  const shouldUseFallbackPorts =
    !uiConfig || (requireSecure && urls.length === 0);

  if (shouldUseFallbackPorts) {
    if (appDebugEnabled) {
      if (!uiConfig) {
        debugDiscovery("No UI config discovered, using generic fallback ports");
      } else {
        debugDiscovery(
          "No secure WebSocket URL discovered from UI config, using secure fallback ports"
        );
      }
    }
    
    const commonPorts = requireSecure ? [
      { port: 443, protocol: "wss" },
      { port: 8443, protocol: "wss" },
    ] : [
      { port: 443, protocol: "wss" },
      { port: 80, protocol: "ws" },
      { port: 8443, protocol: "wss" },
      { port: 8080, protocol: "ws" },
    ];

    for (const host of hostAddresses) {
      for (const { port, protocol } of commonPorts) {
        const url = `${protocol}://${host}:${port}/websocket`;
        if (!urls.includes(url)) {
          urls.push(url);
        }
      }
    }
  }

  if (appDebugEnabled) {
    debugDiscovery(`Generated ${urls.length} WebSocket URLs to try`);
  }
  return urls;
}

module.exports = {
  discoverUIConfig,
  generateWebSocketURLs,
};
