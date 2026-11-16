const CONTAINER_METHODS = ["container.query", "virt.instance.query"];
const BYTES_PER_MIB = 1024 * 1024;

function methodOrder(preferred) {
  return [preferred, ...CONTAINER_METHODS.filter((method) => method !== preferred)];
}

function createContainerQuery() {
  let current = CONTAINER_METHODS[0];

  async function attempt(client, options, [method, ...rest]) {
    current = method;
    try {
      return await client.call(method, [], options);
    } catch (error) {
      if (error?.errname !== "ENOMETHOD" || rest.length === 0) throw error;
      return attempt(client, options, rest);
    }
  }

  return {
    get method() {
      return current;
    },
    run(client, options) {
      return attempt(client, options, methodOrder(current));
    },
  };
}

function containerStatus(status) {
  const state = status && typeof status === "object" ? status.state : status;
  switch (typeof state === "string" ? state.toUpperCase() : "") {
    case "RUNNING":
      return "running";
    case "STOPPED":
      return "stopped";
    case "PAUSED":
      return "paused";
    default:
      return typeof state === "string" && state ? state.toLowerCase() : "unknown";
  }
}

function fromVirtInstance(instance) {
  return {
    type: "vm",
    id: instance.id,
    name: instance.name,
    status: containerStatus(instance.status),
    vcpus: instance.cpu,
    memory: instance.memory || null,
    autostart: instance.autostart,
    platform: "truenas",
    platform_data: {
      container_type: instance.type === "VM" ? "vm" : "lxc",
      aliases: instance.aliases,
      image: instance.image,
      os: instance.image?.os || "unknown",
      vnc_enabled: instance.vnc_enabled,
      storage_pool: instance.storage_pool,
      orig_data: instance,
    },
  };
}

function fromContainer(container) {
  return {
    type: "vm",
    id: container.name,
    name: container.name,
    status: containerStatus(container.status),
    vcpus: null,
    memory: container.memory > 0 ? container.memory * BYTES_PER_MIB : null,
    autostart: container.autostart,
    platform: "truenas",
    platform_data: {
      container_type: "lxc",
      description: container.description || "",
      cpuset: container.cpuset ?? null,
    },
  };
}

function mapContainers(items, method) {
  return items.map(method === "container.query" ? fromContainer : fromVirtInstance);
}

module.exports = { CONTAINER_METHODS, createContainerQuery, mapContainers };
