const net = require("node:net");
const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const { isBlockedAddress } = require("./autoxpose-url");
const { createPinnedLookup } = require("./autoxpose-http");
const loopback = new net.BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

function normalizeHost(value) {
  if (typeof value !== "string" || !value || value.length > 253) return null;
  const hostname = value.replace(/^\[([^\]]+)\]$/, "$1").toLowerCase();
  if (net.isIP(hostname)) return hostname;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)) return null;
  try {
    return new URL(`http://${hostname}`).hostname === hostname ? hostname : null;
  } catch {
    return null;
  }
}

function portNumber(value) {
  if (!/^[0-9]+$/.test(String(value))) return null;
  const port = Number(value);
  return Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : null;
}

class PingTargets {
  constructor() {
    this.servers = new Map();
  }

  record(server, ports) {
    this.servers.set(server.id, {
      url: server.id === "local" ? null : server.url || null,
      ports: (Array.isArray(ports) ? ports : []).flatMap(port => {
        const host = normalizeHost(port?.host_ip);
        const number = portNumber(port?.host_port);
        return host && number ? [{ ...port, host, number }] : [];
      }),
    });
  }

  guard(db) {
    return (request, response, next) => {
      const query = request.query;
      for (const field of ["host_ip", "host_port", "server_id", "target_server_url", "internal", "container_id"]) {
        if (query[field] !== undefined && typeof query[field] !== "string") {
          return response.status(400).json({ error: "Invalid ping target" });
        }
      }
      const host = normalizeHost(query.host_ip);
      const number = portNumber(query.host_port);
      if (!host || !number) return response.status(400).json({ error: "Invalid ping target" });
      const server = query.server_id || !query.target_server_url
        ? db.prepare("SELECT * FROM servers WHERE id = ?").get(query.server_id || "local")
        : db.prepare("SELECT * FROM servers WHERE url = ?").get(query.target_server_url);
      const inventory = server && this.servers.get(server.id);
      if (!inventory || inventory.url !== (server.id === "local" ? null : server.url || null) ||
          (query.target_server_url && query.target_server_url !== server.url)) {
        return response.status(403).json({ error: "Ping target is not in the discovered server inventory" });
      }
      const port = inventory.ports.find(entry => entry.host === host && entry.number === number &&
        Boolean(entry.internal) === (query.internal === "true") &&
        (!entry.internal || String(entry.container_id || "") === (query.container_id || "")));
      if (!port) return response.status(403).json({ error: "Ping target is not in the discovered server inventory" });
      query.host_ip = port.host_ip;
      query.host_port = String(number);
      query.owner = port.owner;
      query.source = port.source;
      query.server_id = server.id;
      if (server.id !== "local") query.target_server_url = server.url;
      else delete query.target_server_url;
      request.pingServer = server;
      return next();
    };
  }
}

function probeFetch(value, options = {}) {
  const signal = options.signal || AbortSignal.timeout(2000);
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      if (error) {
        request?.destroy();
        reject(error);
      } else resolve(result);
    };
    const abort = () => finish(new Error("Probe timed out"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(async () => {
      const target = new URL(value);
      const hostname = normalizeHost(target.hostname);
      if (!hostname || !["http:", "https:"].includes(target.protocol) ||
          target.pathname !== "/" || target.search || target.hash || target.username || target.password) {
        throw new Error("Invalid probe URL");
      }
      const family = net.isIP(hostname);
      const addresses = family ? [{ address: hostname, family }] :
        await (options.lookup || dns.lookup)(hostname, { all: true, verbatim: true });
      if (settled) return;
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(({ address }) => {
        const addressFamily = net.isIP(address);
        return !addressFamily || (isBlockedAddress(address) && !(options.allowLoopback &&
          loopback.check(address, addressFamily === 4 ? "ipv4" : "ipv6")));
      })) throw new Error("Probe destination is not allowed");
      const method = options.method || "GET";
      if (!["HEAD", "GET"].includes(method)) throw new Error("Invalid probe method");
      const transport = options.request || (target.protocol === "https:" ? https.request : http.request);
      request = transport(target, {
        method, headers: { "User-Agent": "PortTracker/1.0" }, agent: false,
        lookup: createPinnedLookup(addresses.map(({ address }) => ({ address, family: net.isIP(address) }))),
        rejectUnauthorized: options.rejectUnauthorized !== false,
      }, response => {
        const chunks = [];
        let bytes = 0;
        response.on("data", chunk => {
          bytes += chunk.length;
          if (bytes > (options.maxResponseBytes || 2 * 1024 * 1024)) {
            finish(new Error("Probe response exceeds the size limit"));
            response.destroy();
          } else chunks.push(chunk);
        });
        response.once("error", error => finish(error));
        response.once("aborted", () => finish(new Error("Probe response aborted")));
        response.once("end", () => finish(null, {
          status: response.statusCode,
          headers: { get: name => response.headers[name.toLowerCase()] || null },
          text: async () => Buffer.concat(chunks).toString("utf8"),
        }));
      });
      request.once("error", error => finish(error));
      request.end();
    }).catch(error => finish(error));
  });
}

module.exports = { PingTargets, normalizeHost, probeFetch };