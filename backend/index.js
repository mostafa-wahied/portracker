/**
 * PORTS TRACKER - BACKEND SERVER
 *
 * Production-ready backend server for the port tracker application.
 * Provides RESTful API endpoints for server management, port scanning,
 * and system monitoring across multiple deployment platforms.
 */

require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => (globalThis.fetch ? globalThis.fetch(...args) : import('node-fetch').then(m => m.default(...args)));
const { Logger } = require('./lib/logger');
const DockerAPIClient = require('./lib/docker-api');
const { createCollector, detectCollector } = require('./collectors');
const net = require('net');
const db = require('./db');
const https = require("https");
const os = require("os");
const { requireAuth, checkAuthEnabled, isAuthEnabled } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const recoveryManager = require('./lib/recovery-manager');

const logger = new Logger("Server", { debug: process.env.DEBUG === 'true' });
const BASE_DEBUG = process.env.DEBUG === 'true';
const dockerApi = new DockerAPIClient();
const { SimpleTTLCache } = require('./utils/cache');
const responseCache = new SimpleTTLCache();
const RESP_TTL_PORTS = parseInt(process.env.ENDPOINT_CACHE_PORTS_TTL_MS || '3000', 10);
const PORT_SUGGEST_MIN = parseInt(process.env.GENERATE_PORT_MIN || '30000', 10);
const PORT_SUGGEST_MAX = parseInt(process.env.GENERATE_PORT_MAX || '60999', 10);
const PORT_SUGGEST_BIND_HOST = process.env.GENERATE_PORT_BIND_HOST || '0.0.0.0';
const PORT_SUGGEST_MAX_RANDOM_ATTEMPTS = 60;

if (isAuthEnabled()) {
  logger.info('Authentication is ENABLED - Login required for dashboard access');
} else {
  logger.info('Authentication is DISABLED - Dashboard is publicly accessible');
}

const PING_TIMEOUT = 2000;

const pingDebugStats = {
  count: 0,
  startTime: Date.now(),
  lastSummaryTime: Date.now()
};


function logPingDebug(message, force = false) {
  pingDebugStats.count++;
  const now = Date.now();
  
  if (pingDebugStats.count <= 5 || force || (now - pingDebugStats.lastSummaryTime) > 30000) {
    logger.debug(message);
    
    if ((now - pingDebugStats.lastSummaryTime) > 30000) {
      const elapsed = (now - pingDebugStats.startTime) / 1000;
      logger.debug(`[PING SUMMARY] ${pingDebugStats.count} pings processed in ${elapsed.toFixed(1)}s`);
      pingDebugStats.lastSummaryTime = now;
    }
  }
}

const WELL_KNOWN_PORTS = {
  22: { name: 'SSH', type: 'system', description: 'Secure Shell (SSH)' },
  23: { name: 'Telnet', type: 'system', description: 'Telnet protocol' },
  25: { name: 'SMTP', type: 'system', description: 'Simple Mail Transfer Protocol (SMTP)' },
  53: { name: 'DNS', type: 'system', description: 'Domain Name System (DNS)' },
  80: { name: 'HTTP', type: 'web', description: 'Hypertext Transfer Protocol (HTTP)' },
  110: { name: 'POP3', type: 'system', description: 'Post Office Protocol version 3 (POP3)' },
  143: { name: 'IMAP', type: 'system', description: 'Internet Message Access Protocol (IMAP)' },
  443: { name: 'HTTPS', type: 'web', description: 'HTTP Secure (HTTPS)' },
  993: { name: 'IMAPS', type: 'system', description: 'IMAP over SSL' },
  995: { name: 'POP3S', type: 'system', description: 'POP3 over SSL' },
  1433: { name: 'SQL Server', type: 'database', description: 'Microsoft SQL Server database' },
  3306: { name: 'MySQL', type: 'database', description: 'MySQL database' },
  5432: { name: 'PostgreSQL', type: 'database', description: 'PostgreSQL database' },
  6379: { name: 'Redis', type: 'database', description: 'Redis in-memory database' },
  8080: { name: 'HTTP Alt', type: 'web', description: 'HTTP alternative port' },
  8443: { name: 'HTTPS Alt', type: 'web', description: 'HTTPS alternative port' },
  9000: { name: 'Management', type: 'web', description: 'Common management interface port' },
};

function detectServiceType(port, owner) {
  const portNum = parseInt(port, 10);
  
  if (WELL_KNOWN_PORTS[portNum]) {
    return WELL_KNOWN_PORTS[portNum];
  }
  
  if (owner && typeof owner === 'string') {
    const ownerLower = owner.toLowerCase();
    
    if (ownerLower.includes('ssh') || ownerLower.includes('sshd')) {
      return { name: 'SSH', type: 'system', description: 'SSH service' };
    }
    if (ownerLower.includes('nginx') || ownerLower.includes('apache') || ownerLower.includes('httpd')) {
      return { name: 'Web Server', type: 'web', description: 'Web server' };
    }
    if (ownerLower.includes('mysql') || ownerLower.includes('postgres') || ownerLower.includes('redis')) {
      return { name: 'Database', type: 'database', description: 'Database service' };
    }
  }
  
  if (portNum === 80 || portNum === 443 || portNum === 8080 || portNum === 8443 || 
  (portNum >= 3000 && portNum <= 3999) ||
  (portNum >= 4000 && portNum <= 4999) ||
  (portNum >= 8000 && portNum <= 8999) ||
  (portNum >= 9000 && portNum <= 9999)) {
    return { name: 'Web Service', type: 'web', description: 'Web service' };
  }
  
  if (portNum < 1024) {
    return { name: 'System Service', type: 'system', description: 'System service' };
  }
  
  return { name: 'Service', type: 'service', description: 'Application service' };
}

function getDockerHostIP() {
  const platform = os.platform();
  
  if (platform === 'darwin' || platform === 'win32') {
    return "host.docker.internal";
  }
  
  if (isDockerDesktopEnvironment()) {
    return "host.docker.internal";
  }
  
  try {
    if (fs.existsSync('/proc/net/route')) {
      const routes = fs.readFileSync('/proc/net/route', 'utf8');
      const lines = routes.split('\n');
      for (const line of lines) {
        const fields = line.split('\t');
        if (fields[1] === '00000000' && fields[7] === '00000000') {
          const gatewayHex = fields[2];
          const gateway = [
            parseInt(gatewayHex.substr(6, 2), 16),
            parseInt(gatewayHex.substr(4, 2), 16),
            parseInt(gatewayHex.substr(2, 2), 16),
            parseInt(gatewayHex.substr(0, 2), 16)
          ].join('.');
          return gateway;
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to detect Docker host IP from /proc/net/route:', err.message);
  }
  
  return "172.17.0.1";
}


function isDockerDesktopEnvironment() {
  try {
    if (process.env.DOCKER_DESKTOP === 'true') {
      return true;
    }
    
    if (fs.existsSync('/proc/version')) {
      const version = fs.readFileSync('/proc/version', 'utf8');
      if (version.includes('linuxkit') || version.includes('docker-desktop')) {
        return true;
      }
    }
    
    if (fs.existsSync('/proc/net/route')) {
      const routes = fs.readFileSync('/proc/net/route', 'utf8');
      const gatewayLines = routes.split('\n').filter(line => {
        const fields = line.split('\t');
        return fields[1] === '00000000';
      });
      
      for (const line of gatewayLines) {
        const fields = line.split('\t');
        const gatewayHex = fields[2];
        const gateway = [
          parseInt(gatewayHex.substr(6, 2), 16),
          parseInt(gatewayHex.substr(4, 2), 16),
          parseInt(gatewayHex.substr(2, 2), 16),
          parseInt(gatewayHex.substr(0, 2), 16)
        ].join('.');
        
        if (gateway.startsWith('192.168.65.') || gateway.startsWith('172.19.') || gateway.startsWith('172.20.')) {
          return true;
        }
      }
    }
    
    return false;
  } catch (err) {
    logger.debug("Error checking Docker Desktop environment:", { error: err.message });
    return false;
  }
}


async function testProtocol(scheme, host_ip, port, path = "/", isDebugEnabled = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT);
  
  const url = `${scheme}://${host_ip}:${port}${path}`;
  
  try {
    const startTime = Date.now();
    
    try {
      const headResponse = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'PortTracker/1.0',
        },
      });
      
      const duration = Date.now() - startTime;
      
      if (isDebugEnabled) {
        logPingDebug(
          `testProtocol HEAD ${url} -> ${headResponse.status} (${duration}ms)`
        );
      }
      
      if (headResponse.status < 500 && headResponse.status !== 404) {
        clearTimeout(timeout);
        return {
          reachable: true,
          statusCode: headResponse.status,
          protocol: scheme,
          method: 'HEAD',
          responseTime: duration,
        };
      }
    } catch (headError) {
      if (isDebugEnabled) {
        logPingDebug(
          `testProtocol HEAD ${url} failed: ${headError.message}`
        );
      }
    }
    
    try {
      const getStartTime = Date.now();
      const getResponse = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'PortTracker/1.0',
        },
        redirect: 'manual'
      });
      
      const getDuration = Date.now() - getStartTime;
      
      if (isDebugEnabled) {
        logPingDebug(
          `testProtocol GET ${url} -> ${getResponse.status} (${getDuration}ms)`
        );
      }
      
      if (getResponse.status < 500) {
        let isSPA = false;
        
        if (getResponse.status === 404) {
          try {
            const body = await getResponse.text();
            const contentType = getResponse.headers.get('content-type') || '';
            
            if (contentType.includes('text/html') && body.length > 100) {
              const hasDoctype = body.toLowerCase().includes('<!doctype html>') || body.toLowerCase().includes('<html');
              const hasScriptTags = body.toLowerCase().includes('<script');
              const hasMetaTags = body.toLowerCase().includes('<meta');
              const hasAppRoot = body.includes('id="root"') || body.includes('id="app"') || body.includes('id=\'root\'') || body.includes('id=\'app\'');
              
              isSPA = hasDoctype && hasScriptTags && (hasAppRoot || hasMetaTags);
              
              if (isDebugEnabled && isSPA) {
                logPingDebug(
                  `testProtocol detected SPA pattern in 404 response for ${url}`
                );
              }
            }
          } catch (bodyError) {
            if (isDebugEnabled) {
              logPingDebug(
                `testProtocol failed to read body for SPA detection: ${bodyError.message}`
              );
            }
          }
        }
        
        clearTimeout(timeout);
        return {
          reachable: true,
          statusCode: getResponse.status,
          protocol: scheme,
          method: 'GET',
          responseTime: getDuration,
          isSPA: isSPA
        };
      }
    } catch (getError) {
      if (isDebugEnabled) {
        logPingDebug(
          `testProtocol GET ${url} failed: ${getError.message}`
        );
      }
      if (scheme === 'https') {
        try {
          const start = Date.now();
          const permissiveStatus = await new Promise((resolve, reject) => {
            const req = https.request(
              {
                hostname: host_ip,
                port,
                path,
                method: 'GET',
                rejectUnauthorized: false,
                timeout: PING_TIMEOUT,
              },
              (res) => {
                const code = res.statusCode || 200;
                res.resume();
                resolve({ statusCode: code });
              }
            );
            req.on('error', reject);
            req.on('timeout', () => {
              req.destroy(new Error('timeout'));
            });
            req.end();
          });
          const duration = Date.now() - start;
          if (isDebugEnabled) {
            logPingDebug(`testProtocol HTTPS permissive GET ${url} -> ${permissiveStatus.statusCode} (${duration}ms)`);
          }
          if (permissiveStatus.statusCode && permissiveStatus.statusCode < 500) {
            clearTimeout(timeout);
            return {
              reachable: true,
              statusCode: permissiveStatus.statusCode,
              protocol: scheme,
              method: 'GET',
              responseTime: duration,
            };
          }
        } catch (tlsErr) {
          if (isDebugEnabled) {
            logPingDebug(`testProtocol HTTPS permissive attempt failed: ${tlsErr.message}`);
          }
        }
      }
    }
    
    clearTimeout(timeout);
    return { reachable: false, error: 'No successful response' };
    
  } catch (error) {
    clearTimeout(timeout);
    return { reachable: false, error: error.message };
  }
}


/**
 * Determines the status and accessibility of a service based on its type and HTTP(S) response data.
 *
 * Evaluates the service type and the results of HTTP and HTTPS protocol checks to classify the service as accessible, listening, unreachable, or in error. Returns a status object with color coding, descriptive title, and protocol information when applicable.
 *
 * @param {Object} serviceInfo - Metadata about the service, including type, name, and description.
 * @param {Object} httpsResponse - Result of the HTTPS protocol check, including reachability and status code.
 * @param {Object} httpResponse - Result of the HTTP protocol check, including reachability and status code.
 * @return {Object} An object describing the service's status, color, title, description, and protocol if relevant.
 */
function determineServiceStatus(serviceInfo, httpsResponse, httpResponse) {
  const serviceType = serviceInfo.type;
  
  if (serviceType === 'system') {
    return {
      status: 'system',
      color: 'gray',
      title: `${serviceInfo.name} - System service`,
      description: serviceInfo.description
    };
  }
  
  let workingResponse = null;
  
  if (httpsResponse.reachable && httpsResponse.statusCode >= 200 && httpsResponse.statusCode < 300) {
    workingResponse = httpsResponse;
  } else if (httpResponse.reachable && httpResponse.statusCode >= 200 && httpResponse.statusCode < 300) {
    workingResponse = httpResponse;
  } else if (httpsResponse.reachable) {
    workingResponse = httpsResponse;
  } else if (httpResponse.reachable) {
    workingResponse = httpResponse;
  }
  
  if (!workingResponse) {
    return {
      status: 'unreachable',
      color: 'red',
      title: `${serviceInfo.name} - Service not reachable`,
      description: serviceInfo.description
    };
  }
  
  if (serviceType === 'web') {
    const statusCode = workingResponse.statusCode;
    
    if (statusCode >= 200 && statusCode < 400) {
      return {
        status: 'accessible',
        color: 'green',
        title: `${serviceInfo.name} - Web service accessible`,
        description: serviceInfo.description,
        protocol: workingResponse.protocol
      };
    }
    
    if (statusCode === 401) {
      return {
        status: 'accessible',
        color: 'green', 
        title: `${serviceInfo.name} - Web accessible (auth)`,
        description: serviceInfo.description,
        protocol: workingResponse.protocol
      };
    }
    
    if (statusCode === 403) {
      return {
        status: 'listening',
        color: 'yellow',
        title: `${serviceInfo.name} - Listening (Forbidden)`,
        description: serviceInfo.description,
        protocol: workingResponse.protocol
      };
    }
    
    if (statusCode === 405 && workingResponse.method === 'HEAD') {
      return {
        status: 'accessible',
        color: 'green',
        title: `${serviceInfo.name} - Web accessible (GET)`,
        description: serviceInfo.description,
        protocol: workingResponse.protocol
      };
    }
    
    if (statusCode === 404) {
      if (workingResponse.isSPA) {
        return {
          status: 'accessible',
          color: 'green',
          title: `${serviceInfo.name} - Web accessible`,
          description: serviceInfo.description,
          protocol: workingResponse.protocol
        };
      } else {
        return {
          status: 'listening',
          color: 'yellow',
          title: `${serviceInfo.name} - Listening (no web UI)`,
          description: serviceInfo.description,
          protocol: workingResponse.protocol
        };
      }
    }
    
    if (statusCode >= 400 && statusCode < 500) {
      return {
        status: 'accessible',
        color: 'green',
        title: `${serviceInfo.name} - Web accessible (HTTP ${statusCode})`,
        description: serviceInfo.description,
        protocol: workingResponse.protocol
      };
    }
    
    if (statusCode >= 500) {
      return {
        status: 'error',
        color: 'red',
        title: `${serviceInfo.name} - HTTP ${statusCode} error`,
        description: serviceInfo.description,
        protocol: workingResponse.protocol
      };
    }
  }
  
  if (serviceType === 'database' || serviceType === 'service') {
    const statusCode = workingResponse.statusCode;
    
    if (statusCode === 401) {
      return {
        status: 'accessible',
        color: 'green',
        title: `${serviceInfo.name} - HTTP accessible (auth)`,
        description: serviceInfo.description,
        protocol: workingResponse.protocol
      };
    }
    
    if (statusCode === 403) {
      return {
        status: 'listening',
        color: 'yellow',
        title: `${serviceInfo.name} - Listening (Forbidden)`,
        description: serviceInfo.description,
        protocol: workingResponse.protocol
      };
    }
    
    if (statusCode < 500) {
      return {
        status: 'accessible',
        color: 'green',
        title: `${serviceInfo.name} - HTTP accessible`,
        description: serviceInfo.description,
        protocol: workingResponse.protocol
      };
    } else {
      return {
        status: 'listening',
        color: 'yellow',
        title: `${serviceInfo.name} - Service listening (not HTTP)`,
        description: serviceInfo.description
      };
    }
  }
  
  return {
    status: 'listening',
    color: 'yellow',
    title: `${serviceInfo.name} - Service listening`,
    description: serviceInfo.description
  };
}

try {
  const columns = db.prepare("PRAGMA table_info(servers)").all();
  const columnNames = columns.map((col) => col.name);

  if (!columnNames.includes("type")) {
    logger.warn(
      'Database schema migration may be needed. The "servers" table "type" column is missing.'
    );
    logger.warn(
      "This might affect functionality. Consider checking database setup or migrations."
    );
  } else {
    logger.info("Database schema verification successful.");
  }
  db.ensureLocalServer(process.env.PORT || 3000);
} catch (error) {
  logger.fatal("Database verification failed:", error.message);
  logger.debug("Stack trace:", error.stack || "");
}

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const sessionSecret = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');

if (!process.env.SESSION_SECRET) {
  logger.warn('No SESSION_SECRET set - using random secret (sessions will not persist across restarts)');
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: 'portracker.sid',
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

logger.info('Session middleware configured');

if (isAuthEnabled()) {
  logger.info('Authentication is ENABLED - Login required for dashboard access');
} else {
  logger.info('Authentication is DISABLED - Dashboard is publicly accessible');
}

app.use(checkAuthEnabled);

app.use('/api/auth', authRoutes);

const PORT = process.env.PORT || 3000;

/**
 * Get all ports from the local system using the collector framework.
 */
app.get("/api/ports", async (req, res) => {
  const debug = req.query.debug === "true";
  if (Object.prototype.hasOwnProperty.call(req.query, 'debug')) logger.setDebugEnabled(debug);
  const cacheKey = 'endpoint:ports:local';
  if (!debug && process.env.DISABLE_CACHE !== 'true') {
      const cached = responseCache.get(cacheKey);
      if (cached) {
        if (process.env.DEBUG === 'true') logger.debug('ports-endpoint cache hit local');
        return res.json({ cached: true, ttlMs: RESP_TTL_PORTS, data: cached });
      }
      if (process.env.DEBUG === 'true') logger.debug('ports-endpoint cache miss local');
  }
  
  logger.debug(`GET /api/ports called with debug=${debug}`);
  
  try {
    const entries = [];
    const dockerCollector = createCollector("docker", { debug });
    const dockerPorts = await dockerCollector.getPorts();
    entries.push(...dockerPorts);
    const systemCollector = createCollector("system", { debug });
    const systemPorts = await systemCollector.getPorts();
    entries.push(...systemPorts);

    const normalized = entries
      .filter((e) => e.host_port && e.host_ip)
      .reduce((acc, entry) => {
        const key = `${entry.host_ip}:${entry.host_port}:${entry.protocol}`;
        if (!acc[key]) {
          acc[key] = {
            ...entry,
            owners: [entry.owner],
            pids: [entry.pid].filter(Boolean),
          };
        } else {
          if (!acc[key].owners.includes(entry.owner)) {
            acc[key].owners.push(entry.owner);
          }
          if (entry.pid && !acc[key].pids.includes(entry.pid)) {
            acc[key].pids.push(entry.pid);
          }
        }
        return acc;
      }, {});

    const payload = Object.values(normalized).map((e) => ({
      ...e,
      owner: e.owners.join(", "),
    }));
    if (!debug && process.env.DISABLE_CACHE !== 'true') {
      responseCache.set(cacheKey, payload, RESP_TTL_PORTS);
    }
    res.json({ cached: false, ttlMs: RESP_TTL_PORTS, data: payload });
  } catch (error) {
    logger.error("Error in GET /api/ports:", error.message);
    logger.debug("Stack trace:", error.stack || "");
    res
      .status(500)
      .json({ error: "Failed to scan ports", details: error.message });
  } finally {
    if (Object.prototype.hasOwnProperty.call(req.query, 'debug')) logger.setDebugEnabled(BASE_DEBUG);
  }
});

/**
 * New peer-based endpoint to replace remote API connectivity.
 */
app.get("/api/all-ports", async (req, res) => {
  const debug = req.query.debug === "true" || process.env.DEBUG === 'true';
  if (Object.prototype.hasOwnProperty.call(req.query, 'debug')) logger.setDebugEnabled(debug);
  
  logger.debug(`GET /api/all-ports called with debug=${debug}`);
  
  try {
    const servers = db.prepare("SELECT * FROM servers").all();

    const results = servers.map((s) => ({
      id: s.id,
      server: s.label,
      ok: s.id === "local",
      error: s.id !== "local" ? "Peer communication not yet implemented" : null,
      data: s.id === "local" ? [] : [],
      parentId: s.parentId,
      platform_type: s.platform_type || "unknown",
    }));

    const localServerResult = results.find((s) => s.id === "local");
    if (localServerResult) {
      try {
        const localPorts = await getLocalPortsUsingCollectors({ debug });
        localServerResult.data = localPorts;
        localServerResult.ok = true;
      } catch (localError) {
        logger.error("Failed to get local ports for /api/all-ports:", localError.message);
        localServerResult.ok = false;
        localServerResult.error = `Failed to collect local ports: ${localError.message}`;
      }
    }

    res.json(results);
  } catch (error) {
    logger.error("Error in GET /api/all-ports:", error.message);
    logger.debug("Stack trace:", error.stack || "");
    res
      .status(500)
      .json({ error: "Failed to process all ports", details: error.message });
  } finally {
    if (Object.prototype.hasOwnProperty.call(req.query, 'debug')) logger.setDebugEnabled(BASE_DEBUG);
  }
});

/**
 * Collects and returns the list of open ports on the local system using the most suitable platform-specific collector.
 * @param {Object} [options] - Optional settings for port collection.
 * @param {boolean} [options.debug] - Enables debug logging if true.
 * @return {Promise<Array>} Resolves with an array of port information objects.
 */
async function getLocalPortsUsingCollectors(options = {}) {
  const currentDebug = options.debug || false;

  try {
    logger.debug("[getLocalPortsUsingCollectors] Starting port collection...");

    const collector = await detectCollector({ debug: currentDebug });
    logger.debug(`[getLocalPortsUsingCollectors] Detected collector: ${collector?.platform}`);

    const ports = await collector.getPorts();
    logger.debug(`[getLocalPortsUsingCollectors] Collected ${ports?.length || 0} ports.`);
    
    return ports;
  } catch (error) {
    logger.error("[getLocalPortsUsingCollectors] Primary collection attempt failed:", error.message);
    logger.debug("Stack trace:", error.stack || "");
    throw error;
  }
}

function getPortRangeForSuggestion() {
  const floor = 1024;
  const ceiling = 65535;
  let min = Number.isInteger(PORT_SUGGEST_MIN) ? PORT_SUGGEST_MIN : 30000;
  let max = Number.isInteger(PORT_SUGGEST_MAX) ? PORT_SUGGEST_MAX : 60999;

  if (min < floor) min = floor;
  if (max > ceiling) max = ceiling;
  if (min >= max) {
    min = 30000;
    max = 60999;
  }
  return { min, max };
}

function buildReservedPortSet() {
  const reserved = new Set();
  Object.keys(WELL_KNOWN_PORTS).forEach((p) => {
    const num = parseInt(p, 10);
    if (!Number.isNaN(num)) reserved.add(num);
  });
  const appPort = parseInt(process.env.PORT || "3000", 10);
  if (!Number.isNaN(appPort)) reserved.add(appPort);
  [3000, 3001, 5173, 8080, 8443].forEach((p) => reserved.add(p));
  return reserved;
}

function getUsedPortsFromEntries(entries) {
  const set = new Set();
  (entries || []).forEach((entry) => {
    const hp = parseInt(entry.host_port, 10);
    if (!Number.isNaN(hp) && hp > 0) {
      set.add(hp);
    }
  });
  return set;
}

function testTcpPortAvailable(port, host = PORT_SUGGEST_BIND_HOST, timeoutMs = 750) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      server.close(() => resolve(result));
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    server.once("error", () => {
      clearTimeout(timer);
      finish(false);
    });

    server.listen({ port, host, exclusive: true }, () => {
      clearTimeout(timer);
      finish(true);
    });
  });
}

function reservePortsAndMerge(reserved, used) {
  for (const p of reserved) {
    used.add(p);
  }
}

async function generateUnusedPortWithSet(usedPortsInput, { bindCheck = false, method = "scan-only" } = {}) {
  const { min, max } = getPortRangeForSuggestion();
  const reservedPorts = buildReservedPortSet();
  const usedPorts = new Set(usedPortsInput || []);
  reservePortsAndMerge(reservedPorts, usedPorts);

  const rangeSize = max - min + 1;
  if (rangeSize <= 0) {
    throw new Error("Invalid port range for generation");
  }

  const seen = new Set();
  const attemptLimit = Math.min(rangeSize, PORT_SUGGEST_MAX_RANDOM_ATTEMPTS);

  const isCandidateFree = async (candidate) => {
    if (usedPorts.has(candidate)) return false;
    if (!bindCheck) return true;
    return testTcpPortAvailable(candidate);
  };

  for (let i = 0; i < attemptLimit; i++) {
    const candidate = min + Math.floor(Math.random() * rangeSize);
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    if (await isCandidateFree(candidate)) {
      return {
        port: candidate,
        meta: {
          range: { min, max },
          attempts: i + 1,
          method,
          bindHost: PORT_SUGGEST_BIND_HOST,
          checkedPorts: Array.from(seen.values()),
          usedCount: usedPorts.size,
        },
      };
    }
  }

  for (let candidate = min; candidate <= max; candidate++) {
    if (await isCandidateFree(candidate)) {
      return {
        port: candidate,
        meta: {
          range: { min, max },
          attempts: attemptLimit + (candidate - min + 1),
          method,
          bindHost: PORT_SUGGEST_BIND_HOST,
          checkedPorts: Array.from(seen.values()).concat(candidate),
          usedCount: usedPorts.size,
        },
      };
    }
  }

  throw new Error("No available port found in the configured range");
}

async function generateUnusedPortLocal({ debug = false, bindCheck = true } = {}) {
  const ports = await getLocalPortsUsingCollectors({ debug });
  const usedPorts = getUsedPortsFromEntries(ports);
  return generateUnusedPortWithSet(usedPorts, { bindCheck, method: bindCheck ? "scan+bind" : "scan-only" });
}

async function generateUnusedPortFromPortList(portEntries, { bindCheck = false, method = "scan-only" } = {}) {
  const usedPorts = getUsedPortsFromEntries(portEntries || []);
  return generateUnusedPortWithSet(usedPorts, { bindCheck, method });
}

/**
 * New endpoint to scan a server with the appropriate collector
 */
app.get("/api/servers/:id/scan", async (req, res) => {
  const serverId = req.params.id;
  const currentDebug = req.query.debug === "true" || process.env.DEBUG === 'true';
  
  if (Object.prototype.hasOwnProperty.call(req.query, 'debug')) logger.setDebugEnabled(currentDebug);
  
  logger.debug(`GET /api/servers/${serverId}/scan called with debug=${currentDebug}`);

  try {
    const server = db
      .prepare("SELECT * FROM servers WHERE id = ?")
      .get(serverId);

    if (!server) {
      logger.warn(`[GET /api/servers/${serverId}/scan] Server not found.`);
      return res.status(404).json({ error: "Server not found" });
    }

    if (serverId === "local") {
      const platformType = server.platform_type || "auto";
      let collector;

      logger.debug(`[GET /api/servers/local/scan] Local server platform_type: ${platformType}`);

      if (platformType === "auto") {
        collector = await detectCollector({ debug: currentDebug });
      } else {
        collector = createCollector(platformType, { debug: currentDebug });
      }

      const collectData = await collector.collectAll();

      if (collectData.ports && Array.isArray(collectData.ports)) {
        const enrichedPorts = collectData.ports.map((port) => {
          const internalFlag = port.internal ? 1 : 0;
          const noteEntry = db
            .prepare(
              "SELECT note FROM notes WHERE server_id = 'local' AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?"
            )
            .get(port.host_ip, port.host_port, port.protocol, port.container_id || null, port.container_id || null, internalFlag);
          const ignoreEntry = db
            .prepare(
              "SELECT 1 FROM ignores WHERE server_id = 'local' AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?"
            )
            .get(port.host_ip, port.host_port, port.protocol, port.container_id || null, port.container_id || null, internalFlag);
          return {
            ...port,
            note: noteEntry ? noteEntry.note : null,
            ignored: !!ignoreEntry,
          };
        });
        collectData.ports = enrichedPorts;
      }

      if (
        platformType === "auto" &&
        collectData.platform &&
        server.platform_type !== collectData.platform
      ) {
        db.updateLocalServerPlatformType(collectData.platform);
      }
      logger.debug(
        `Local scan complete. Collector: ${
          collector?.platform
        }, Apps: ${collectData.apps?.length || 0}, Ports: ${
          collectData.ports?.length || 0
        }, VMs: ${collectData.vms?.length || 0}`
      );
      return res.json(collectData);
    }

    if (server.type === "peer" && server.url) {
      logger.debug(`[GET /api/servers/${serverId}/scan] Attempting to scan remote peer at URL: ${server.url}`);
      
      try {
        const peerScanUrl = new URL("/api/servers/local/scan", server.url).href;
        logger.debug(`[GET /api/servers/${serverId}/scan] Fetching from peer URL: ${peerScanUrl}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        try {
          const peerResponse = await fetch(peerScanUrl, { 
            signal: controller.signal 
          });
          clearTimeout(timeoutId);

          if (!peerResponse.ok) {
            let errorBody = "Peer responded with an error.";
            try {
              errorBody = await peerResponse.text();
            } catch { void 0; }
            logger.warn(
              `[GET /api/servers/${serverId}/scan] Peer server at ${server.url} responded with status ${peerResponse.status}. Body: ${errorBody}`
            );
            return res.status(peerResponse.status).json({
              error: `Peer server scan failed with status ${peerResponse.status}`,
              details: errorBody,
              serverId: serverId,
              peerUrl: server.url,
            });
          }

          const peerScanData = await peerResponse.json();
          
          logger.debug(`Peer scan complete: ${server.label} (${serverId})`);
          return res.json(peerScanData);
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError') {
            logger.error(
              `[GET /api/servers/${serverId}/scan] Timeout after 15s communicating with peer ${server.label} at ${server.url}`
            );
            return res.status(408).json({
              error: "Request timeout - peer server took too long to respond",
              details: "Connection timed out after 15 seconds",
              serverId: serverId,
              peerUrl: server.url,
            });
          }
          throw fetchError;
        }
      } catch (fetchError) {
        logger.error(
          `[GET /api/servers/${serverId}/scan] Failed to fetch scan data from peer ${server.label} at ${server.url}: ${fetchError.message}`
        );
        return res.status(502).json({
          error: "Failed to communicate with peer server",
          details: fetchError.message,
          serverId: serverId,
          peerUrl: server.url,
        });
      }
    } else {
      logger.warn(
        `[GET /api/servers/${serverId}/scan] Cannot scan server: Not 'local' and not a valid 'peer' with a URL.`
      );
      return res.status(501).json({
        error:
          "Server scanning not possible for this server type or configuration",
        server_id: serverId,
      });
    }
  } catch (error) {
    logger.error(`Error in GET /api/servers/${serverId}/scan: ${error.message}`);
    logger.debug("Stack trace:", error.stack || "");
    res
      .status(500)
      .json({ error: "Failed to scan server", details: error.message });
  } finally {
    if (Object.prototype.hasOwnProperty.call(req.query, 'debug')) logger.setDebugEnabled(BASE_DEBUG);
  }
});

/**
 * Generate an unused TCP port for the given server.
 * - For local: uses collectors to find used ports, excludes well-known/reserved, then validates with a TCP bind test.
 * - For peers: forwards the request to the peer's /api/servers/local/generate-port endpoint.
 */
app.post("/api/servers/:id/generate-port", async (req, res) => {
  const serverId = req.params.id;
  const currentDebug = req.query.debug === "true" || process.env.DEBUG === 'true';
  if (Object.prototype.hasOwnProperty.call(req.query, 'debug')) logger.setDebugEnabled(currentDebug);

  try {
    const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(serverId);
    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    if (serverId === "local") {
      const suggestion = await generateUnusedPortLocal({ debug: currentDebug, bindCheck: true });
      return res.json({
        port: suggestion.port,
        meta: suggestion.meta,
      });
    }

    if (server.type === "peer" && server.url) {
      const peerUrl = new URL("/api/servers/local/generate-port", server.url).href;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const peerResponse = await fetch(peerUrl, { method: "POST", signal: controller.signal });
        clearTimeout(timeoutId);

        if (peerResponse.ok) {
          const payload = await peerResponse.json();
          return res.json(payload);
        }

        if (peerResponse.status === 404 || peerResponse.status === 405 || peerResponse.status === 501) {
          logger.warn(`[generate-port] Peer ${server.label} missing generate endpoint, falling back to scan.`);
          try {
            const scanUrl = new URL("/api/servers/local/scan", server.url).href;
            const scanResponse = await fetch(scanUrl, { method: "GET", signal: controller.signal });

            if (scanResponse.ok) {
              const scanData = await scanResponse.json();
              const suggestion = await generateUnusedPortFromPortList(scanData?.ports || [], { bindCheck: false, method: "scan-only-peer-fallback" });
              return res.json({
                port: suggestion.port,
                meta: {
                  ...suggestion.meta,
                  fallbackUsed: true,
                  fallbackReason: "peer-generate-port-missing",
                },
              });
            }
          } catch (fallbackError) {
            logger.warn(`[generate-port] Peer scan fallback failed for ${server.label}: ${fallbackError.message}`);
          }
        }

        const body = await peerResponse.text().catch(() => "");
        return res.status(peerResponse.status).json({
          error: "Peer port generation failed",
          details: body || `Status ${peerResponse.status}`,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        const errMsg = err.name === "AbortError" ? "Peer request timed out" : err.message;
        logger.error(`[generate-port] Failed to reach peer ${server.label} (${server.url}): ${errMsg}`);
        return res.status(502).json({
          error: "Failed to reach peer for port generation",
          details: errMsg,
        });
      }
    }

    return res.status(501).json({
      error: "Port generation not supported for this server type",
      server_id: serverId,
    });
  } catch (error) {
    logger.error(`Error in POST /api/servers/${serverId}/generate-port: ${error.message}`);
    logger.debug("Stack trace:", error.stack || "");
    return res.status(500).json({
      error: "Failed to generate port",
      details: error.message,
    });
  } finally {
    if (Object.prototype.hasOwnProperty.call(req.query, 'debug')) logger.setDebugEnabled(BASE_DEBUG);
  }
});

function validateServerInput(req, res, next) {
  const { label, url, type, platform_type } = req.body;
  if (!label || typeof label !== "string" || label.trim().length === 0) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "Field 'label' is required and must be a non-empty string",
        field: "label",
      });
  }
  if (
    type === "peer" &&
    url &&
    typeof url === "string" &&
    url.trim().length > 0
  ) {
    try {
      new URL(url.trim());
    } catch {
      return res
        .status(400)
        .json({
          error: "Validation failed",
          details:
            "Field 'url' must be a valid URL format if provided for a peer",
          field: "url",
        });
    }
  } else if (
    type === "peer" &&
    (!url || url.trim().length === 0) &&
    !req.body.unreachable
  ) {
    return res.status(400).json({
      error: "Validation failed",
      details: "Peer servers must include a valid URL unless marked unreachable",
      field: "url",
    });
  }

  req.body.type = type || "peer";
  req.body.platform_type = platform_type || "unknown";
  req.body.label = label.trim();
  req.body.url = url ? url.trim() : null;
  next();
}

function validateNoteInput(req, res, next) {
  const { server_id, host_ip, host_port, protocol, container_id, internal } = req.body;
  if (!server_id || typeof server_id !== "string") {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "Field 'server_id' is required and must be a string",
        field: "server_id",
      });
  }
  if (!host_ip || typeof host_ip !== "string") {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "Field 'host_ip' is required and must be a string",
        field: "host_ip",
      });
  }
  if (
    host_port === undefined ||
    host_port === null ||
    !Number.isInteger(Number(host_port))
  ) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details:
          "Field 'host_port' is required and must be a valid port number",
        field: "host_port",
      });
  }
  if (!protocol || typeof protocol !== "string" || (protocol !== "tcp" && protocol !== "udp")) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "Field 'protocol' is required and must be either 'tcp' or 'udp'",
        field: "protocol",
      });
  }
  if (container_id !== undefined && container_id !== null && (typeof container_id !== "string" || container_id.trim() === "")) {
    return res
      .status(400)
      .json({
        error: "Invalid input for note entry",
        details: "container_id must be a non-empty string when provided",
        field: "container_id",
      });
  }
  if (internal !== undefined && internal !== null && typeof internal !== "boolean") {
    return res
      .status(400)
      .json({
        error: "Invalid input for note entry",
        details: "internal must be a boolean when provided",
        field: "internal",
      });
  }
  const serverExists = db
    .prepare("SELECT id FROM servers WHERE id = ?")
    .get(server_id);
  if (!serverExists) {
    return res
      .status(404)
      .json({
        error: "Validation failed",
        details: `Server with id '${server_id}' not found`,
        field: "server_id",
      });
  }
  next();
}

/**
 * Middleware that validates the presence and format of the server ID parameter in the request.
 * Responds with a 400 error if the ID is missing or not a non-empty string.
 */
function validateServerIdParam(req, res, next) {
  const serverId = req.params.id;
  if (
    !serverId ||
    typeof serverId !== "string" ||
    serverId.trim().length === 0
  ) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details:
          "Server ID parameter is required and must be a non-empty string",
        field: "id",
      });
  }
  next();
}

/**
 * Middleware that validates input for custom service name operations.
 * Validates server_id, host_ip, host_port, custom_name, and container_id fields.
 */
function validateCustomServiceNameInput(req, res, next) {
  const { server_id, host_ip, host_port, protocol, custom_name, container_id, internal } = req.body;

  if (!server_id || typeof server_id !== "string" || server_id.trim().length === 0) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "server_id is required and must be a non-empty string",
        field: "server_id",
      });
  }

  if (!host_ip || typeof host_ip !== "string" || host_ip.trim().length === 0) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "host_ip is required and must be a non-empty string",
        field: "host_ip",
      });
  }

  if (host_port == null || !Number.isInteger(host_port) || host_port <= 0 || host_port > 65535) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "host_port is required and must be a valid port number (1-65535)",
        field: "host_port",
      });
  }

  if (!protocol || typeof protocol !== "string" || (protocol !== "tcp" && protocol !== "udp")) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "Field 'protocol' is required and must be either 'tcp' or 'udp'",
        field: "protocol",
      });
  }

  if (custom_name != null && (typeof custom_name !== "string" || custom_name.trim().length === 0)) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "custom_name must be a non-empty string when provided",
        field: "custom_name",
      });
  }

  if (container_id != null && (typeof container_id !== "string" || container_id.trim().length === 0)) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "container_id must be a non-empty string when provided",
        field: "container_id",
      });
  }

  if (internal !== undefined && internal !== null && typeof internal !== "boolean") {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "internal must be a boolean when provided",
        field: "internal",
      });
  }

  next();
}

/**
 * Middleware that validates input for ignore operations.
 * Validates server_id, host_ip, host_port, protocol, ignored, and container_id fields.
 */
function validateIgnoreInput(req, res, next) {
  const { server_id, host_ip, host_port, protocol, ignored, container_id, internal } = req.body;

  if (!server_id || typeof server_id !== "string" || server_id.trim().length === 0) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "server_id is required and must be a non-empty string",
        field: "server_id",
      });
  }

  if (!host_ip || typeof host_ip !== "string" || host_ip.trim().length === 0) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "host_ip is required and must be a non-empty string",
        field: "host_ip",
      });
  }

  if (host_port == null || !Number.isInteger(host_port) || host_port <= 0 || host_port > 65535) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "host_port is required and must be a valid port number (1-65535)",
        field: "host_port",
      });
  }

  if (!protocol || typeof protocol !== "string" || (protocol !== "tcp" && protocol !== "udp")) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "Field 'protocol' is required and must be either 'tcp' or 'udp'",
        field: "protocol",
      });
  }

  if (typeof ignored !== "boolean") {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "ignored is required and must be a boolean",
        field: "ignored",
      });
  }

  if (container_id != null && (typeof container_id !== "string" || container_id.trim().length === 0)) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "container_id must be a non-empty string when provided",
        field: "container_id",
      });
  }

  if (internal !== undefined && internal !== null && typeof internal !== "boolean") {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "internal must be a boolean when provided",
        field: "internal",
      });
  }

  next();
}

/**
 * Middleware that validates input for custom service name delete operations.
 * Validates server_id, host_ip, host_port, protocol, and container_id fields.
 */
function validateCustomServiceNameDeleteInput(req, res, next) {
  const { server_id, host_ip, host_port, protocol, container_id, internal } = req.body;

  if (!server_id || typeof server_id !== "string" || server_id.trim().length === 0) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "server_id is required and must be a non-empty string",
        field: "server_id",
      });
  }

  if (!host_ip || typeof host_ip !== "string" || host_ip.trim().length === 0) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "host_ip is required and must be a non-empty string",
        field: "host_ip",
      });
  }

  if (host_port == null || !Number.isInteger(host_port) || host_port <= 0 || host_port > 65535) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "host_port is required and must be a valid port number (1-65535)",
        field: "host_port",
      });
  }

  if (!protocol || typeof protocol !== "string" || (protocol !== "tcp" && protocol !== "udp")) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "Field 'protocol' is required and must be either 'tcp' or 'udp'",
        field: "protocol",
      });
  }

  if (container_id != null && (typeof container_id !== "string" || container_id.trim().length === 0)) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "container_id must be a non-empty string when provided",
        field: "container_id",
      });
  }

  if (internal !== undefined && internal !== null && typeof internal !== "boolean") {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "internal must be a boolean when provided",
        field: "internal",
      });
  }

  next();
}

app.get("/api/servers", requireAuth, (req, res) => {
  logger.debug("GET /api/servers");
  try {
    const stmt = db.prepare(
      "SELECT id, label, url, parentId, type, unreachable, platform_type FROM servers"
    );
    const servers = stmt.all();
    logger.debug(`Returning ${servers.length} servers`);
    res.json(servers);
  } catch (error) {
    logger.error("Failed to get servers:", error.message);
    logger.debug("Stack trace:", error.stack || "");
    res
      .status(500)
      .json({ error: "Failed to retrieve servers", details: error.message });
  }
});

app.post("/api/servers", requireAuth, validateServerInput, (req, res) => {
  const { id, label, url, parentId, type, unreachable, platform_type } =
    req.body;

  if (!id) {
    return res.status(400).json({ error: "Field 'id' is required" });
  }

  if (type === "peer" && !unreachable && (!url || url.trim().length === 0)) {
    return res
      .status(400)
      .json({
        error: "Validation failed",
        details: "Field 'url' is required for reachable peer servers",
        field: "url",
      });
  }

  const dbUnreachable = unreachable ? 1 : 0;

  try {
    const existing = db.prepare("SELECT id FROM servers WHERE id = ?").get(id);
    if (existing) {
      db.prepare(
        "UPDATE servers SET label = ?, url = ?, parentId = ?, type = ?, unreachable = ?, platform_type = ? WHERE id = ?"
      ).run(
        label,
        url,
        parentId || null,
        type,
        dbUnreachable,
        platform_type,
        id
      );
      logger.info(`Server updated successfully. ID: ${id}, Label: "${label}"`);
      res.status(200).json({ message: "Server updated successfully", id });
    } else {
      db.prepare(
        "INSERT INTO servers (id, label, url, parentId, type, unreachable, platform_type) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(
        id,
        label,
        url,
        parentId || null,
        type,
        dbUnreachable,
        platform_type
      );
      logger.info(`Server added successfully. ID: ${id}, Label: "${label}"`);
      res.status(201).json({ message: "Server added successfully", id });
    }
  } catch (error) {
    logger.error(`Database error in POST /api/servers (ID: ${id}): ${error.message}`);
    logger.debug("Stack trace:", error.stack || "");
    if (error.message.includes("UNIQUE constraint failed")) {
      return res
        .status(409)
        .json({ error: `Server with ID '${id}' already exists.` });
    }
    if (
      error.message.toLowerCase().includes("can only bind") ||
      error.message.toLowerCase().includes("datatype mismatch")
    ) {
      logger.error(
        `Possible data binding/type issue for server ID ${id}. Payload received: ${JSON.stringify(req.body)}`
      );
      return res
        .status(500)
        .json({
          error: "Failed to save server due to data type issue.",
          details: error.message,
        });
    }
    res
      .status(500)
      .json({ error: "Failed to save server", details: error.message });
  }
});

app.delete("/api/servers/:id", requireAuth, validateServerIdParam, (req, res) => {
  const serverId = req.params.id;
  const currentDebug = req.query.debug === "true";
  
  if (currentDebug) logger.setDebugEnabled(true);

  logger.debug(`[DELETE /api/servers/${serverId}] Request received.`);

  try {
    const server = db
      .prepare("SELECT id, label FROM servers WHERE id = ?")
      .get(serverId);
    if (!server) {
      logger.warn(`[DELETE /api/servers/${serverId}] Attempt to delete non-existent server.`);
      return res
        .status(404)
        .json({ error: "Server not found", server_id: serverId });
    }

    if (serverId === "local") {
      logger.warn(`[DELETE /api/servers/${serverId}] Attempt to delete 'local' server.`);
      return res
        .status(400)
        .json({ error: "Cannot delete local server", server_id: serverId });
    }

    const deleteTransaction = db.transaction(() => {
      db.prepare("UPDATE servers SET parentId = NULL WHERE parentId = ?").run(
        serverId
      );
      db.prepare("DELETE FROM notes WHERE server_id = ?").run(serverId);
      db.prepare("DELETE FROM ignores WHERE server_id = ?").run(serverId);
      db.prepare("DELETE FROM servers WHERE id = ?").run(serverId);
    });
    deleteTransaction();

    logger.info(`Server deleted successfully. ID: ${serverId}, Label: "${server.label}"`);
    res.json({
      success: true,
      message: `Server '${server.label}' (ID: ${serverId}) deleted successfully`,
    });
  } catch (err) {
    if (err.message.includes("FOREIGN KEY constraint failed")) {
      logger.error(`FOREIGN KEY constraint failed during DELETE /api/servers/${serverId}: ${err.message}`);
      logger.debug("Stack trace:", err.stack || "");
      return res.status(409).json({
        error: "Conflict deleting server",
        details:
          "Cannot delete server due to existing references. Ensure all child items or dependencies are handled.",
        rawError: err.message,
      });
    }
    logger.error(`Database error in DELETE /api/servers/${serverId}: ${err.message}`);
    logger.debug("Stack trace:", err.stack || "");
    res
      .status(500)
      .json({
        error: "Database operation failed",
        details: "Unable to delete server",
        rawError: err.message,
      });
  } finally {
    if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
  }
});

app.post("/api/notes", requireAuth, validateNoteInput, (req, res) => {
  const { server_id, host_ip, host_port, protocol, note, container_id, internal } = req.body;
  const currentDebug = req.query.debug === "true";
  const noteTrimmed = note ? note.trim() : "";
  const internalFlag = internal ? 1 : 0;

  if (currentDebug) logger.setDebugEnabled(true);

  logger.debug(`POST /api/notes for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag}). Note: "${noteTrimmed}"`);

  try {
    const existing = db
      .prepare(
        "SELECT server_id FROM notes WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?"
      )
      .get(server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internalFlag);
    if (existing) {
      if (noteTrimmed === "") {
        db.prepare(
          "DELETE FROM notes WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?"
        ).run(server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internalFlag);
        logger.info(`Note deleted for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag})`);
      } else {
        db.prepare(
          "UPDATE notes SET note = ?, updated_at = datetime('now') WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?"
        ).run(noteTrimmed, server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internalFlag);
        logger.info(`Note updated for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag})`);
      }
    } else if (noteTrimmed !== "") {
      db.prepare(
        "INSERT INTO notes (server_id, host_ip, host_port, protocol, container_id, internal, note) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(server_id, host_ip, host_port, protocol, container_id || null, internalFlag, noteTrimmed);
      logger.info(`Note created for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag})`);
    }
    res.status(200).json({ success: true, message: "Note saved successfully" });
  } catch (err) {
    logger.error(`Database error in POST /api/notes: ${err.message}`);
    logger.debug("Stack trace:", err.stack || "");
    res
      .status(500)
      .json({
        error: "Database operation failed",
        details: "Unable to save note",
      });
  } finally {
    if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
  }
});

app.get("/api/notes", requireAuth, (req, res) => {
  const { server_id } = req.query;
  const currentDebug = req.query.debug === "true";

  if (currentDebug) logger.setDebugEnabled(true);

  logger.debug(`GET /api/notes for server_id: ${server_id}`);

  if (!server_id) {
    return res
      .status(400)
      .json({ error: "server_id query parameter is required" });
  }

  try {
    const notes = db
      .prepare("SELECT host_ip, host_port, protocol, container_id, internal, note FROM notes WHERE server_id = ?")
      .all(server_id);
    res.json(notes);
  } catch (err) {
    logger.error(`Database error in GET /api/notes: ${err.message}`);
    logger.debug("Stack trace:", err.stack || "");
    res
      .status(500)
      .json({
        error: "Database operation failed",
        details: "Unable to retrieve notes",
      });
  } finally {
    if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
  }
});

app.post("/api/ignores", requireAuth, validateIgnoreInput, (req, res) => {
  const { server_id, host_ip, host_port, protocol, ignored, container_id, internal } = req.body;
  const currentDebug = req.query.debug === "true";

  if (currentDebug) logger.setDebugEnabled(true);

  const internalFlag = internal ? 1 : 0;
  logger.debug(`POST /api/ignores for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag}). Ignored: ${ignored}`);

  try {
    const existing = db
      .prepare(
        "SELECT server_id FROM ignores WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?"
      )
      .get(server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internalFlag);

    if (ignored) {
      if (!existing) {
        db.prepare(
          "INSERT INTO ignores (server_id, host_ip, host_port, protocol, container_id, internal) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(server_id, host_ip, host_port, protocol, container_id || null, internalFlag);
        logger.info(`Port ignored for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag})`);
      } else {
        logger.debug(`Port already ignored for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag}), no change.`);
      }
    } else {
      if (existing) {
        db.prepare(
          "DELETE FROM ignores WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?"
        ).run(server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internalFlag);
        logger.info(`Port un-ignored for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag})`);
      } else {
        logger.debug(`Port already not ignored for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag}), no change.`);
      }
    }
    res.status(200).json({ success: true, message: "Ignore status updated" });
  } catch (err) {
    logger.error(`Database error in POST /api/ignores: ${err.message}`);
    logger.debug("Stack trace:", err.stack || "");
    res
      .status(500)
      .json({
        error: "Database operation failed",
        details: "Unable to update ignore status",
      });
  } finally {
    if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
  }
});

app.get("/api/ignores", requireAuth, (req, res) => {
  const { server_id } = req.query;
  const currentDebug = req.query.debug === "true";

  if (currentDebug) logger.setDebugEnabled(true);

  logger.debug(`GET /api/ignores for server_id: ${server_id}`);

  if (!server_id) {
    return res
      .status(400)
      .json({ error: "server_id query parameter is required" });
  }

  try {
    const ignores = db
      .prepare("SELECT host_ip, host_port, protocol, container_id, internal FROM ignores WHERE server_id = ?")
      .all(server_id);
    res.json(ignores.map((item) => ({ ...item, ignored: true })));
  } catch (err) {
    logger.error(`Database error in GET /api/ignores: ${err.message}`);
    logger.debug("Stack trace:", err.stack || "");
    res
      .status(500)
      .json({
        error: "Database operation failed",
        details: "Unable to retrieve ignores",
      });
  } finally {

    if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
  }
});

app.post("/api/custom-service-names", requireAuth, validateCustomServiceNameInput, (req, res) => {
  const { server_id, host_ip, host_port, protocol, custom_name, original_name, container_id, internal } = req.body;
  const currentDebug = req.query.debug === "true";

  if (currentDebug) logger.setDebugEnabled(true);

  const internalFlag = internal ? 1 : 0;
  logger.debug(`POST /api/custom-service-names for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag}). Custom name: "${custom_name}"`);

  try {
    const existing = db
      .prepare(
        "SELECT server_id FROM custom_service_names WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?"
      )
      .get(server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internalFlag);

    if (existing) {
      db.prepare(
        "UPDATE custom_service_names SET custom_name = ?, original_name = ?, updated_at = datetime('now') WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?"
      ).run(custom_name, original_name || null, server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internalFlag);
      logger.info(`Custom service name updated for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag})`);
    } else {
      db.prepare(
        "INSERT INTO custom_service_names (server_id, host_ip, host_port, protocol, container_id, internal, custom_name, original_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(server_id, host_ip, host_port, protocol, container_id || null, internalFlag, custom_name, original_name || null);
      logger.info(`Custom service name created for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag})`);
    }

    if (!container_id && !internal && host_ip === "0.0.0.0") {
      const ipv6Existing = db
        .prepare(
          "SELECT server_id FROM custom_service_names WHERE server_id = ? AND host_ip = '::' AND host_port = ? AND protocol = ? AND container_id IS NULL AND internal = 0"
        )
        .get(server_id, host_port, protocol);

      if (ipv6Existing) {
        db.prepare(
          "UPDATE custom_service_names SET custom_name = ?, original_name = ?, updated_at = datetime('now') WHERE server_id = ? AND host_ip = '::' AND host_port = ? AND protocol = ? AND container_id IS NULL AND internal = 0"
        ).run(custom_name, original_name || null, server_id, host_port, protocol);
        logger.info(`Custom service name updated for ${server_id} [::]:${host_port}/${protocol} (IPv6 variant)`);
      } else {
        try {
          db.prepare(
            "INSERT INTO custom_service_names (server_id, host_ip, host_port, protocol, container_id, internal, custom_name, original_name) VALUES (?, '::',  ?, ?, ?, ?, ?, ?)"
          ).run(server_id, host_port, protocol, null, 0, custom_name, original_name || null);
          logger.info(`Custom service name created for ${server_id} [::]:${host_port}/${protocol} (IPv6 variant)`);
        } catch (insertError) {
          logger.debug(`Could not create IPv6 variant for ${server_id} [::]:${host_port}/${protocol}: ${insertError.message}`);
        }
      }
    } else if (!container_id && !internal && host_ip === "::") {
      const ipv4Existing = db
        .prepare(
          "SELECT server_id FROM custom_service_names WHERE server_id = ? AND host_ip = '0.0.0.0' AND host_port = ? AND protocol = ? AND container_id IS NULL AND internal = 0"
        )
        .get(server_id, host_port, protocol);

      if (ipv4Existing) {
        db.prepare(
          "UPDATE custom_service_names SET custom_name = ?, original_name = ?, updated_at = datetime('now') WHERE server_id = ? AND host_ip = '0.0.0.0' AND host_port = ? AND protocol = ? AND container_id IS NULL AND internal = 0"
        ).run(custom_name, original_name || null, server_id, host_port, protocol);
        logger.info(`Custom service name updated for ${server_id} 0.0.0.0:${host_port}/${protocol} (IPv4 variant)`);
      } else {
        try {
          db.prepare(
            "INSERT INTO custom_service_names (server_id, host_ip, host_port, protocol, container_id, internal, custom_name, original_name) VALUES (?, '0.0.0.0', ?, ?, ?, ?, ?, ?)"
          ).run(server_id, host_port, protocol, null, 0, custom_name, original_name || null);
          logger.info(`Custom service name created for ${server_id} 0.0.0.0:${host_port}/${protocol} (IPv4 variant)`);
        } catch (insertError) {
          logger.debug(`Could not create IPv4 variant for ${server_id} 0.0.0.0:${host_port}/${protocol}: ${insertError.message}`);
        }
      }
    }

    responseCache.delete('endpoint:ports:local');

    res.status(200).json({ success: true, message: "Custom service name saved successfully" });
  } catch (err) {
    logger.error(`Database error in POST /api/custom-service-names: ${err.message}`);
    logger.debug("Stack trace:", err.stack || "");
    res
      .status(500)
      .json({
        error: "Database operation failed",
        details: "Unable to save custom service name",
      });
  } finally {
    if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
  }
});

app.get("/api/custom-service-names", requireAuth, (req, res) => {
  const { server_id } = req.query;
  const currentDebug = req.query.debug === "true";

  if (currentDebug) logger.setDebugEnabled(true);

  logger.debug(`GET /api/custom-service-names for server_id: ${server_id}`);

  if (!server_id) {
    return res
      .status(400)
      .json({ error: "server_id query parameter is required" });
  }

  try {
    const customNames = db
      .prepare("SELECT host_ip, host_port, protocol, container_id, internal, custom_name, original_name FROM custom_service_names WHERE server_id = ?")
      .all(server_id);
    res.json(customNames);
  } catch (err) {
    logger.error(`Database error in GET /api/custom-service-names: ${err.message}`);
    logger.debug("Stack trace:", err.stack || "");
    res
      .status(500)
      .json({
        error: "Database operation failed",
        details: "Unable to retrieve custom service names",
      });
  } finally {
    if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
  }
});

app.delete("/api/custom-service-names", requireAuth, validateCustomServiceNameDeleteInput, (req, res) => {
  const { server_id, host_ip, host_port, protocol, container_id, internal } = req.body;
  const currentDebug = req.query.debug === "true";

  if (currentDebug) logger.setDebugEnabled(true);

  const internalFlag = internal ? 1 : 0;
  logger.debug(`DELETE /api/custom-service-names for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''} (internal: ${internalFlag})`);

  try {
    const result = db
      .prepare("DELETE FROM custom_service_names WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?")
      .run(server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internalFlag);

    let deletedCount = result.changes;

    /**
     * If no rows were deleted and we have a container_id, try deleting without container_id
     * This handles legacy records that were created before container_id support
     */
    if (deletedCount === 0 && container_id) {
      const legacyResult = db
        .prepare("DELETE FROM custom_service_names WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND container_id IS NULL AND internal = ?")
        .run(server_id, host_ip, host_port, protocol, internalFlag);
      deletedCount += legacyResult.changes;
      if (legacyResult.changes > 0) {
        logger.info(`Custom service name deleted for ${server_id} ${host_ip}:${host_port}/${protocol} (legacy record without container_id)`);
      }
    }

    if (!container_id && !internal && host_ip === "0.0.0.0") {
      const ipv6Result = db
        .prepare("DELETE FROM custom_service_names WHERE server_id = ? AND host_ip = '::' AND host_port = ? AND protocol = ? AND container_id IS NULL AND internal = 0")
        .run(server_id, host_port, protocol);
      deletedCount += ipv6Result.changes;
      if (ipv6Result.changes > 0) {
        logger.info(`Custom service name deleted for ${server_id} [::]:${host_port}/${protocol} (IPv6 variant)`);
      }
    } else if (!container_id && !internal && host_ip === "::") {
      const ipv4Result = db
        .prepare("DELETE FROM custom_service_names WHERE server_id = ? AND host_ip = '0.0.0.0' AND host_port = ? AND protocol = ? AND container_id IS NULL AND internal = 0")
        .run(server_id, host_port, protocol);
      deletedCount += ipv4Result.changes;
      if (ipv4Result.changes > 0) {
        logger.info(`Custom service name deleted for ${server_id} 0.0.0.0:${host_port}/${protocol} (IPv4 variant)`);
      }
    }

    if (deletedCount > 0) {
      logger.info(`Custom service name deleted for ${server_id} ${host_ip}:${host_port}/${protocol}${container_id ? ` (container: ${container_id})` : ''}`);
      
      responseCache.delete('endpoint:ports:local');
      
      res.status(200).json({ success: true, message: "Custom service name deleted successfully" });
    } else {
      res.status(404).json({ error: "Custom service name not found" });
    }
  } catch (err) {
    logger.error(`Database error in DELETE /api/custom-service-names: ${err.message}`);
    logger.debug("Stack trace:", err.stack || "");
    res
      .status(500)
      .json({
        error: "Database operation failed",
        details: "Unable to delete custom service name",
      });
  } finally {
    if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
  }
});

app.post("/api/custom-service-names/batch", requireAuth, (req, res) => {
  const { server_id, operations } = req.body;
  const currentDebug = req.query.debug === "true";

  if (currentDebug) logger.setDebugEnabled(true);

  logger.debug(`POST /api/custom-service-names/batch for ${server_id}. Operations: ${operations?.length || 0}`);

  if (!server_id || typeof server_id !== "string" || server_id.trim().length === 0) {
    return res
      .status(400)
      .json({ error: "server_id is required and must be a non-empty string" });
  }

  if (!operations || !Array.isArray(operations) || operations.length === 0) {
    return res
      .status(400)
      .json({ error: "operations array is required and must not be empty" });
  }

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (!op || typeof op !== "object") {
      return res
        .status(400)
        .json({ error: `Operation at index ${i} must be an object` });
    }

    const { action, host_ip, host_port, protocol, custom_name, container_id, internal } = op;

    if (!["set", "delete"].includes(action)) {
      return res
        .status(400)
        .json({ error: `Operation at index ${i}: action must be "set" or "delete"` });
    }

    if (!host_ip || typeof host_ip !== "string" || host_ip.trim().length === 0) {
      return res
        .status(400)
        .json({ error: `Operation at index ${i}: host_ip is required and must be a non-empty string` });
    }

    if (host_port == null || !Number.isInteger(host_port) || host_port <= 0 || host_port > 65535) {
      return res
        .status(400)
        .json({ error: `Operation at index ${i}: host_port must be a valid port number (1-65535)` });
    }

    if (!protocol || typeof protocol !== "string" || (protocol !== "tcp" && protocol !== "udp")) {
      return res
        .status(400)
        .json({ error: `Operation at index ${i}: protocol is required and must be either 'tcp' or 'udp'` });
    }

    if (action === "set" && (custom_name == null || typeof custom_name !== "string" || custom_name.trim().length === 0)) {
      return res
        .status(400)
        .json({ error: `Operation at index ${i}: custom_name is required for "set" action` });
    }

    if (container_id != null && (typeof container_id !== "string" || container_id.trim().length === 0)) {
      return res
        .status(400)
        .json({ error: `Operation at index ${i}: container_id must be a non-empty string when provided` });
    }

    if (internal !== undefined && internal !== null && typeof internal !== "boolean") {
      return res
        .status(400)
        .json({ error: `Operation at index ${i}: internal must be a boolean when provided` });
    }
  }

  try {
    const results = [];
    
    for (const op of operations) {
      const { action, host_ip, host_port, protocol, custom_name, original_name, container_id, internal } = op;
      
      if (action === "set") {
        const existing = db
          .prepare(
            "SELECT server_id FROM custom_service_names WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?"
          )
          .get(server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internal ? 1 : 0);

        if (existing) {
          db.prepare(
            "UPDATE custom_service_names SET custom_name = ?, original_name = ?, updated_at = datetime('now') WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?"
          ).run(custom_name, original_name || null, server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internal ? 1 : 0);
          results.push({ host_ip, host_port, protocol, container_id, action: "updated" });
        } else {
          db.prepare(
            "INSERT INTO custom_service_names (server_id, host_ip, host_port, protocol, container_id, internal, custom_name, original_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).run(server_id, host_ip, host_port, protocol, container_id || null, internal ? 1 : 0, custom_name, original_name || null);
          results.push({ host_ip, host_port, protocol, container_id, action: "created" });
        }
      } else if (action === "delete") {
        const result = db
          .prepare("DELETE FROM custom_service_names WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?")
          .run(server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internal ? 1 : 0);
        
        results.push({ 
          host_ip, 
          host_port, 
          protocol,
          container_id,
          action: result.changes > 0 ? "deleted" : "not_found" 
        });
      }
    }

    logger.info(`Batch custom service name operation completed for ${server_id}. ${results.length} operations processed.`);
    
    responseCache.delete('endpoint:ports:local');
    
    res.status(200).json({ success: true, results });
  } catch (err) {
    logger.error(`Database error in POST /api/custom-service-names/batch: ${err.message}`);
    logger.debug("Stack trace:", err.stack || "");
    res
      .status(500)
      .json({
        error: "Database operation failed",
        details: "Unable to process batch custom service name operations",
      });
  } finally {
    if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
  }
});

app.post("/api/notes/batch", requireAuth, (req, res) => {
  const { server_id, operations } = req.body;
  const currentDebug = req.query.debug === "true";

  if (currentDebug) logger.setDebugEnabled(true);

  logger.debug(`POST /api/notes/batch for ${server_id}. Operations: ${operations?.length || 0}`);

  if (!server_id || !Array.isArray(operations)) {
    return res.status(400).json({ error: "server_id and operations array are required" });
  }

  try {
    const results = [];

    for (const operation of operations) {
      const { action, host_ip, host_port, protocol, note, container_id, internal } = operation;
      
      if (!action || !host_ip || host_port == null) {
        results.push({ success: false, error: "Missing required fields: action, host_ip, host_port" });
        continue;
      }

      if (!Number.isInteger(host_port) || host_port <= 0 || host_port > 65535) {
        results.push({ success: false, error: "host_port must be a valid port number (1-65535)" });
        continue;
      }

      if (!protocol || typeof protocol !== "string" || (protocol !== "tcp" && protocol !== "udp")) {
        results.push({ success: false, error: "protocol is required and must be either 'tcp' or 'udp'" });
        continue;
      }

      const internalFlag = internal ? 1 : 0;

      try {
        if (action === "set" && note) {
          const noteTrimmed = note.trim();
          if (noteTrimmed) {
            const existingNote = db
              .prepare("SELECT server_id FROM notes WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?")
              .get(server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internalFlag);

            if (existingNote) {
              db.prepare("UPDATE notes SET note = ?, updated_at = CURRENT_TIMESTAMP WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?")
                .run(noteTrimmed, server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internalFlag);
            } else {
              db.prepare("INSERT INTO notes (server_id, host_ip, host_port, protocol, container_id, internal, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
                .run(server_id, host_ip, host_port, protocol, container_id || null, internalFlag, noteTrimmed);
            }
            results.push({ success: true, action: "set", host_ip, host_port, container_id, internal: internalFlag });
          }
        } else if (action === "delete") {
          const result = db
            .prepare("DELETE FROM notes WHERE server_id = ? AND host_ip = ? AND host_port = ? AND protocol = ? AND (container_id = ? OR (container_id IS NULL AND ? IS NULL)) AND internal = ?")
            .run(server_id, host_ip, host_port, protocol, container_id || null, container_id || null, internalFlag);
          results.push({ success: true, action: "delete", host_ip, host_port, container_id, internal: internalFlag, deletedCount: result.changes });
        }
      } catch (opError) {
        logger.error(`Error in batch note operation: ${opError.message}`);
        results.push({ success: false, error: opError.message, host_ip, host_port, container_id });
      }
    }

    responseCache.delete('endpoint:ports:local');
    
    logger.info(`Batch note operation completed for ${server_id}. ${results.length} operations processed.`);
    res.status(200).json({ success: true, results });

  } catch (err) {
    logger.error(`Database error in POST /api/notes/batch: ${err.message}`);
    logger.debug("Stack trace:", err.stack || "");
    res.status(500).json({
      error: "Database operation failed",
      details: "Unable to process batch note operations",
    });
  } finally {
    if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
  }
});

app.get("/api/ping", async (req, res) => {
  const { host_ip, host_port, target_server_url, owner, internal, container_id, source } = req.query;
  const serverId = req.query.server_id;
  const currentDebug = req.query.debug === "true";
  
  if (currentDebug) logger.setDebugEnabled(true);
  
  if (!host_ip || !host_port) {
    return res
      .status(400)
      .json({ error: "host_ip and host_port are required" });
  }
  const portNum = parseInt(host_port, 10);
  if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
    return res.status(400).json({ error: "Invalid host_port" });
  }
  
  const serviceInfo = detectServiceType(host_port, owner);

  if (internal === 'true' && container_id) {
    if (serverId && serverId !== 'local') {
      try {
        const row = db.prepare('SELECT url FROM servers WHERE id = ?').get(serverId);
        if (!row || !row.url) {
          return res.status(400).json({ error: 'server url not found for remote ping' });
        }
        const base = row.url.replace(/\/$/, '');
        const params = new URLSearchParams();
        params.set('internal', 'true');
        params.set('container_id', container_id);
        if (host_ip) params.set('host_ip', host_ip);
        if (host_port) params.set('host_port', host_port);
        if (owner) params.set('owner', owner);
        if (source) params.set('source', source);
        if (currentDebug) params.set('debug', 'true');
        const url = `${base}/api/ping?${params.toString()}`;
        const resp = await fetch(url, { headers: { 'accept': 'application/json' } });
        const text = await resp.text();
        let body; try { body = JSON.parse(text); } catch { body = text; }
        return res.status(resp.status).send(body);
      } catch (e) {
        logger.error(`[GET /api/ping] Remote proxy to ${serverId} failed:`, e.message);
        logger.debug('Stack trace:', e.stack || '');
        return res.status(502).json({ error: 'failed to proxy remote ping' });
      }
    }
    try {
      await dockerApi._ensureConnected?.();
    } catch {
      void 0;
    }
    const health = await (dockerApi.getContainerHealth ? dockerApi.getContainerHealth(container_id) : Promise.resolve({ status: 'unknown', health: 'unknown' }));

    const state = (health.status || '').toLowerCase();
    const h = (health.health || '').toLowerCase();
    let color = 'gray';
    let status = 'unknown';
    let title = 'Container status unknown';

    if (state === 'running') {
      if (h === 'healthy') {
        color = 'green';
        status = 'reachable';
        title = 'Container healthy';
      } else if (h === 'starting' || h === 'none' || h === 'unhealthy' || h === 'unknown') {
        color = h === 'unhealthy' ? 'yellow' : 'yellow';
        status = 'unknown';
        title = h === 'unhealthy' ? 'Container unhealthy' : 'Container running';
      } else {
        color = 'yellow';
        status = 'unknown';
        title = 'Container running';
      }
    } else if (state === 'exited' || state === 'dead' || state === 'created') {
      color = 'red';
      status = 'unreachable';
      title = 'Container not running';
    }

    return res.json({
      reachable: color === 'green',
      status,
      color,
      title,
      protocol: null,
      serviceType: 'service',
      serviceName: serviceInfo.name,
      description: 'Internal port status based on container health'
    });
  }
  
  if (serviceInfo.type === 'system' || source === 'system') {
    return res.json({
      reachable: true,
      status: 'system',
      color: 'gray',
      title: source === 'system' ? 'System service' : serviceInfo.description,
      serviceType: 'system',
      serviceName: source === 'system' ? 'System Service' : serviceInfo.name
    });
  }

  let pingable_host_ip = host_ip;
  
  const isInDocker = process.env.RUNNING_IN_DOCKER === "true" || 
                     fs.existsSync("/.dockerenv") || 
                     fs.existsSync("/proc/self/cgroup") && 
                     fs.readFileSync("/proc/self/cgroup", "utf8").includes("docker");
  if (
    target_server_url &&
    (host_ip === "0.0.0.0" ||
      host_ip === "127.0.0.1" ||
      host_ip === "[::]" ||
      host_ip === "[::1]")
  ) {
    try {
      const peerUrlObj = new URL(target_server_url);
      pingable_host_ip = peerUrlObj.hostname;
      logPingDebug(
        `Using peer server hostname '${pingable_host_ip}' for generic host_ip '${host_ip}' on port ${host_port}`
      );
    } catch (e) {
      logger.error(`[GET /api/ping] Invalid target_server_url: ${target_server_url} - ${e.message}`);
    }
  } else if (
    (host_ip === "0.0.0.0" ||
      host_ip === "127.0.0.1" ||
      host_ip === "[::]" ||
      host_ip === "[::1]")
  ) {
    if (isInDocker) {
      const dockerHostIP = getDockerHostIP();
      pingable_host_ip = dockerHostIP;
      logPingDebug(
        `Detected Docker environment, using host IP '${dockerHostIP}' for port ${host_port}`
      );
    } else {
      pingable_host_ip = "localhost";
      logPingDebug(
      );
    }
  } else {
    logPingDebug(`Using provided host_ip '${host_ip}' for port ${host_port}`);
  }
  
  const isImportantService = serviceInfo.type !== 'service' || portNum <= 1024;
  if (currentDebug && (pingDebugStats.count <= 3 || isImportantService)) {
    logger.debug(`Testing ${serviceInfo.name} (${serviceInfo.type}) on ${pingable_host_ip}:${portNum}`);
  }

  const httpsResponse = await testProtocol("https", pingable_host_ip, portNum, "/", currentDebug);
  const httpResponse = await testProtocol("http", pingable_host_ip, portNum, "/", currentDebug);
  
  const result = determineServiceStatus(serviceInfo, httpsResponse, httpResponse);
  
  if (currentDebug && (pingDebugStats.count <= 3 || result.status === 'unreachable')) {
    logger.debug(`Service status for ${pingable_host_ip}:${portNum} -> ${result.status} (${result.color})`);
  }
  
  res.json({
    reachable: result.status !== 'unreachable',
    status: result.status,
    color: result.color,
    title: result.title,
    protocol: result.protocol || null,
    serviceType: serviceInfo.type,
    serviceName: serviceInfo.name,
    description: result.description
  });
  

  if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
});

app.get("/api/health", (req, res) => {
  logger.debug("Health check requested");
  try {
    db.prepare("SELECT 1").get();
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    logger.debug("Health check successful");
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptimeSeconds: uptime,
      memory: { rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)}MB` },
      database: "connected",
    });
  } catch (error) {
    logger.error("Health check failed:", error.message);
    logger.debug("Stack trace:", error.stack || "");
    res.status(503).json({
      status: "unhealthy",
      error: error.message,
      database: "disconnected_or_error",
    });
  }
});

app.get('/api/changelog', (req, res) => {
  logger.debug("Changelog requested");
  try {
    const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    logger.debug("Changelog read successfully");
    res.json({ content: changelogContent });
  } catch (error) {
    logger.error('Failed to read CHANGELOG.md:', error);
    res.status(500).json({ error: 'Failed to read changelog' });
  }
});

app.get('/api/version', (req, res) => {
  logger.debug("Version info requested");
  try {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const packageData = JSON.parse(packageContent);
    logger.debug("Version info read successfully:", packageData.version);
    res.json({ 
      version: packageData.version,
      name: packageData.name,
      description: packageData.description 
    });
  } catch (error) {
    logger.error('Failed to read package.json:', error);
    res.status(500).json({ error: 'Failed to read version info' });
  }
});

app.get("/api/containers/:id/details", async (req, res) => {
  const containerId = req.params.id;
  const currentDebug = req.query.debug === 'true';
  const serverId = req.query.server_id;
  const includeRaw = req.query.raw === 'true';
  const includeSize = req.query.size === 'true';
  const includeStats = req.query.stats === 'true';
  const exportJson = req.query.export === 'true';

  if (!containerId) {
    return res.status(400).json({ error: 'container id is required' });
  }

  if (currentDebug) logger.setDebugEnabled(true);

  try {
    if (serverId && serverId !== 'local') {
      try {
        const row = db.prepare('SELECT url FROM servers WHERE id = ?').get(serverId);
        if (!row || !row.url) {
          return res.status(400).json({ error: 'server url not found for remote details' });
        }
        const base = row.url.replace(/\/$/, '');
  const forwardable = ['raw','size','stats','export','debug'];
  const qsFlags = forwardable.filter(f => req.query[f] === 'true').map(f => `${f}=true`);
  const url = `${base}/api/containers/${encodeURIComponent(containerId)}/details${qsFlags.length ? '?' + qsFlags.join('&') : ''}`;
  const remoteResp = await fetch(url, { method: 'GET', headers: { 'accept': 'application/json' } });
        const text = await remoteResp.text();
        let body;
        try { body = JSON.parse(text); } catch { body = text; }
        return res.status(remoteResp.status).send(body);
      } catch (proxyErr) {
        logger.error(`Proxy to peer ${serverId} for container ${containerId} failed:`, proxyErr.message);
        logger.debug('Stack trace:', proxyErr.stack || '');
        return res.status(502).json({ error: 'failed to proxy remote container details' });
      }
    }

  await dockerApi._ensureConnected?.();
  const insp = await dockerApi.inspectContainer(containerId, { size: includeSize });
  const health = await dockerApi.getContainerHealth(containerId);
  let stats = null;
  let statsUnavailableReason = null;
  if (includeStats) {
    if (insp.State?.Status && insp.State.Status !== 'running') {
      statsUnavailableReason = `container_not_running:${insp.State.Status}`;
    } else {
      const rawStats = await dockerApi.getContainerStats(containerId);
      if (rawStats && !rawStats.error) {
        stats = rawStats;
      } else if (rawStats && rawStats.error) {
        statsUnavailableReason = `stats_error:${rawStats.error}`;
      } else {
        statsUnavailableReason = 'docker_returned_null';
      }
    }
  }

    const portsObj = insp.NetworkSettings?.Ports || {};
    const portMappings = [];
    const exposedUnmapped = [];
    for (const [containerPort, hostBindings] of Object.entries(portsObj)) {
      if (hostBindings && Array.isArray(hostBindings) && hostBindings.length) {
        for (const hb of hostBindings) {
          portMappings.push({
            host_ip: hb.HostIp || '0.0.0.0',
            host_port: parseInt(hb.HostPort, 10),
            container_port: parseInt(containerPort.split('/')[0], 10),
            protocol: containerPort.split('/')[1] || 'tcp'
          });
        }
      } else {
        const [p, proto] = containerPort.split('/');
        const portNum = parseInt(p, 10);
        const entry = {
          host_ip: '0.0.0.0',
          host_port: portNum,
          container_port: portNum,
          protocol: proto || 'tcp',
          internal: true
        };
        portMappings.push(entry);
        exposedUnmapped.push({ port: portNum, protocol: proto || 'tcp' });
      }
    }

  const rawRestartPolicy = insp.HostConfig?.RestartPolicy?.Name;
  const normalizedRestartPolicy = rawRestartPolicy && rawRestartPolicy !== '' ? rawRestartPolicy : 'none';
    const startedAt = insp.State?.StartedAt;
    const uptimeSeconds = (() => {
      if (!startedAt || !insp.State?.Running) return null;
      const start = Date.parse(startedAt);
      if (Number.isNaN(start)) return null;
      return Math.max(0, Math.floor((Date.now() - start) / 1000));
    })();
  const ephemeral = normalizedRestartPolicy === 'none' && (uptimeSeconds != null) && uptimeSeconds < 300;

    const response = {
      id: insp.Id?.substring(0, 12) || containerId,
      name: (insp.Name || '').replace(/^\//, ''),
      image: insp.Config?.Image,
      command: Array.isArray(insp.Config?.Cmd) ? insp.Config.Cmd.join(' ') : insp.Config?.Cmd,
      created: Math.floor(new Date(insp.Created).getTime() / 1000) || null,
      createdISO: insp.Created || null,
      state: insp.State?.Status,
      health: health.health || 'unknown',
      restartCount: typeof insp.RestartCount === 'number' ? insp.RestartCount : 0,
      restartPolicy: normalizedRestartPolicy,
      restartPolicyRaw: rawRestartPolicy ?? null,
      restartRetries: insp.HostConfig?.RestartPolicy?.MaximumRetryCount ?? null,
      networkMode: insp.HostConfig?.NetworkMode || '',
      ports: portMappings,
      exposedUnmapped,
      labels: insp.Config?.Labels || {},
      mounts: (insp.Mounts || []).map(m => ({ type: m.Type, source: m.Source, destination: m.Destination })),
      networks: Object.entries(insp.NetworkSettings?.Networks || {}).map(([name, n]) => ({
        name,
        ip: n.IPAddress || null,
        gateway: n.Gateway || null,
        mac: n.MacAddress || null,
        driver: n.Driver || null
      })),
      imageDigest: Array.isArray(insp.RepoDigests) && insp.RepoDigests.length ? insp.RepoDigests[0] : null,
      uptimeSeconds,
      ephemeral,
      sizeRwBytes: includeSize ? insp.SizeRw ?? null : undefined,
      sizeRootFsBytes: includeSize ? insp.SizeRootFs ?? null : undefined,
  stats,
  statsUnavailableReason,
      statsSampledAt: stats?.read || null,
      exportedAt: exportJson ? new Date().toISOString() : undefined
    };
    if (includeRaw) {
      response.raw = insp;
    }
    if (exportJson) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=container-${response.id}-details.json`);
    }
    return res.json(response);
  } catch (err) {
    logger.error(`GET /api/containers/${containerId}/details failed:`, err.message);
    logger.debug('Stack trace:', err.stack || '');
    return res.status(500).json({ error: 'failed to get container details' });
  } finally {
    if (currentDebug) logger.setDebugEnabled(process.env.DEBUG === 'true');
  }
});

const staticPath = path.join(__dirname, "public");
logger.info(`Attempting to serve static files from: ${staticPath}`);
app.use(express.static(staticPath, { fallthrough: true, index: false }));

app.get("*", (req, res, _next) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  logger.debug(`Serving frontend for path: ${req.path}`);
  res.sendFile(indexPath, (err) => {
    if (err) {
      logger.error(`Failed to send ${indexPath} for ${req.path}: ${err.message}`);
      if (!res.headersSent) {
        res.status(404).json({
          error: "Frontend entry point not found",
          details: `Could not serve ${indexPath}. Ensure frontend is built and in public directory. Error: ${err.message}`,
        });
      }
    } else {
      logger.debug(`Successfully served frontend for ${req.path}`);
    }
  });
});

app.use((err, req, res, next) => {
  logger.fatal("Unhandled error in Express middleware:", err.stack || err.message);
  if (!res.headersSent) {
    res
      .status(500)
      .json({ error: "Internal Server Error", details: err.message });
  } else {
    next(err);
  }
});

logger.info(`About to call app.listen on port ${PORT}`);

if (isAuthEnabled() && recoveryManager.isRecoveryModeEnabled()) {
  recoveryManager.generateKey();
}

try {
  app.listen(PORT, "0.0.0.0", () => {
    logger.info(`Server is now listening on http://0.0.0.0:${PORT}`);
    logger.info("Full startup message complete.");
  });
} catch (listenError) {
  logger.fatal("app.listen failed to start:", listenError.message);
  logger.debug("Stack trace:", listenError.stack || "");
  process.exit(1);
}

process.on("unhandledRejection", (reason, promise) => {
  logger.fatal("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  logger.fatal("Uncaught Exception:", error.stack || error.message);
  process.exit(1);
});
