const { afterEach, beforeEach, describe, expect, jest: jestObject, test } = require("@jest/globals");

jestObject.mock("../lib/docker-api", () => {
  const { jest: mockApi } = require("@jest/globals");
  return mockApi.fn(() => ({ connect: async () => true, _ensureConnected: async () => {}, listContainers: async () => [] }));
});
jestObject.mock("../lib/proc-parser", () => {
  const { jest: mockApi } = require("@jest/globals");
  return mockApi.fn(() => ({}));
});
jestObject.mock("../lib/logger", () => {
  const { jest: mockApi } = require("@jest/globals");
  return { Logger: mockApi.fn(() => ({ debug: mockApi.fn(), info: mockApi.fn(), warn: mockApi.fn(), error: mockApi.fn() })) };
});

const { createCollector, resetCollectors } = require("./index");
const originalKey = process.env.TRUENAS_API_KEY;
const originalTimeout = process.env.TRUENAS_TIMEOUT_MS;

beforeEach(() => {
  jestObject.useFakeTimers();
  process.env.TRUENAS_API_KEY = "test-only";
  process.env.TRUENAS_TIMEOUT_MS = "100";
});

afterEach(() => {
  resetCollectors();
  jestObject.useRealTimers();
  if (originalKey === undefined) delete process.env.TRUENAS_API_KEY;
  else process.env.TRUENAS_API_KEY = originalKey;
  if (originalTimeout === undefined) delete process.env.TRUENAS_TIMEOUT_MS;
  else process.env.TRUENAS_TIMEOUT_MS = originalTimeout;
});

function fixture() {
  const collector = createCollector("truenas");
  collector._getBasicSystemInfoViaDocket = async () => ({ hostname: "test" });
  collector._getDockerContainers = async () => [];
  collector._getDockerPorts = async () => [{
    source: "docker", host_ip: "0.0.0.0", host_port: 8080, protocol: "tcp",
    container_id: "fixture", target: "80", internal: false, owner: "fixture",
  }];
  collector._getSwarmServicePorts = async () => [];
  collector._getSystemPorts = async () => [];
  collector._buildHostProcToContainerMap = async () => new Map();
  return collector;
}

describe("bounded TrueNAS enrichment", () => {
  test("returns core ports when connection never settles and releases shared scans", async () => {
    const collector = fixture();
    const close = jestObject.fn();
    let resolveConnection;
    collector.client = { close };
    collector._ensureTrueNASClient = () => new Promise(resolve => { resolveConnection = resolve; });
    collector._collectEnhancedFeatures = jestObject.fn();
    const first = collector.collectAll();
    const second = collector.collectAll();

    await jestObject.advanceTimersByTimeAsync(101);
    const result = await first;
    expect(await second).toBe(result);
    expect(result.ports).toEqual(expect.arrayContaining([expect.objectContaining({ host_port: 8080 })]));
    expect(result.enhancedFeaturesStatus.state).toBe("degraded");
    expect(close).toHaveBeenCalled();
    expect(collector._collectionInProgress).toBe(false);
    resolveConnection();
    await jestObject.advanceTimersByTimeAsync(1);
    expect(collector._collectEnhancedFeatures).not.toHaveBeenCalled();
    expect(jestObject.getTimerCount()).toBe(0);
  });

  test("returns core ports when a connected enrichment request never settles", async () => {
    const collector = fixture();
    collector.client = { close: jestObject.fn() };
    collector._ensureTrueNASClient = async () => collector.client;
    collector._collectEnhancedFeatures = () => new Promise(() => {});
    const pending = collector.collectAll();
    await jestObject.advanceTimersByTimeAsync(101);
    const result = await pending;
    expect(result.ports).toHaveLength(1);
    expect(result.enhancedFeaturesStatus.state).toBe("degraded");
    expect(collector.client.close).toHaveBeenCalled();
  });

  test("preserves successful enrichment and cancels its deadline", async () => {
    const collector = fixture();
    collector._ensureTrueNASClient = async () => {};
    collector._collectEnhancedFeatures = async () => ({ systemInfo: { hostname: "enriched" }, failures: [] });
    const result = await collector.collectAll();
    expect(result.enhancedFeaturesStatus.state).toBe("ready");
    expect(result.systemInfo.hostname).toBe("enriched");
    expect(result.ports).toHaveLength(1);
    expect(jestObject.getTimerCount()).toBe(0);
  });

  test("marks partial enrichment as degraded without discarding available data", async () => {
    const collector = fixture();
    collector._ensureTrueNASClient = async () => {};
    collector._collectEnhancedFeatures = async () => ({ systemInfo: { hostname: "enriched" }, failures: ["vm.query"] });
    const result = await collector.collectAll();
    expect(result.enhancedFeaturesStatus).toEqual({ state: "degraded", failedMethods: ["vm.query"] });
    expect(result.systemInfo.hostname).toBe("enriched");
    expect(result.ports).toHaveLength(1);
  });

  test.each([4294967296, 8589934592])("preserves container memory bytes (%i) while converting VM MiB", async containerMemory => {
    const collector = fixture();
    const virtualMachine = { id: "memory-vm", name: "memory-vm", memory: 4096, status: "RUNNING" };
    const container = { id: "memory-container", name: "memory-container", memory: containerMemory, status: "RUNNING" };
    collector._ensureTrueNASClient = async () => {};
    collector._collectEnhancedFeatures = async () => ({ vms: [virtualMachine], containers: [container], failures: [] });

    const result = await collector.collectAll();
    expect(result.enhancedFeaturesStatus.state).toBe("ready");
    expect(result.vms.find(item => item.id === virtualMachine.id).memory).toBe(4294967296);
    expect(result.vms.find(item => item.id === container.id)).toEqual(expect.objectContaining({
      memory: containerMemory,
      platform_data: expect.objectContaining({ container_type: "lxc", orig_data: container }),
    }));
    expect(virtualMachine.memory).toBe(4096);
    expect(container.memory).toBe(containerMemory);
  });

  test.each([undefined, null, 0])("keeps unavailable VM and container memory (%s) as null", async memory => {
    const collector = fixture();
    collector._ensureTrueNASClient = async () => {};
    collector._collectEnhancedFeatures = async () => ({
      vms: [{ id: "memory-vm", memory, status: "RUNNING" }],
      containers: [{ id: "memory-container", memory, status: "RUNNING" }],
      failures: [],
    });

    const result = await collector.collectAll();
    expect(result.vms).toHaveLength(2);
    expect(result.vms.every(item => item.memory === null)).toBe(true);
  });
});

describe("TrueNAS container discovery", () => {
  function enhancedClient(containers) {
    return {
      call: jestObject.fn(async (method) => {
        if (method in containers) {
          if (containers[method] instanceof Error) throw containers[method];
          return containers[method];
        }
        return method === "system.info" ? { hostname: "enriched" } : [];
      }),
    };
  }

  function missing() {
    return Object.assign(new Error("TrueNAS request failed"), { errname: "ENOMETHOD" });
  }

  test("uses container.query on TrueNAS 27 without calling the removed method", async () => {
    const collector = fixture();
    collector.client = enhancedClient({
      "container.query": [{ id: 1, name: "web", status: { state: "RUNNING", pid: 7, domain_state: "RUNNING" }, memory: 1024 }],
      "virt.instance.query": missing(),
    });

    const enhanced = await collector._collectEnhancedFeatures();
    expect(enhanced).toMatchObject({ failures: [], containerMethod: "container.query" });
    expect(collector.client.call.mock.calls.map(([method]) => method)).not.toContain("virt.instance.query");
  });

  test("falls back to virt.instance.query once on TrueNAS 25.10", async () => {
    const collector = fixture();
    collector.client = enhancedClient({
      "container.query": missing(),
      "virt.instance.query": [{ id: "web", name: "web", status: "RUNNING", memory: 4294967296 }],
    });

    const first = await collector._collectEnhancedFeatures();
    const second = await collector._collectEnhancedFeatures();
    expect(first).toMatchObject({ failures: [], containerMethod: "virt.instance.query" });
    expect(second.containers).toHaveLength(1);
    expect(collector.client.call.mock.calls.filter(([method]) => method === "container.query")).toHaveLength(1);
  });

  test("reports container.query when TrueNAS 27 rejects it for another reason", async () => {
    const collector = fixture();
    collector.client = enhancedClient({ "container.query": Object.assign(missing(), { errname: "EACCES" }) });

    const enhanced = await collector._collectEnhancedFeatures();
    expect(enhanced.failures).toEqual(["container.query"]);
    expect(collector.client.call.mock.calls.map(([method]) => method)).not.toContain("virt.instance.query");
  });

  test("shows TrueNAS 27 containers with byte memory and a readable status", async () => {
    const collector = fixture();
    collector._ensureTrueNASClient = async () => {};
    collector._collectEnhancedFeatures = async () => ({
      vms: [{ id: 1, name: "vm", memory: 1024, status: { state: "RUNNING" } }],
      containers: [{ id: 1, name: "web", status: { state: "STOPPED", pid: null, domain_state: null }, memory: 512 }],
      containerMethod: "container.query",
      failures: [],
    });

    const result = await collector.collectAll();
    expect(result.vms.map((item) => item.id)).toEqual([1, "web"]);
    expect(result.vms[1]).toMatchObject({ status: "stopped", memory: 536870912, platform_data: { container_type: "lxc" } });
  });
});