const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { once } = require("node:events");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const express = require("express");
const { describe, test, expect, jest: jestObject } = require("@jest/globals");
const { PingTargets, normalizeHost, probeFetch } = require("../lib/ping-policy");

describe("ping destination boundary", () => {
  test("rejects an undiscovered destination before probing", async () => {
    const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    const route = source.match(/app\.get\("\/api\/ping",[\s\S]+?\n\}\);/)[0];
    const probe = jestObject.fn(async () => ({ reachable: true }));
    const app = express();
    const context = {
      app,
      requireAuthOrApiKey: (_request, _response, next) => next(),
      pingRequestLimit: (_request, _response, next) => next(),
      testProtocol: probe,
      detectServiceType: () => ({ type: "web", name: "fixture" }),
      determineServiceStatus: () => ({ status: "accessible", color: "green" }),
      fs: { existsSync: () => false }, process: { env: {} },
      logPingDebug() {}, logger: { setDebugEnabled() {} },
      db: { prepare: () => ({ get: () => ({ id: "local" }) }) },
    };
    context.pingTargets = new PingTargets();
    vm.runInNewContext(route, context);
    const server = app.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ping?host_ip=192.0.2.10&host_port=8080`, {
        headers: { Connection: "close" },
      });
      expect(response.status).toBe(403);
      expect(probe).not.toHaveBeenCalled();
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});

function authorize(registry, query, server = { id: "local", url: "http://localhost:4999" }) {
  let status = 200;
  let allowed = false;
  const request = { query: { ...query } };
  const response = { status(code) { status = code; return this; }, json() {} };
  registry.guard({ prepare: () => ({ get: () => server }) })(request, response, () => { allowed = true; });
  return { status, allowed, query: request.query };
}

describe("discovered ping targets", () => {
  const query = { host_ip: "192.168.1.20", host_port: "8080" };
  const port = { host_ip: "192.168.1.20", host_port: 8080, owner: "fixture", source: "docker" };

  test("allows discovered private services and ignores forged status hints", () => {
    const registry = new PingTargets();
    registry.record({ id: "local" }, [port]);
    const result = authorize(registry, { ...query, owner: "sshd", source: "system" });
    expect(result.allowed).toBe(true);
    expect(result.query.owner).toBe("fixture");
    expect(result.query.source).toBe("docker");
  });

  test("replaces stale inventory and rejects deleted servers", () => {
    const registry = new PingTargets();
    registry.record({ id: "local" }, [port]);
    expect(authorize(registry, query, null).status).toBe(403);
    registry.record({ id: "local" }, []);
    expect(authorize(registry, query).status).toBe(403);
  });

  test("binds peer targets to their stored server and URL", () => {
    const registry = new PingTargets();
    const server = { id: "peer-a", url: "https://peer.invalid" };
    registry.record(server, [port]);
    expect(authorize(registry, { ...query, server_id: server.id }, server).allowed).toBe(true);
    expect(authorize(registry, query, { id: "peer-b", url: server.url }).status).toBe(403);
    expect(authorize(registry, query, { ...server, url: "https://changed.invalid" }).status).toBe(403);
    expect(authorize(registry, { ...query, target_server_url: "http://other.invalid" }, server).status).toBe(403);
  });

  test("requires the discovered container identity for internal ports", () => {
    const registry = new PingTargets();
    registry.record({ id: "local" }, [{ ...port, internal: true, container_id: "fixture-container" }]);
    expect(authorize(registry, query).status).toBe(403);
    expect(authorize(registry, { ...query, internal: "true", container_id: "wrong" }).status).toBe(403);
    expect(authorize(registry, { ...query, internal: "true", container_id: "fixture-container" }).allowed).toBe(true);
  });

  test.each(["127.1", "2130706433", "0x7f000001", "host/path", "host#fragment", "user@host", "host?query", "host%00", "[::1]:80", "host\\path"]) (
    "rejects ambiguous host syntax %s", hostname => expect(normalizeHost(hostname)).toBeNull()
  );

  test.each(["8080/path", "8080junk", "8e3", "0", "65536", ["8080", "80"]])("rejects invalid port %j", value => {
    expect(authorize(new PingTargets(), { ...query, host_port: value }).status).toBe(400);
  });
});

async function withHttpServer(handler, run) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    await run(`http://127.0.0.1:${server.address().port}/`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

describe("bounded probe transport", () => {
  test("preserves bracketed IPv6 and IPv6 loopback host syntax", () => {
    expect(normalizeHost("[::1]")).toBe("::1");
    expect(normalizeHost("::1")).toBe("::1");
    expect(normalizeHost("[fd00::10]")).toBe("fd00::10");
  });
  test("probes an explicitly allowed local service", async () => {
    const hits = [];
    await withHttpServer((request, response) => {
      hits.push(request.url);
      response.end("fixture");
    }, async url => {
      const response = await probeFetch(url, { allowLoopback: true });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("fixture");
      expect(hits).toEqual(["/"]);
      await expect(probeFetch(url)).rejects.toThrow("not allowed");
      expect(hits).toHaveLength(1);
    });
  });

  test.each(["HEAD", "GET"])("does not follow a %s redirect", async method => {
    let destinationHits = 0;
    await withHttpServer((_request, response) => { destinationHits += 1; response.end(); }, async destination => {
      await withHttpServer((_request, response) => { response.writeHead(302, { Location: destination }); response.end(); }, async url => {
        expect((await probeFetch(url, { method, allowLoopback: true })).status).toBe(302);
        expect(destinationHits).toBe(0);
      });
    });
  });

  test.each(["169.254.169.254", "::ffff:169.254.169.254", "fe80::1", "127.0.0.1", "::1"])(
    "rejects resolved forbidden address %s before transport", async address => {
      const request = jestObject.fn();
      await expect(probeFetch("http://fixture.invalid/", {
        lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }], request,
      })).rejects.toThrow("not allowed");
      expect(request).not.toHaveBeenCalled();
    }
  );

  test("rejects mixed safe and forbidden DNS answers", async () => {
    const request = jestObject.fn();
    await expect(probeFetch("http://fixture.invalid/", {
      request, lookup: async () => [{ address: "192.168.1.20", family: 4 }, { address: "169.254.169.254", family: 4 }],
    })).rejects.toThrow("not allowed");
    expect(request).not.toHaveBeenCalled();
  });

  test("pins the validated DNS result without a second resolution", async () => {
    const lookup = jestObject.fn(async () => [{ address: "192.168.1.20", family: 4 }]);
    const request = (_url, options, callback) => {
      options.lookup("fixture.invalid", { all: true }, (error, addresses) => {
        expect(error).toBeNull();
        expect(addresses).toEqual([{ address: "192.168.1.20", family: 4 }]);
      });
      const outgoing = new EventEmitter();
      outgoing.end = () => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers = {};
        callback(response);
        response.emit("end");
      };
      outgoing.destroy = () => {};
      return outgoing;
    };
    expect((await probeFetch("http://fixture.invalid/", { lookup, request })).status).toBe(200);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test("bounds response size and stalled bodies", async () => {
    await withHttpServer((_request, response) => response.end("fixture-too-large"), async url => {
      await expect(probeFetch(url, { allowLoopback: true, maxResponseBytes: 4 })).rejects.toThrow("size limit");
    });
    await withHttpServer((_request, response) => response.write("partial"), async url => {
      await expect(probeFetch(url, { allowLoopback: true, signal: AbortSignal.timeout(100) })).rejects.toThrow("timed out");
    });
  });

  test("bounds stalled DNS and rejects URL components", async () => {
    await expect(probeFetch("http://fixture.invalid/", {
      lookup: () => new Promise(() => {}), signal: AbortSignal.timeout(100),
    })).rejects.toThrow("timed out");
    for (const url of ["http://fixture.invalid/probe", "http://fixture.invalid/?query", "http://fixture.invalid/#hash", "http://user:synthetic@fixture.invalid/"]) {
      await expect(probeFetch(url)).rejects.toThrow("Invalid probe URL");
    }
  });
});