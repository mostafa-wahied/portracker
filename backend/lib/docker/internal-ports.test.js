const { afterEach, describe, expect, test } = require("@jest/globals");
const {
  DEFAULT_MAX_UNPUBLISHED_EXPOSED_PORTS,
  getMaxUnpublishedExposedPorts,
  listUnpublishedExposedDefs,
  buildInternalPorts,
  buildContainerPortDetails,
  sanitizeDockerInspection,
  sanitizeInternalPortRows,
  sanitizeApplications,
  sanitizeScanPayload,
} = require("./internal-ports");

const originalLimit = process.env.MAX_INTERNAL_PORTS_PER_CONTAINER;

function makeExposedPorts(count, start = 1000) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`${start + index}/tcp`, {}])
  );
}

function makeInternalPortArgs(count, logWarn) {
  return {
    exposedPorts: makeExposedPorts(count),
    portBindings: {},
    containerId: "abcdef1234567890",
    containerName: "test-container",
    composeProject: "test-project",
    composeService: "test-service",
    logWarn,
  };
}

afterEach(() => {
  if (originalLimit === undefined) {
    delete process.env.MAX_INTERNAL_PORTS_PER_CONTAINER;
  } else {
    process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = originalLimit;
  }
});

describe("getMaxUnpublishedExposedPorts", () => {
  test("uses the default for missing or invalid values", () => {
    for (const value of [undefined, "", "0", "-1", "2.5", "2invalid"]) {
      if (value === undefined) {
        delete process.env.MAX_INTERNAL_PORTS_PER_CONTAINER;
      } else {
        process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = value;
      }
      expect(getMaxUnpublishedExposedPorts()).toBe(
        DEFAULT_MAX_UNPUBLISHED_EXPOSED_PORTS
      );
    }
  });

  test("uses a positive configured limit", () => {
    process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = "25";

    expect(getMaxUnpublishedExposedPorts()).toBe(25);
  });
});

describe("listUnpublishedExposedDefs", () => {
  test("treats null and empty bindings as unpublished", () => {
    const exposedPorts = { "80/tcp": {}, "81/tcp": {}, "82/udp": {} };
    const portBindings = {
      "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }],
      "81/tcp": null,
      "82/udp": [],
    };

    expect(listUnpublishedExposedDefs(exposedPorts, portBindings)).toEqual([
      "81/tcp",
      "82/udp",
    ]);
  });
});

describe("buildInternalPorts", () => {
  test("keeps exactly the default limit", () => {
    delete process.env.MAX_INTERNAL_PORTS_PER_CONTAINER;

    expect(buildInternalPorts(makeInternalPortArgs(100))).toHaveLength(100);
  });

  test("drops a group above the limit and reports it", () => {
    delete process.env.MAX_INTERNAL_PORTS_PER_CONTAINER;
    const warnings = [];

    expect(
      buildInternalPorts(makeInternalPortArgs(101, (message) => warnings.push(message)))
    ).toEqual([]);
    expect(warnings).toEqual([
      expect.stringContaining("101 unpublished ports"),
    ]);
  });

  test("honors a configured limit", () => {
    process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = "2";

    expect(buildInternalPorts(makeInternalPortArgs(2))).toHaveLength(2);
    expect(buildInternalPorts(makeInternalPortArgs(3))).toEqual([]);
  });
});

describe("buildContainerPortDetails", () => {
  test("keeps published mappings and allowed internal ports", () => {
    const result = buildContainerPortDetails({
      exposedPorts: { "80/tcp": {}, "81/tcp": {} },
      portBindings: {
        "80/tcp": [{ HostIp: "127.0.0.1", HostPort: "8080" }],
        "81/tcp": null,
      },
      containerName: "test-container",
    });

    expect(result.portMappings).toEqual([
      {
        host_ip: "127.0.0.1",
        host_port: 8080,
        container_port: 80,
        protocol: "tcp",
      },
      {
        host_ip: "0.0.0.0",
        host_port: 81,
        container_port: 81,
        protocol: "tcp",
        internal: true,
      },
    ]);
    expect(result.exposedUnmapped).toEqual([{ port: 81, protocol: "tcp" }]);
  });

  test("keeps network mappings missing from exposed-port metadata", () => {
    const result = buildContainerPortDetails({
      exposedPorts: {},
      portBindings: {
        "80/tcp": { HostIp: "0.0.0.0", HostPort: "8080" },
        "81/tcp": null,
      },
      containerName: "test-container",
    });

    expect(result.portMappings).toHaveLength(2);
    expect(result.portMappings[0].host_port).toBe(8080);
    expect(result.portMappings[1].internal).toBe(true);
  });

  test("uses configured bindings missing from runtime network data", () => {
    const result = buildContainerPortDetails({
      exposedPorts: { "80/tcp": {} },
      portBindings: { "80/tcp": null },
      configuredBindings: {
        "80/tcp": [{ HostIp: "127.0.0.1", HostPort: "8080" }],
      },
      containerName: "test-container",
    });

    expect(result.portMappings).toEqual([
      {
        host_ip: "127.0.0.1",
        host_port: 8080,
        container_port: 80,
        protocol: "tcp",
      },
    ]);
    expect(result.exposedUnmapped).toEqual([]);
  });

  test("ignores malformed port definitions and host bindings", () => {
    const result = buildContainerPortDetails({
      exposedPorts: { "80invalid/tcp": {}, "70000/tcp": {} },
      portBindings: {
        "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "invalid" }],
      },
      containerName: "test-container",
    });

    expect(result.portMappings).toEqual([]);
    expect(result.exposedUnmapped).toEqual([]);
  });

  test("keeps published mappings when internal ports exceed the limit", () => {
    process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = "2";
    const result = buildContainerPortDetails({
      exposedPorts: { "80/tcp": {}, ...makeExposedPorts(3, 1000) },
      portBindings: {
        "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }],
      },
      containerName: "test-container",
    });

    expect(result.portMappings).toHaveLength(1);
    expect(result.portMappings[0].host_port).toBe(8080);
    expect(result.exposedUnmapped).toEqual([]);
  });
});

describe("sanitizeDockerInspection", () => {
  test("filters oversized raw internal ports and keeps published bindings", () => {
    process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = "2";
    const inspection = {
      Id: "abcdef1234567890",
      Name: "/test-container",
      Config: {
        Labels: { test: "value" },
        ExposedPorts: { "80/tcp": {}, ...makeExposedPorts(3, 1000) },
      },
      HostConfig: {
        PortBindings: {
          "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }],
        },
      },
      NetworkSettings: {
        Networks: { bridge: { IPAddress: "172.17.0.2" } },
        Ports: {
          "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }],
          "1000/tcp": null,
          "1001/tcp": null,
          "1002/tcp": null,
        },
      },
    };

    const result = sanitizeDockerInspection(inspection);

    expect(result.Config.ExposedPorts).toEqual({ "80/tcp": {} });
    expect(result.HostConfig.PortBindings).toEqual({
      "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }],
    });
    expect(result.NetworkSettings.Ports).toEqual({
      "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }],
    });
    expect(result.Config.Labels).toEqual({ test: "value" });
    expect(result.NetworkSettings.Networks.bridge.IPAddress).toBe("172.17.0.2");
  });

  test("returns the original inspection at or below the limit", () => {
    process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = "2";
    const inspection = {
      Config: { ExposedPorts: makeExposedPorts(2) },
      NetworkSettings: { Ports: {} },
    };

    expect(sanitizeDockerInspection(inspection)).toBe(inspection);
  });
});

describe("sanitizeInternalPortRows", () => {
  test("drops only oversized internal groups", () => {
    process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = "2";
    const rows = [
      { internal: true, container_id: "flood", host_port: 1000 },
      { internal: true, container_id: "flood", host_port: 1001 },
      { internal: true, container_id: "flood", host_port: 1002 },
      { internal: false, container_id: "flood", host_port: 443 },
      { internal: true, container_id: "normal", host_port: 80 },
    ];

    expect(sanitizeInternalPortRows(rows)).toEqual([
      { internal: false, container_id: "flood", host_port: 443 },
      { internal: true, container_id: "normal", host_port: 80 },
    ]);
  });

  test("rejects a non-array payload", () => {
    expect(() => sanitizeInternalPortRows(null)).toThrow(
      "Port rows must be an array"
    );
  });

  test("counts containers independently when port numbers overlap", () => {
    process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = "2";
    const rows = [
      { internal: true, container_id: "flood", host_port: 80 },
      { internal: true, container_id: "flood", host_port: 81 },
      { internal: true, container_id: "flood", host_port: 82 },
      { internal: true, container_id: "normal", host_port: 80 },
      { internal: true, container_id: "normal", host_port: 81 },
    ];

    expect(sanitizeInternalPortRows(rows)).toEqual([
      { internal: true, container_id: "normal", host_port: 80 },
      { internal: true, container_id: "normal", host_port: 81 },
    ]);
  });
});

describe("sanitizeApplications", () => {
  test("drops oversized internal metadata and keeps published rows", () => {
    process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = "2";
    const applications = [
      {
        id: "flood",
        name: "flood-app",
        platform_data: {
          networks: "bridge",
          ports: [
            { internal: true, host_port: 1000 },
            { internal: true, host_port: 1001 },
            { internal: true, host_port: 1002 },
            { internal: false, host_port: 8080 },
          ],
        },
      },
    ];

    const result = sanitizeApplications(applications);

    expect(result[0].platform_data.ports).toEqual([
      { internal: false, host_port: 8080 },
    ]);
    expect(result[0].platform_data.networks).toBe("bridge");
    expect(applications[0].platform_data.ports).toHaveLength(4);
  });

  test("preserves malformed application payloads", () => {
    expect(sanitizeApplications(null)).toBeNull();
  });
});

describe("sanitizeScanPayload", () => {
  test("sanitizes ports, applications, and legacy apps", () => {
    process.env.MAX_INTERNAL_PORTS_PER_CONTAINER = "1";
    const application = {
      name: "flood-app",
      platform_data: {
        ports: [
          { internal: true, host_port: 1000 },
          { internal: true, host_port: 1001 },
        ],
      },
    };
    const payload = {
      ports: [
        { internal: true, container_id: "flood", host_port: 1000 },
        { internal: true, container_id: "flood", host_port: 1001 },
      ],
      applications: [application],
      apps: [application],
      platform: "truenas",
    };

    const result = sanitizeScanPayload(payload);

    expect(result.ports).toEqual([]);
    expect(result.applications[0].platform_data.ports).toEqual([]);
    expect(result.apps[0].platform_data.ports).toEqual([]);
    expect(result.platform).toBe("truenas");
  });

  test("rejects malformed scan payloads", () => {
    expect(() => sanitizeScanPayload("invalid")).toThrow(
      "Scan payload must contain a ports array"
    );
    expect(() => sanitizeScanPayload({ applications: [] })).toThrow(
      "Scan payload must contain a ports array"
    );
  });
});