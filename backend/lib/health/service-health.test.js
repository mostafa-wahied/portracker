const { test, expect, beforeAll, afterAll } = require("@jest/globals");
const net = require("node:net");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { computeServiceHealth } = require("./service-health");
const { aggregate, describeProbeError } = require("./aggregate");
const { redactDiagnosticData } = require("../diagnostic-data");
const { containerListeners, publishedContainerPort, listeningPorts } = require("./container-listeners");
const { classify } = require("./classify");
const { probeContainerState } = require("./probes");
const { completionPrerequisites } = require("./signals");

const servers = [];
const tempDirs = [];
const originalOverride = process.env.HOST_OVERRIDE;
const CONTAINER_ID = "a".repeat(64);

beforeAll(() => { process.env.HOST_OVERRIDE = "127.0.0.1"; });

afterAll(async () => {
  if (originalOverride === undefined) delete process.env.HOST_OVERRIDE;
  else process.env.HOST_OVERRIDE = originalOverride;
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  tempDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});

async function listen(server) {
  servers.push(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

function httpServer(status) {
  return listen(http.createServer((_req, res) => { res.statusCode = status; res.end("fixture"); }));
}

function resetOnDataServer() {
  return listen(net.createServer(socket => {
    socket.on("error", () => {});
    socket.on("data", () => socket.destroy());
  }));
}

async function closedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function dockerApi({ healthcheck = false, state = "running", exitCode = 0 } = {}) {
  return {
    inspectContainer: async id => ({
      Id: id,
      State: { Status: state, ExitCode: exitCode, ...(healthcheck ? { Health: { Status: "healthy" } } : {}) },
      Config: { Image: "fixture:1", Labels: {}, ...(healthcheck ? { Healthcheck: { Test: ["CMD", "true"] } } : {}) },
      HostConfig: { NetworkMode: "bridge" },
      NetworkSettings: { Networks: {}, Ports: {} },
    }),
    getContainerHealth: async () => ({ status: state, health: healthcheck ? "healthy" : "none" }),
  };
}

function row(port, extra) {
  return { host_ip: "0.0.0.0", host_port: port, protocol: "tcp", container_id: "c1", owner: "fixture", source: "docker", ...extra };
}

function run(ports, options) {
  return computeServiceHealth({ serviceId: "fixture", name: "fixture", ports }, { dockerApi: dockerApi(options), timeoutMs: 500 });
}

function fakeProc(listening, cgroupId = CONTAINER_ID) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "portracker-proc-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "4242", "net"), { recursive: true });
  fs.writeFileSync(path.join(root, "4242", "cgroup"), `0::/system.slice/docker-${cgroupId}.scope\n`);
  const header = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
  const rows = listening.map((port, i) => `   ${i}: 00000000:${port.toString(16).toUpperCase().padStart(4, "0")} 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 ${1000 + i} 1 0 100 0 0 10 0`);
  fs.writeFileSync(path.join(root, "4242", "net", "tcp"), [header, ...rows].join("\n") + "\n");
  fs.writeFileSync(path.join(root, "4242", "net", "tcp6"), header + "\n");
  return root;
}

function listenerDockerApi(mapping) {
  const Ports = Object.fromEntries(Object.entries(mapping).map(([hostPort, containerPort]) => [`${containerPort}/tcp`, [{ HostIp: "0.0.0.0", HostPort: String(hostPort) }]]));
  return {
    inspectContainer: async () => ({
      Id: CONTAINER_ID,
      State: { Status: "running", Pid: 4242 },
      Config: { Image: "fixture:1", Labels: {} },
      HostConfig: { NetworkMode: "bridge" },
      NetworkSettings: { Networks: {}, Ports },
    }),
    getContainerHealth: async () => ({ status: "running", health: "none" }),
  };
}

function runWithListeners(ports, mapping, procRoot) {
  const rows = ports.map(port => row(port, { container_id: CONTAINER_ID }));
  return computeServiceHealth({ serviceId: "fixture", name: "fixture", ports: rows }, { dockerApi: listenerDockerApi(mapping), timeoutMs: 500, procRoots: [procRoot] });
}

function portState(component, port) {
  return component.probe.evidence.ports.find(entry => Number(entry.host_port) === port);
}

test("incomplete socket tables cannot prove that a port has no listener", async () => {
  const root = fakeProc([]);
  fs.unlinkSync(path.join(root, "4242", "net", "tcp6"));
  const inspection = await listenerDockerApi({}).inspectContainer();
  expect(await containerListeners(inspection, [root])).toBeNull();
});

test("malformed socket data remains unknown", async () => {
  const root = fakeProc([]);
  fs.writeFileSync(path.join(root, "4242", "net", "tcp6"), "not a socket table\n");
  const inspection = await listenerDockerApi({}).inspectContainer();
  expect(await containerListeners(inspection, [root])).toBeNull();
  expect(listeningPorts("")).toBeNull();
});

test("published bindings distinguish host addresses and protocols", () => {
  const inspection = { NetworkSettings: { Ports: {
    "8000/tcp": [{ HostIp: "10.0.0.1", HostPort: "9000" }],
    "8001/tcp": [{ HostIp: "10.0.0.2", HostPort: "9000" }],
    "8002/udp": [{ HostIp: "10.0.0.2", HostPort: "9000" }],
  } } };
  expect(publishedContainerPort(inspection, 9000, "tcp", "10.0.0.2")).toBe(8001);
  expect(publishedContainerPort(inspection, 9000, "udp", "10.0.0.2")).toBe(8002);
  expect(publishedContainerPort(inspection, 9000, "tcp", "10.0.0.3")).toBeNull();
  expect(publishedContainerPort(inspection, 9000, "tcp")).toBeNull();
});

test("incomplete listener evidence preserves an actual HTTP success", async () => {
  const root = fakeProc([]);
  fs.unlinkSync(path.join(root, "4242", "net", "tcp6"));
  const port = await httpServer(200);
  const health = await runWithListeners([port], { [port]: 8080 }, root);
  expect(health.color).toBe("green");
  expect(portState(health.components[0], port).state).toBe("ok");
});

test("treats an HTTP 500 answer as degraded instead of reachable", async () => {
  const port = await httpServer(500);
  const health = await run([row(port)]);
  const component = health.components[0];
  expect(health.color).toBe("yellow");
  expect(health.reason).toBe("Main service answers with HTTP 500.");
  expect(component.probe).toMatchObject({ ok: true, severity: "yellow", error: "http-status-500" });
  expect(component.probe.evidence).toMatchObject({ kind: "http-error", protocol: "http", statusCode: 500 });
  expect(portState(component, port)).toMatchObject({ state: "http-error", check: "http", statusCode: 500 });
});

test("keeps a port that accepts TCP but gives no HTTP answer as open", async () => {
  const port = await resetOnDataServer();
  const health = await run([row(port)]);
  const component = health.components[0];
  expect(health.color).toBe("green");
  expect(component.probe).toMatchObject({ ok: true, severity: null });
  expect(component.probe.evidence.kind).toBe("tcp");
  expect(portState(component, port)).toMatchObject({ state: "open", check: "tcp+http" });
});

test("checks every published port instead of reusing one port's result", async () => {
  const web = await httpServer(200);
  const tcpOnly = await resetOnDataServer();
  const closed = await closedPort();
  const representative = Math.min(web, tcpOnly, closed);
  const health = await run([web, tcpOnly, closed].map(port => row(port)));
  const component = health.components[0];
  expect(component.probe.evidence.ports).toHaveLength(3);
  expect((component.probe.evidence.failures || []).map(failure => Number(failure.host_port))).toEqual(representative === closed ? [] : [closed]);
  expect(portState(component, closed)).toMatchObject({ state: "closed", check: "tcp" });
  expect(portState(component, web)).toMatchObject(representative === web ? { state: "ok", check: "http", statusCode: 200 } : { state: "open", check: "tcp" });
  expect(portState(component, tcpOnly)).toMatchObject({ state: "open", check: representative === tcpOnly ? "tcp+http" : "tcp" });
  if (representative === closed) expect(component.probe.ok).toBe(false);
  else expect(component.probe).toMatchObject({ ok: true, severity: "yellow", error: "ports-closed-1" });
});

test("reports a closed port on a container with a passing healthcheck", async () => {
  const open = await resetOnDataServer();
  const closed = await closedPort();
  const health = await run([row(open), row(closed)], { healthcheck: true });
  const component = health.components[0];
  expect(component.probe).toMatchObject({ ok: true, severity: "yellow", error: "ports-closed-1" });
  expect(component.probe.evidence.kind).toBe("partial");
  expect(portState(component, open)).toMatchObject({ state: "open", check: "tcp" });
  expect(portState(component, closed)).toMatchObject({ state: "closed", reasonCode: "refused" });
});

test("marks UDP and ports over the check limit as not checked", async () => {
  const unique = new Set();
  while (unique.size < 27) unique.add(await closedPort());
  const closed = [...unique];
  const lowest = Math.min(...closed);
  const ports = closed.map(port => row(port)).concat([row(lowest, { protocol: "udp" })]);
  const health = await run(ports);
  const component = health.components[0];
  const entries = component.probe.evidence.ports;
  expect(component.probe.ok).toBe(false);
  expect(entries).toHaveLength(28);
  expect(entries.filter(entry => entry.reasonCode === "udp")).toHaveLength(1);
  expect(entries.filter(entry => entry.reasonCode === "limit")).toHaveLength(3);
  expect(entries.filter(entry => entry.state === "closed")).toHaveLength(24);
});

test("an on-demand representative is not actively probed", async () => {
  const port = await httpServer(200);
  const health = await computeServiceHealth({ ports: [row(port)] }, {
    dockerApi: dockerApi(), onDemandPorts: [`c1:${port}`], timeoutMs: 500,
  });
  expect(health.components[0].probe.ok).toBeNull();
  expect(portState(health.components[0], port)).toMatchObject({ state: "not-checked", reasonCode: "on-demand" });
  expect(health.color).toBe("gray");
});

test("the shared deadline includes an unresponsive Docker inspection", async () => {
  const started = Date.now();
  const health = await computeServiceHealth({ ports: [row(12345)] }, {
    dockerApi: { inspectContainer: () => new Promise(() => {}) }, budgetMs: 40,
  });
  expect(Date.now() - started).toBeLessThan(1000);
  expect(health.components[0].probe.ok).toBeNull();
  expect(portState(health.components[0], 12345)).toMatchObject({ state: "not-checked", reasonCode: "time-limit" });
});

test("the deadline cancels unfinished HTTP checks without erasing TCP evidence", async () => {
  const port = await listen(net.createServer(socket => {
    socket.on("error", () => {});
    socket.on("data", () => {});
    socket.on("end", () => socket.destroy());
  }));
  const started = Date.now();
  const health = await computeServiceHealth({ ports: [row(port)] }, { dockerApi: dockerApi(), budgetMs: 100 });
  expect(Date.now() - started).toBeLessThan(1500);
  expect(portState(health.components[0], port)).toMatchObject({ state: "open", check: "tcp", reasonCode: "time-limit" });
});

test("UDP-only ports stay unknown without an independent healthcheck", async () => {
  const health = await run([row(12345, { protocol: "udp" })]);
  expect(health.components[0].probe.ok).toBeNull();
  expect(portState(health.components[0], 12345)).toMatchObject({ state: "not-checked", reasonCode: "udp" });
  expect(health.color).toBe("gray");
});

test("a passing container healthcheck does not claim the UDP port was checked", async () => {
  const health = await run([row(12345, { protocol: "udp" })], { healthcheck: true });
  expect(health.components[0].probe.ok).toBe(true);
  expect(portState(health.components[0], 12345)).toMatchObject({ state: "not-checked", reasonCode: "udp" });
});

test("an explicitly finished job does not claim its ports are reachable", async () => {
  const health = await computeServiceHealth({ ports: [row(12345)] }, {
    dockerApi: dockerApi({ state: "exited" }), overrides: { c1: "job_expected_exit" }, timeoutMs: 500,
  });
  expect(health.color).toBe("gray");
  expect(portState(health.components[0], 12345)).toMatchObject({ state: "not-checked", reasonCode: "finished-job" });
});

test("keeps the new probe codes through the diagnostic sanitizer", () => {
  expect(redactDiagnosticData({ error: "http-status-503" })).toEqual({ error: "http-status-503" });
  expect(redactDiagnosticData({ error: "ports-closed-2" })).toEqual({ error: "ports-closed-2" });
  expect(redactDiagnosticData({ error: "no-listener" })).toEqual({ error: "no-listener" });
  expect(redactDiagnosticData({ error: "http-status-200" })).toEqual({ error: "Diagnostic operation failed" });
});

test("names, healthcheck presence and startup ordering do not establish importance", () => {
  for (const image of ["arbitrary/api:1", "prometheus-exporter:1", "nginx:1"]) {
    const signals = { image, imageHints: { isExporterLike: true, isProxyLike: true }, hasHealthcheck: true,
      healthcheckStatus: "unhealthy", containerState: "running", composeService: "renamed", dependsOn: ["database"] };
    expect(classify(signals, { siblingServices: ["database"], siblingDependsOnUs: true }).role).toBe("unknown");
    expect(classify(signals, { override: "support" }).role).toBe("support");
  }
  expect(classify({ containerState: "exited", exitCode: 0, restartPolicy: "no" }, {}).role).toBe("unknown");
});

test("declared completion prerequisites stay scoped to their Compose project", () => {
  const expected = completionPrerequisites([{ Labels: {
    "com.docker.compose.project": "arbitrary-group",
    "com.docker.compose.depends_on": "prepare:service_completed_successfully:false,db:service_healthy:false",
  } }]);
  expect([...expected]).toEqual(["arbitrary-group::prepare"]);
  expect(expected.has("different-group::prepare")).toBe(false);
  expect(classify({ expectedCompletion: true, containerState: "running" }, {}).role).toBe("job_expected_exit");
});

test("an exhausted shared scan budget performs no additional Docker reads", async () => {
  let inspections = 0;
  const health = await computeServiceHealth({ ports: [row(12345)] }, {
    budgetMs: 0, dockerApi: { inspectContainer: async () => { inspections += 1; return null; } },
  });
  expect(inspections).toBe(0);
  expect(health.components[0].probe.ok).toBeNull();
});

test("a failed Docker read and a starting healthcheck are not confirmed failures", async () => {
  expect((await probeContainerState(null, "c1")).ok).toBeNull();
  expect((await probeContainerState({ getContainerHealth: async () => ({ status: "running", health: "starting" }) }, "c1")).ok).toBeNull();
});

test("an expected job is not considered completed until its exit is known", async () => {
  const health = await computeServiceHealth({ ports: [row(12345)] }, {
    dockerApi: dockerApi(), overrides: { c1: "job_expected_exit" }, timeoutMs: 500,
  });
  expect(health.components[0].probe.ok).toBeNull();
  expect(portState(health.components[0], 12345).reasonCode).toBe("job-pending");
});

test("describes the new codes and treats a degraded helper as a helper issue", () => {
  expect(describeProbeError("ports-closed-1")).toBe("Service is running, but 1 published port isn't responding.");
  expect(describeProbeError("ports-closed-3")).toBe("Service is running, but 3 published ports aren't responding.");
  const result = aggregate([
    { componentId: "a", classification: { role: "core_access" }, probe: { ok: true } },
    { componentId: "b", classification: { role: "support" }, probe: { ok: true, severity: "yellow", error: "http-status-500" } },
  ]);
  expect(result.color).toBe("yellow");
  expect(result.reason).toBe("Main service reachable, but a helper has issues.");
});

test("aggregation distinguishes missing health from confirmed failures", () => {
  const main = { componentId: "main", classification: { role: "core_access" }, probe: { ok: true } };
  const unknown = { componentId: "unclassified", classification: { role: "unknown" }, probe: { ok: null } };
  const degraded = { ...unknown, probe: { ok: true, severity: "yellow" } };
  const unmeasuredMain = { ...main, probe: { ok: null } };
  expect(aggregate([main, unknown]).color).toBe("green");
  expect(aggregate([main, degraded]).color).toBe("yellow");
  expect(aggregate([unmeasuredMain]).color).toBe("gray");
  expect(aggregate([unmeasuredMain]).components[0].probe.ok).toBeNull();
  expect(aggregate([unmeasuredMain]).failingComponents).toEqual([]);
  expect(aggregate([unmeasuredMain, { ...main, probe: { ok: false } }]).color).toBe("red");
});

test("shows a port as closed when Docker accepts the connection but nothing listens in the container", async () => {
  const web = await httpServer(200);
  const idle = await resetOnDataServer();
  const representative = Math.min(web, idle);
  const sibling = Math.max(web, idle);
  const health = await runWithListeners([web, idle], { [representative]: 8000, [sibling]: 8001 }, fakeProc([8000]));
  const component = health.components[0];
  expect(portState(component, sibling)).toMatchObject({ state: "closed", reasonCode: "no-listener" });
  expect(component.probe.evidence.failures).toEqual([expect.objectContaining({ host_port: sibling, error: "no-listener" })]);
  expect(component.probe).toMatchObject({ ok: true, severity: "yellow", error: "ports-closed-1" });
});

test("marks the main port unreachable when nothing listens behind it", async () => {
  const port = await httpServer(200);
  const health = await runWithListeners([port], { [port]: 8080 }, fakeProc([9999]));
  const component = health.components[0];
  expect(component.probe).toMatchObject({ ok: false, error: "no-listener" });
  expect(portState(component, port)).toMatchObject({ state: "closed", reasonCode: "no-listener" });
  expect(health.color).toBe("red");
});

test("keeps the connection result when the process cannot be tied to the container", async () => {
  const port = await httpServer(200);
  const health = await runWithListeners([port], { [port]: 8080 }, fakeProc([], "b".repeat(64)));
  expect(portState(health.components[0], port)).toMatchObject({ state: "ok", statusCode: 200 });
  expect(health.color).toBe("green");
});

test("preserves automatic role and explanation alongside an active user override", async () => {
  const p1 = await httpServer(500);
  const p2 = await httpServer(200);
  const service = {
    serviceId: "stack::app",
    name: "app",
    ports: [
      { container_id: "c1", host_ip: "127.0.0.1", host_port: String(p1), protocol: "tcp", compose_project: "stack", compose_service: "app" },
      { container_id: "c2", host_ip: "127.0.0.1", host_port: String(p2), protocol: "tcp", compose_project: "stack", compose_service: "worker" },
    ],
  };
  const health = await computeServiceHealth(service, { overrides: { c1: "core_runtime" }, timeoutMs: 1500 });
  const first = health.components.find((entry) => entry.containerId === "c1");
  expect(first).toMatchObject({
    role: "core_runtime",
    ruleId: "R2",
    reason: "Marked as main service by you.",
    autoRole: "unknown",
    autoRuleId: "R8",
    autoReason: "Component importance is not known. Set a role if needed.",
  });
});
