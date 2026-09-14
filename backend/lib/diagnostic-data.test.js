const { describe, test, expect, jest: jestObject, afterEach } = require("@jest/globals");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { once } = require("node:events");
const express = require("express");
jestObject.mock("./api-key-manager", () => ({ validateAnyApiKey: async key => ({ valid: key === "synthetic-peer-key", serverId: "local" }) }));
const { redactDiagnosticData, sanitizeDiagnosticResponses } = require("./diagnostic-data");
const { requireDiagnosticSession, requireAuthOrApiKey, isAuthEnabled } = require("../middleware/auth");
const { buildContainerPortDetails, sanitizeInternalPortRows, sanitizeDockerInspection } = require("./docker/internal-ports");
const originalAuth = process.env.ENABLE_AUTH;
afterEach(() => { if (originalAuth === undefined) delete process.env.ENABLE_AUTH; else process.env.ENABLE_AUTH = originalAuth; });

describe("diagnostic confidentiality", () => {
  test.each([["true", false], ["false", false], ["true", true]])("preserves peer diagnostics auth=%s legacy=%s without elevating keys", async (auth, legacy) => {
    process.env.ENABLE_AUTH = auth;
    const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    const route = source.match(/app\.get\("\/api\/containers\/:id\/details",[\s\S]+?\n\}\);/)[0];
    const logger = { warn() {}, error() {}, debug() {}, setDebugEnabled() {} };
    const common = { requireAuthOrApiKey, requireDiagnosticSession, isAuthEnabled, URL, URLSearchParams, logger, buildContainerPortDetails, sanitizeInternalPortRows, sanitizeDockerInspection };
    const peer = express();
    const origin = express();
    peer.use(sanitizeDiagnosticResponses);
    origin.use(sanitizeDiagnosticResponses);
    origin.use((request, _response, next) => { request.session = { userId: "fixture-user" }; next(); });
    vm.runInNewContext(route, { ...common, app: peer, dockerApi: {
      inspectContainer: async () => ({ Id: "fixture", Config: { Image: "fixture:1" }, State: { Status: "running" } }),
      getContainerHealth: async () => ({ health: "healthy" }),
      getContainerStats: async () => ({ read: "2026-09-14T00:00:00Z", memory: 4096 }),
    } });
    const listener = peer.listen(0, "127.0.0.1");
    let proxy;
    try {
      await once(listener, "listening");
      vm.runInNewContext(route, { ...common, app: origin,
        db: { prepare: () => ({ get: () => ({ id: "peer", url: "https://peer.invalid:8443", remote_api_key: "encrypted-fixture" }) }) },
        peerRequest: async (_server, endpoint) => {
          const response = await fetch(`http://127.0.0.1:${listener.address().port}${endpoint}`, { headers: { "X-API-Key": "synthetic-peer-key" } });
          const body = await response.json();
          if (legacy) delete body.rawDiagnostics;
          else if (body.rawDiagnostics) body.rawDiagnostics.peerUrl = "https://untrusted.invalid/";
          return { ok: response.ok, status: response.status, json: async () => body };
        },
      });
      proxy = origin.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      const base = `http://127.0.0.1:${proxy.address().port}/api/containers/fixture/details?server_id=peer`;
      const normal = await fetch(base);
      expect(normal.status).toBe(200);
      expect((await normal.json()).rawDiagnostics).toEqual({ available: auth !== "true" || legacy, peerUrl: "https://peer.invalid:8443/?server=local&container=fixture" });
      const stats = await fetch(base + "&stats=true");
      expect(stats.status).toBe(200);
      expect((await stats.json()).stats.memory).toBe(4096);
      for (const flags of ["&raw=true", "&raw=true&export=true"]) {
        const response = await fetch(base + flags);
        expect(response.status).toBe(auth === "true" ? 403 : 200);
        const body = await response.json();
        if (auth !== "true") { expect(body.raw.Config.Image).toBe("fixture:1"); continue; }
        expect(body.code).toBe("RAW_DIAGNOSTICS_REQUIRE_REMOTE_LOGIN");
        expect(body.error).toBe("Sign in on the remote server to view raw diagnostics.");
        expect(body.peerUrl).toBe("https://peer.invalid:8443/?server=local&container=fixture");
        expect(body.raw).toBeUndefined();
      }
    } finally {
      for (const server of [proxy, listener].filter(Boolean)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    }
  });

});

describe("diagnostic response redaction", () => {
  test("redacts every accepted spelling of production diagnostic routes", async () => {
    const app = express();
    const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    const registration = source.split("\n").find(line => line.includes("app.use(") && line.includes("sanitizeDiagnosticResponses"));
    expect(registration).toBeDefined();
    vm.runInNewContext(registration, { app, sanitizeDiagnosticResponses });
    const routes = ["/api/ports", "/api/all-ports", "/api/services", "/api/servers/:id/scan", "/api/containers/:id/details"];
    for (const route of routes) app.get(route, (_request, response) => response.json({
      command: "synthetic-private-command", labels: { custom: "synthetic-private-label" },
      raw: { Config: { Env: ["SYNTHETIC=private"], Cmd: ["synthetic-private-command"] } },
      applications: [{ platform_data: { orig_data: { config: { custom: "synthetic-private-config" }, memory: 4096 } } }],
    }));
    const listener = app.listen(0, "127.0.0.1");
    try {
      await once(listener, "listening");
      for (const route of routes) {
        const canonical = route.replace(":id", "fixture");
        for (const variant of [canonical, canonical + "/", canonical.toUpperCase(), canonical.toUpperCase() + "/"]) {
          const response = await fetch(`http://127.0.0.1:${listener.address().port}${variant}?raw=true&export=true`);
          expect(response.status).toBe(200);
          const text = await response.text();
          expect(text).not.toContain("private");
          expect(JSON.parse(text).applications[0].platform_data.orig_data.memory).toBe(4096);
        }
      }
    } finally { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); }
  });

  test("preserves safe health codes but hides untrusted free-form errors", () => {
    const known = ["ECONNREFUSED", "ETIMEDOUT", "timeout", "healthcheck-unhealthy", "docker-api-unavailable", "exit-code-12", "not-exited-running",
      "Peer response exceeds PEER_MAX_RESPONSE_BYTES; increase this byte limit for a trusted larger inventory",
      "PEER_MAX_RESPONSE_BYTES must be a positive integer byte limit"];
    for (const error of known) expect(redactDiagnosticData({ probe: { error } }).probe.error).toBe(error);
    for (const error of ["synthetic-private-error", "ECONNREFUSED synthetic-private", "exit-code-1 synthetic-private", { message: "synthetic-private" }]) {
      expect(redactDiagnosticData({ probe: { error } }).probe.error).toBe("Diagnostic operation failed");
    }
  });

  test("removes command, labels, health logs and raw application configuration without mutation", () => {
    const data = { ports: [{ host_port: 8080, command: "synthetic-secret" }], raw: {
      Args: ["synthetic-secret"], Config: { Env: ["synthetic-secret"], Cmd: ["synthetic-secret"], Entrypoint: ["synthetic-secret"], Labels: { "custom": "synthetic-secret", "com.docker.compose.project": "fixture" }, Healthcheck: { Test: ["synthetic-secret"] } },
      State: { Health: { Status: "healthy", Log: [{ Output: "synthetic-secret" }] } },
    }, applications: [{ platform_data: { orig_data: { id: "fixture", config: { custom: "synthetic-secret" }, memory: 4096 } } }], password: "synthetic-secret" };
    const before = JSON.stringify(data);
    const safe = redactDiagnosticData(data);
    expect(JSON.stringify(safe)).not.toContain("synthetic-secret");
    expect(safe.ports[0].host_port).toBe(8080);
    expect(safe.raw.Config.Labels).toEqual({ "com.docker.compose.project": "fixture" });
    expect(safe.applications[0].platform_data.orig_data.memory).toBe(4096);
    expect(JSON.stringify(data)).toBe(before);
    expect(redactDiagnosticData(safe)).toEqual(safe);
  });

  test.each([["true", false, "true", 403], ["true", true, "true", 200], ["false", false, "true", 200], ["true", false, undefined, 200]])(
    "restricts raw diagnostics auth=%s session=%s raw=%s", (auth, session, raw, expected) => {
      process.env.ENABLE_AUTH = auth;
      const response = { status: jestObject.fn().mockReturnThis(), json: jestObject.fn() };
      const next = jestObject.fn();
      requireDiagnosticSession({ query: { raw }, session: session ? { userId: "fixture" } : null }, response, next);
      if (expected === 403) { expect(response.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled(); }
      else expect(next).toHaveBeenCalledTimes(1);
    }
  );
});