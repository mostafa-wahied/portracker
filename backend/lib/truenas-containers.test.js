const { describe, expect, jest: jestObject, test } = require("@jest/globals");
const { createContainerQuery, mapContainers } = require("./truenas-containers");

function failure(errname) {
  return Object.assign(new Error("TrueNAS request failed"), { errname });
}

function client(responses) {
  return {
    call: jestObject.fn(async (method) => {
      const response = responses[method];
      if (response instanceof Error) throw response;
      return response;
    }),
  };
}

function calledMethods(api) {
  return api.call.mock.calls.map(([method]) => method);
}

describe("TrueNAS container discovery", () => {
  test("falls back to virt.instance.query when container.query is missing and keeps it", async () => {
    const legacy = [{ id: "web", name: "web", status: "RUNNING", memory: 4294967296 }];
    const api = client({ "container.query": failure("ENOMETHOD"), "virt.instance.query": legacy });
    const query = createContainerQuery();

    await expect(query.run(api, { timeoutMs: 15000 })).resolves.toBe(legacy);
    await query.run(api, { timeoutMs: 15000 });

    expect(query.method).toBe("virt.instance.query");
    expect(calledMethods(api)).toEqual(["container.query", "virt.instance.query", "virt.instance.query"]);
    expect(api.call).toHaveBeenCalledWith("virt.instance.query", [], { timeoutMs: 15000 });
  });

  test("switches to container.query after an upgrade removes virt.instance.query", async () => {
    const query = createContainerQuery();
    await query.run(client({ "container.query": failure("ENOMETHOD"), "virt.instance.query": [] }), {});
    const upgraded = client({ "container.query": [{ id: 1, name: "web" }], "virt.instance.query": failure("ENOMETHOD") });

    await expect(query.run(upgraded, {})).resolves.toHaveLength(1);
    expect(calledMethods(upgraded)).toEqual(["virt.instance.query", "container.query"]);
    expect(query.method).toBe("container.query");
  });

  test.each(["EACCES", undefined])("does not fall back when container.query fails with %s", async (errname) => {
    const rejected = failure(errname);
    const api = client({ "container.query": rejected, "virt.instance.query": [] });
    const query = createContainerQuery();

    await expect(query.run(api, {})).rejects.toBe(rejected);
    expect(calledMethods(api)).toEqual(["container.query"]);
    expect(query.method).toBe("container.query");
  });

  test("rejects when neither method exists", async () => {
    const query = createContainerQuery();
    const api = client({ "container.query": failure("ENOMETHOD"), "virt.instance.query": failure("ENOMETHOD") });

    await expect(query.run(api, {})).rejects.toMatchObject({ errname: "ENOMETHOD" });
    expect(query.method).toBe("virt.instance.query");
  });

  test("maps TrueNAS 27 containers to the dashboard shape without raw configuration", () => {
    const [running, unlimited] = mapContainers([
      {
        id: 1, uuid: "fixture-uuid", name: "web", description: "front", cpuset: "0-1", autostart: true,
        status: { state: "RUNNING", pid: 42, domain_state: "RUNNING" }, memory: 2048,
        dataset: "pool/web", initenv: { FIXTURE_TOKEN: "fixture-private-value" },
      },
      { id: 2, name: "batch", status: { state: "SUSPENDED", pid: null, domain_state: null }, memory: null, autostart: false },
    ], "container.query");

    expect(running).toEqual({
      type: "vm", id: "web", name: "web", status: "running", vcpus: null, memory: 2147483648, autostart: true,
      platform: "truenas", platform_data: { container_type: "lxc", description: "front", cpuset: "0-1" },
    });
    expect(unlimited).toMatchObject({ id: "batch", status: "suspended", memory: null });
    expect(JSON.stringify([running, unlimited])).not.toContain("fixture-private-value");
  });

  test("keeps the TrueNAS 25.10 mapping unchanged", () => {
    const instance = { id: "web", name: "web", status: "STOPPED", cpu: "4", memory: 8589934592, autostart: true, image: { os: "Ubuntu" }, storage_pool: "Pool" };

    expect(mapContainers([instance], "virt.instance.query")[0]).toEqual({
      type: "vm", id: "web", name: "web", status: "stopped", vcpus: "4", memory: 8589934592, autostart: true, platform: "truenas",
      platform_data: { container_type: "lxc", image: { os: "Ubuntu" }, os: "Ubuntu", storage_pool: "Pool", orig_data: instance },
    });
    expect(mapContainers([instance])[0].memory).toBe(8589934592);
    expect(mapContainers([{ status: "" }])[0].status).toBe("unknown");
  });

  test("labels TrueNAS 25 legacy instance VMs as VMs", () => {
    const [vm, container] = mapContainers([{ name: "legacy", type: "VM" }, { name: "web", type: "CONTAINER" }], "virt.instance.query");

    expect(vm.platform_data.container_type).toBe("vm");
    expect(container.platform_data.container_type).toBe("lxc");
  });
});
