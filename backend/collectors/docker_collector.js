/**
 * PORTS TRACKER - DOCKER COLLECTOR
 *
 * This collector gathers data from Docker installations.
 * It implements the standard collector interface defined in base_collector.js.
 * Based on the original Docker scanner but with enhanced capabilities.
 */

const BaseCollector = require("./base_collector");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const fs = require("fs");
const os = require("os");
const ProcParser = require("../lib/proc-parser");
const DockerAPIClient = require("../lib/docker-api");

class DockerCollector extends BaseCollector {
  /**
   * Create a new Docker collector
   * @param {Object} config Configuration options
   */
  constructor(config = {}) {
    super(config);
    this.platform = "docker";
    this.platformName = "Docker";
    this.name = "Docker Collector";
    this.procParser = new ProcParser();
  this.dockerApi = new DockerAPIClient();
  }

  _normalizeHostIp(ip) {
    if (!ip || ip === '' || ip === '::' || ip === '::0' || ip === '0.0.0.0') {
      return '0.0.0.0';
    }
    return ip;
  }

  async initialize() {
    return await this.dockerApi.connect();
  }

  /**
   * Initialize Docker API (async initialization)
   * @private
   */
  async _initializeDocker() {
    try {
      return await this.dockerApi.connect();
    } catch (error) {
      this.logWarn('Docker API initialization failed:', error.message);
      return false;
    }
  }

  /**
   * Get Docker system information using structured API data
   * @returns {Promise<Object>} System information
   */
  async getSystemInfo() {
    try {
      await this.dockerApi._ensureConnected();
      const [versionInfo, systemInfo] = await Promise.all([
        this.dockerApi.getSystemVersion(),
        this.dockerApi.getSystemInfo()
      ]);

      const serverVersion = versionInfo.server;
      
      return {
        type: "system",
        hostname: systemInfo.Name || "docker-host",
        version: serverVersion || "unknown",
        platform: "docker",
        docker_version: serverVersion,
        containers_running: systemInfo.ContainersRunning || 0,
        containers_total: systemInfo.Containers || 0,
        images: systemInfo.Images || 0,
        kernel_version: systemInfo.KernelVersion,
        operating_system: systemInfo.OperatingSystem,
        os_type: systemInfo.OSType,
        architecture: systemInfo.Architecture,
        ncpu: systemInfo.NCPU || 0,
        memory: systemInfo.MemTotal || 0,
        platform_data: {
          description: `Docker ${serverVersion}`,
          storage_driver: systemInfo.Driver,
          logging_driver: systemInfo.LoggingDriver,
          cgroup_driver: systemInfo.CgroupDriver,
          swarm_status: systemInfo.Swarm?.LocalNodeState || "inactive",
        },
      };
    } catch (err) {
      this.logError(
        "Error collecting Docker system info:",
        err.message,
        err.stack
      );
      return {
        type: "system",
        hostname: "Unknown Docker host",
        version: "unknown",
        platform: "docker",
        error: err.message,
      };
    }
  }


  /**
   * Get Docker applications (containers)
   * @returns {Promise<Array>} List of applications
   */
  async getApplications() {
    try {
      const containers = await this.dockerApi.listContainers();
      return containers.map((container) => ({
        type: "application",
        id: container.ID,
          name: container.Names,
        status: container.State,
        version: "N/A",
        image: container.Image,
        command: container.Command,
        created: container.Created,
        platform: "docker",
        platform_data: {
          type: "container",
          size: container.Size,
          mounts: container.Mounts,
          networks: container.Networks,
        },
      }));
    } catch (err) {
      this.logError(
        "Error collecting Docker applications:",
        err.message,
        err.stack
      );
      return [
        {
          type: "application",
          name: "Docker containers collection failed",
          error: err.message,
          platform: "docker",
        },
      ];
    }
  }

  /**
   * Get Docker network ports (hybrid: both container and system)
   * @returns {Promise<Array>} List of port entries
   */
  async getPorts() {
    const ttl = parseInt(process.env.DOCKER_CACHE_PORTS_TTL_MS || '4000', 10);
    return this.cacheGetOrSet('ports', async () => {
      try {
        const allPorts = [];
        const dockerPortsMap = new Map();
        const dockerProcessMap = new Map();
        const containerCreationTimeMap = new Map();

        try {
          const dockerContainers = await this.getApplications();
            dockerContainers.forEach((container) => {
            if (container.created) {
              containerCreationTimeMap.set(container.id, container.created);
            }
          });

          const dockerPorts = await this._getDockerContainerPorts();
          dockerPorts.forEach((port) => {
            const normalizedIp = this._normalizeHostIp(port.host_ip);
            const key = `${normalizedIp}:${port.host_port}:${port.protocol}`;
            if (!dockerPortsMap.has(key)) {
              if (port.container_id) {
                port.created = containerCreationTimeMap.get(port.container_id) || null;
              }
              dockerPortsMap.set(key, port);
              allPorts.push(port);
            }
          });

          const allRunningContainers = await this._getHostNetworkContainers();
          allRunningContainers.forEach((container) => {
            if (container.pids && container.pids.length > 0) {
              container.pids.forEach((pid) => {
                dockerProcessMap.set(pid, container);
              });
            }

            if (container.internalPorts && container.internalPorts.length > 0) {
              container.internalPorts.forEach((internalPort) => {
                const normalizedIp = this._normalizeHostIp(internalPort.host_ip);
                const publishedKey = `${normalizedIp}:${internalPort.host_port}:${internalPort.protocol}`;
                const internalKey = `${normalizedIp}:${internalPort.host_port}:${internalPort.protocol}:${container.id}:internal`;

                if (!dockerPortsMap.has(publishedKey) && !dockerPortsMap.has(internalKey)) {
                  internalPort.created = containerCreationTimeMap.get(container.id) || null;
                  dockerPortsMap.set(internalKey, internalPort);
                  allPorts.push(this.normalizePortEntry(internalPort));
                }
              });
            }
          });
        } catch (dockerErr) {
          this.logWarn("Failed to collect Docker container-specific data:", dockerErr.message);
        }

        try {
          const systemPorts = await this._getSystemPorts();

          for (const port of systemPorts) {
            const normalizedIp = this._normalizeHostIp(port.host_ip);
            const key = `${normalizedIp}:${port.host_port}:${port.protocol || 'tcp'}`;
            if (dockerPortsMap.has(key)) {
              continue;
            }

            let dockerInfo = null;

            if (port.pids && port.pids.length > 0) {
              for (const pid of port.pids) {
                if (dockerProcessMap.has(pid)) {
                  const container = dockerProcessMap.get(pid);
                  dockerInfo = {
                    containerName: container.name,
                    containerId: container.id,
                    target: `${container.id.substring(0, 12)}:internal(host-net)`,
                    composeProject: container.composeProject || null,
                  };
                  port.created = containerCreationTimeMap.get(container.id) || null;
                  break;
                }
              }
            }

            if (!dockerInfo) {
              dockerInfo = await this._checkIfPortBelongsToDocker(port);
              if (dockerInfo && dockerInfo.containerId) {
                port.created = containerCreationTimeMap.get(dockerInfo.containerId) || null;
              }
            }

            if (dockerInfo) {
              const dockerPort = this.normalizePortEntry({
                ...port,
                source: "docker",
                owner: dockerInfo.containerName,
                target: dockerInfo.target,
                container_id: dockerInfo.containerId,
                app_id: dockerInfo.containerName,
                compose_project: dockerInfo.composeProject || null,
              });

              if (!dockerPortsMap.has(key)) {
                allPorts.push(dockerPort);
                dockerPortsMap.set(key, dockerPort);
              }
            } else {
              allPorts.push(port);
            }
          }
        } catch (systemErr) {
          this.logWarn("Failed to collect and process system ports:", systemErr.message);
        }

        this.logInfo(`Total unique ports collected: ${allPorts.length}`);
        return allPorts;
      } catch (err) {
        this.logError("Critical error in getPorts:", err.message, err.stack);
        return [
          {
            type: "port",
            error: `Critical error in getPorts: ${err.message}`,
            platform: "docker",
          },
        ];
      }
    }, { ttlMs: ttl });
  }

  /**
   * Get Docker container ports with explicit port mappings
   * @returns {Promise<Array>} Docker port entries
   * @private
   */
  async _getDockerContainerPorts() {
    try {
      const containers = await this.dockerApi.listContainers();
      const portEntries = [];

      for (const container of containers) {
        const containerName = container.Names;
        const containerId = container.ID;
        const composeProject = container.Labels?.['com.docker.compose.project'] || null;
        const composeService = container.Labels?.['com.docker.compose.service'] || null;
        
        if (!container.Ports || container.Ports.length === 0) {
          continue;
        }

        const rawPorts = await this.dockerApi.docker.getContainer(container.ID).inspect();
        const portBindings = rawPorts.NetworkSettings.Ports || {};

  for (const [containerPort, hostBindings] of Object.entries(portBindings)) {
          if (!hostBindings) continue;
          
          const [port, protocol] = containerPort.split('/');
          const targetPort = parseInt(port, 10);

          for (const binding of hostBindings) {
            const hostIp = this._normalizeHostIp(binding.HostIp);
            const hostPort = parseInt(binding.HostPort, 10);

            if (isNaN(hostPort)) continue;

            portEntries.push(
              this.normalizePortEntry({
                source: "docker",
                owner: containerName,
                protocol: protocol,
                host_ip: hostIp,
                host_port: hostPort,
                target: `${containerId}:${targetPort}`,
                container_id: containerId,
                app_id: containerName,
                compose_project: composeProject,
                compose_service: composeService,
                pids: [],
              })
            );
          }
        }
      }

      return portEntries;
    } catch (err) {
      this.logWarn("Failed to get Docker container ports:", err.message);
      return [];
    }
  }

  /**
   * Get containers that might be using host networking.
   * This version is optimized to run inspections in parallel for better performance.
   * @returns {Promise<Array>} Container information
   * @private
   */
  async _getHostNetworkContainers() {
    try {
      const containerList = await this.dockerApi.listContainers();

      if (containerList.length === 0) {
        return [];
      }

      const promises = containerList.map(async (container) => {
        const containerId = container.ID;
        const containerName = container.Names;
        const image = container.Image;
        const composeProject = container.Labels?.['com.docker.compose.project'] || null;
        const composeService = container.Labels?.['com.docker.compose.service'] || null;
        try {
          const [inspection, pids] = await Promise.all([
            this.dockerApi.inspectContainer(containerId),
            this._getContainerProcesses(containerId),
          ]);

          const networkMode = inspection.HostConfig?.NetworkMode || '';
          const exposedPorts = inspection.Config?.ExposedPorts || {};
          const portBindings = inspection.NetworkSettings?.Ports || {};

          const internalPorts = [];
          if (exposedPorts && typeof exposedPorts === 'object') {
            Object.keys(exposedPorts).forEach(portDef => {
              if (portBindings[portDef] && portBindings[portDef] !== null) {
                return;
              }
              const [port, protocol] = portDef.split('/');
              const portNum = parseInt(port, 10);
              if (!isNaN(portNum)) {
                const internalPort = {
                  source: "docker",
                  owner: containerName,
                  protocol: protocol || "tcp",
                  host_ip: "0.0.0.0",
                  host_port: portNum,
                  target: `${containerId.substring(0, 12)}:${portNum}(internal)`,
                  container_id: containerId,
                  app_id: containerName,
                  compose_project: composeProject,
                  compose_service: composeService,
                  internal: true
                };
                internalPorts.push(internalPort);
              }
            });
          }

          return {
            id: containerId,
            name: containerName,
            image: image,
            networkMode: networkMode,
            exposedPorts: exposedPorts,
            pids: pids,
            internalPorts: internalPorts,
            composeProject: composeProject,
            composeService: composeService
          };
        } catch (inspectErr) {
          this.logWarn(
            `Failed to inspect or get processes for container ${containerId} (${containerName}):`,
            inspectErr.message
          );
          return null;
        }
      });

      const finalContainers = (await Promise.all(promises)).filter(Boolean);
      return finalContainers;
    } catch (err) {
      this.logWarn("Failed to get host network containers:", err.message);
      return [];
    }
  }

  /**
   * Get process IDs running inside a container
   * @param {string} containerId Container ID
   * @returns {Promise<Array>} Array of PIDs
   * @private
   */
  async _getContainerProcesses(containerId) {
    try {
      return await this.dockerApi.getContainerProcesses(containerId);
    } catch (err) {
      this.logWarn(
        `Failed to get processes for container ${containerId}:`,
        err.message
      );
      return [];
    }
  }

  /**
   * Check if a system port belongs to a Docker container. This is a fallback method.
   * The primary PID-based matching is now done in getPorts.
   * @param {Object} port Port information
   * @returns {Promise<Object|null>} Docker information if found
   * @private
   */
  async _checkIfPortBelongsToDocker(port) {
    try {
      const containers = await this.dockerApi.listContainers();
      
      for (const container of containers) {
        const inspection = await this.dockerApi.inspectContainer(container.ID);
        const portBindings = inspection.NetworkSettings?.Ports || {};

        for (const key in portBindings) {
          if (!Object.prototype.hasOwnProperty.call(portBindings, key)) continue;
          const hostBindings = portBindings[key];
          if (!hostBindings) continue;
          
          for (const binding of hostBindings) {
            if (parseInt(binding.HostPort, 10) === port.host_port) {
              return {
                containerName: container.Names,
                containerId: container.ID,
                target: `${container.ID}:${port.host_port}`,
                composeProject: container.Labels?.['com.docker.compose.project'] || null,
              };
            }
          }
        }
      }

      if (port.owner && port.owner !== "unknown") {
        const containerInfo = await this._getContainerByProcessName(
          port.owner,
          port.host_port
        );
        if (containerInfo) {
          return containerInfo;
        }
      }

      return null;
    } catch (err) {
      this.logWarn(
        `Error in _checkIfPortBelongsToDocker for port ${port.host_port}:`,
        err.message
      );
      return null;
    }
  }

  /**
   * Get container information by PID
   * @param {number} pid Process ID
   * @returns {Promise<Object|null>} Container information
   * @private
   */
  async _getContainerByPid(pid) {
    try {
      const { stdout: cgroupOutput } = await execAsync(
        `cat /proc/${pid}/cgroup 2>/dev/null || echo ""`
      );

      if (
        cgroupOutput.includes("docker") ||
        cgroupOutput.includes("containerd")
      ) {
        const dockerMatch = cgroupOutput.match(/docker[/-]([a-f0-9]{64})/);
        const containerdMatch = cgroupOutput.match(
          /containerd[/-]([a-f0-9]{64})/
        );

        const fullContainerId = dockerMatch
          ? dockerMatch[1]
          : containerdMatch
          ? containerdMatch[1]
          : null;

        if (fullContainerId) {
          try {
            const inspection = await this.dockerApi.inspectContainer(fullContainerId);
            const containerName = inspection.Name.replace(/^\//, '');
            const composeProject = inspection.Config?.Labels?.['com.docker.compose.project'] || null;

            return {
              containerName: containerName,
              containerId: fullContainerId,
              target: `${fullContainerId.substring(0, 12)}:internal`,
              composeProject: composeProject,
            };
          } catch (err) {
            this.logWarn(`Could not inspect container ${fullContainerId}:`, err.message);
          }
        }
      }

      return null;
    } catch (err) {
      this.logWarn(`Error getting container by PID ${pid}:`, err.message);
      return null;
    }
  }

  /**
   * Get container information by process name
   * @param {string} processName Process name
   * @param {number} port Port number
   * @returns {Promise<Object|null>} Container information
   * @private
   */
  async _getContainerByProcessName(processName, port) {
    try {
      const containers = await this.dockerApi.listContainers();

      for (const container of containers) {
        const containerName = container.Names;
        const containerId = container.ID;
        const image = container.Image;
        const composeProject = container.Labels?.['com.docker.compose.project'] || null;

        const nameLower = containerName.toLowerCase();
        const imageLower = image.toLowerCase();
        const processLower = processName.toLowerCase();

        if (
          (nameLower.includes("portracker") ||
            imageLower.includes("portracker")) &&
          (processLower.includes("node") || processLower.includes("portracker"))
        ) {
          return {
            containerName: containerName,
            containerId: containerId,
            target: `${containerId.substring(0, 12)}:${port}`,
            composeProject: composeProject,
          };
        }

        if (
          nameLower.includes(processLower) ||
          imageLower.includes(processLower) ||
          processLower.includes(nameLower.replace(/[^a-z0-9]/g, ""))
        ) {
          return {
            containerName: containerName,
            containerId: containerId,
            target: `${containerId.substring(0, 12)}:${port}`,
            composeProject: composeProject,
          };
        }
      }

      return null;
    } catch (err) {
      this.logWarn(
        `Error getting container by process name ${processName}:`,
        err.message
      );
      return null;
    }
  }

  /**
   * Get system ports using same logic as SystemCollector
   * @returns {Promise<Array>} System port entries
   * @private
   */
  async _getSystemPorts() {
    const isWindows = os.platform() === "win32";

    if (isWindows) {
  return await this._getWindowsSystemPorts();
    } else {
      return await this._getLinuxSystemPorts();
    }
  }

  /**
   * Get Linux system ports
   * @returns {Promise<Array>} System port entries
   * @private
   */
  async _getLinuxSystemPorts() {
    try {
      this.logInfo("Attempting nsenter method for comprehensive port collection with process names");
      const { stdout } = await execAsync("nsenter -t 1 -n ss -tulpn 2>/dev/null");
      const ports = this._parseLinuxSystemOutput(stdout);
      this.logInfo(`nsenter method successful: ${ports.length} ports found with process names`);
      return ports;
    } catch (nsenterErr) {
      this.logInfo(`nsenter method failed: ${nsenterErr.message}, trying alternative methods`);
      const msg = String(nsenterErr?.message || '').toLowerCase();
      if (msg.includes('permission denied') || msg.includes('operation not permitted') || msg.includes('exit code 1')) {
        this.logWarn('Hint: nsenter requires cap_add: [SYS_ADMIN] to access the host network namespace on Docker Desktop (macOS/Windows).');
      }
      
      try {
        const { stdout: netNsCheck } = await execAsync("readlink /proc/self/ns/net 2>/dev/null");
        const { stdout: hostNetNsCheck } = await execAsync("readlink /proc/1/ns/net 2>/dev/null");
        
        if (netNsCheck.trim() === hostNetNsCheck.trim()) {
          this.logInfo("Container has host network access, using direct ss");
          const { stdout } = await execAsync("ss -tulpn 2>/dev/null || ss -tuln");
          return this._parseLinuxSystemOutput(stdout);
        } else {
          this.logInfo("Limited network access, using container namespace ss");
          const { stdout } = await execAsync("ss -tulpn 2>/dev/null || ss -tuln");
          return this._parseLinuxSystemOutput(stdout);
        }
      } catch (nsCheckErr) {
        this.logInfo(`Network namespace check failed: ${nsCheckErr.message}, falling back to /proc method`);
        
        if (this.procParser) {
          try {
            this.logInfo("Falling back to /proc filesystem method");
            const procWorks = await this.procParser.testProcAccess();
            
            if (procWorks) {
              const tcpPorts = await this.procParser.getTcpPorts();
              const includeAllUdp = process.env.INCLUDE_UDP === 'true';
              const udpPorts = await this.procParser.getUdpPorts(includeAllUdp);
              const allPorts = [...tcpPorts, ...udpPorts];
              
              if (allPorts.length >= 2) {
                for (const port of allPorts) {
                  if (port.pid) {
                    const containerId = await this.procParser.getContainerByPid(port.pid);
                    if (containerId) {
                      port.container_id = containerId;
                      port.source = 'docker';
                      try {
                        const inspection = await this.dockerApi.inspectContainer(containerId);
                        port.owner = inspection.Name.replace(/^\//, '');
                      } catch (err) {
                        this.logWarn("Container inspection failed during /proc attribution:", err.message);
                      }
                    }
                  }
                }
                
                this.logInfo(`Fallback /proc method: ${allPorts.length} ports found (TCP: ${tcpPorts.length}, UDP: ${udpPorts.length})`);
                return allPorts.map(port => this.normalizePortEntry(port));
              }
            }
          } catch (procErr) {
            this.logWarn("Proc fallback also failed:", procErr.message);
          }
        }
        
        try {
          this.logInfo("Final fallback: netstat command");
          const { stdout } = await execAsync("netstat -tulnp 2>/dev/null || netstat -tuln");
          return this._parseLinuxSystemOutput(stdout, true);
        } catch (fallbackErr) {
          this.logError(`All methods failed: ${fallbackErr.message}`);
          return [];
        }
      }
    }
  }

  /**
   * Get Windows system ports
   * @returns {Promise<Array>} System port entries
   * @private
   */
  async _getWindowsSystemPorts() {
    const ttl = parseInt(process.env.PORT_CACHE_TTL_MS || '5000', 10);
    return this.cacheGetOrSet('windowsSystemPorts', async () => {
      try {
        this.logInfo('Attempting to get Windows ports with "netstat -ano" command');
        const { stdout } = await execAsync("netstat -ano");
        return this._parseWindowsSystemOutput(stdout);
      } catch (err) {
        this.logWarn(`Windows "netstat -ano" failed: ${err.message}. Trying "netstat -an" as fallback.`);
        try {
          const { stdout } = await execAsync("netstat -an");
          return this._parseWindowsSystemOutput(stdout);
        } catch (fallbackErr) {
          this.logError(`Windows "netstat -an" fallback also failed: ${fallbackErr.message}`);
          return [];
        }
      }
    }, { ttlMs: ttl });
  }

  /**
   * Parse Linux system command output (ss or netstat) with enhanced process detection
   * @param {string} output Command output
   * @param {boolean} isNetstat Whether this is netstat output (vs ss)
   * @returns {Array} Parsed port entries
   * @private
   */
  _parseLinuxSystemOutput(output, isNetstat = false) {
    const entries = [];
    const lines = output.split("\n");
    const startIndex = isNetstat ? 2 : 1;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(/\s+/);
      if (cols.length < 4) continue;

      const protocol = cols[0].toLowerCase();
      if (!protocol.includes("tcp") && !protocol.includes("udp")) continue;

      const localAddr = isNetstat ? cols[3] : cols[4];
      if (!localAddr || !localAddr.includes(":")) continue;

      let host_ip, portStr;
      if (localAddr.includes("[") && localAddr.includes("]:")) {
        const m = localAddr.match(/\[([^\]]+)\]:(\d+)/);
        if (!m) continue;
        host_ip = m[1];
        portStr = m[2];
      } else {
        const idx = localAddr.lastIndexOf(":");
        if (idx === -1) continue;
        host_ip = localAddr.slice(0, idx);
        portStr = localAddr.slice(idx + 1);
      }

      const host_port = parseInt(portStr, 10);
      if (isNaN(host_port) || host_port <= 0 || host_port > 65535) continue;

      let owner = "unknown";
      let pid = null;
      if (!isNetstat && cols.length > 6) {
        const proc = cols[cols.length - 1];
        const m2 = proc.match(/\("([^"]+)",pid=(\d+)/);
        if (m2) {
          owner = m2[1];
          pid = parseInt(m2[2], 10);
        }
      } else if (isNetstat && cols.length > 6) {
        const proc = cols[cols.length - 1];
        const m3 = proc.match(/(\d+)\/(.+)/);
        if (m3) {
          pid = parseInt(m3[1], 10);
          owner = m3[2];
        }
      }

      if (owner === "dockerd") {
        entries.push(
          this.normalizePortEntry({
            source: "docker",
            owner: "unknown",
            protocol: protocol.includes("tcp") ? "tcp" : "udp",
            host_ip: host_ip === "*" ? "0.0.0.0" : host_ip,
            host_port,
            target: null,
            container_id: null,
            app_id: null,
            pids: pid !== null ? [pid] : [],
          })
        );
      } else {
        entries.push(
          this.normalizePortEntry({
            source: "system",
            owner,
            protocol: protocol.includes("tcp") ? "tcp" : "udp",
            host_ip: host_ip === "*" ? "0.0.0.0" : host_ip,
            host_port,
            target: null,
            container_id: null,
            app_id: null,
            pids: pid !== null ? [pid] : [],
          })
        );
      }
    }

    return entries;
  }

  /**
   * Parse Windows system command output (netstat)
   * @param {string} output Command output
   * @returns {Array} Parsed port entries
   * @private
   */
  _parseWindowsSystemOutput(output) {
    const entries = [];
    const lines = output.split("\n");
    for (let i = 4; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw || !raw.includes('LISTENING')) continue;
      const line = raw.trim();
      if (!line) continue;
      const cols = line.split(/\s+/);
      if (cols.length < 4) continue;
      const protocol = cols[0].toLowerCase();
      if (!protocol.includes('tcp') && !protocol.includes('udp')) continue;
      const localAddr = cols[1];
      if (!localAddr || !localAddr.includes(':')) continue;
      const lastColon = localAddr.lastIndexOf(':');
      if (lastColon === -1) continue;
      let host_ip = localAddr.substring(0, lastColon);
      const portStr = localAddr.substring(lastColon + 1);
      const port = parseInt(portStr, 10);
      if (Number.isNaN(port) || port <= 0 || port > 65535) continue;
      if (host_ip === '*' || host_ip === '0.0.0.0') host_ip = '0.0.0.0';
      const pidStr = cols[cols.length - 1];
      const pidNum = parseInt(pidStr, 10);
      const pid = Number.isNaN(pidNum) ? null : pidNum;
      entries.push(this.normalizePortEntry({
        source: 'system',
        owner: pid ? `Process (pid ${pid})` : 'unknown',
        protocol: protocol.includes('tcp') ? 'tcp' : 'udp',
        host_ip,
        host_port: port,
        target: null,
        container_id: null,
        app_id: null,
        pids: pid ? [pid] : []
      }));
    }
    return entries;
  }

  /**
   * Check if Docker is available with confidence score
   * @returns {Promise<number>} Confidence score 0-100
   */
  async isCompatible() {
    this.logInfo("--- Docker Collector Compatibility Check ---");

    try {
      const stats = await fs.promises.stat("/var/run/docker.sock");
      if (stats.isSocket()) {
        this.logInfo(
          "Docker socket found at /var/run/docker.sock. Assigning compatibility score (50)."
        );
        return 50;
      }
    } catch (err) {
      this.logWarn("Could not stat /var/run/docker.sock. Is it mounted?", err.message);
    }
    if (process.platform === 'win32') {
      try {
        const ver = await this.dockerApi.version();
        if (ver && ver.Version) {
          this.logInfo(`Docker API reachable via named pipe. Assigning compatibility score (50). Version: ${ver.Version}`);
          return 50;
        }
      } catch (pipeErr) {
        this.logInfo('Attempt to access Docker via named pipe failed.', pipeErr.message);
      }
    } else {
      try {
        const ver = await this.dockerApi.version();
        if (ver && ver.Version) {
          this.logInfo(`Docker API reachable (no /var/run/docker.sock). Assigning compatibility score (40). Version: ${ver.Version}`);
          return 40;
        }
      } catch (verErr) {
        this.logInfo('Docker API version call failed.', verErr.message);
      }
    }

    this.logInfo('No Docker indicators found. Incompatible (score 0).');
    return 0;
  }

  /**
   * Store detection information for API access
   * @param {Object} info Detection information
   */
  setDetectionInfo(info) {
    this.detectionInfo = info;
  }
}

module.exports = DockerCollector;
