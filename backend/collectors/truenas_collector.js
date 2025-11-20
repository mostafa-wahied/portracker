/**
 * PORTS TRACKER - TRUENAS SCALE COLLECTOR
 *
 * Implements a hybrid data collection strategy for TrueNAS SCALE systems.
 * Collects core system information, Docker containers, and network ports
 * using local command-line tools (e.g., `docker`, `ss`). This phase
 * operates without needing a TrueNAS API key.
 * If a TRUENAS_API_KEY is provided, it attempts to collect enhanced
 * information such as TrueNAS native applications, virtual machines,
 * and detailed system information by connecting to the TrueNAS
 * middleware via a WebSocket client (`TrueNASClient`).
 * The collector gracefully degrades if the API key is not available, providing
 * only the core data from the initial collection phase.
 */

const BaseCollector = require("./base_collector");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const fs = require("fs");
const { TrueNASClient } = require("../lib/truenas-rpc");
const DockerAPIClient = require("../lib/docker-api");
const PerformanceTracker = require("../utils/performance-tracker");
const ProcParser = require("../lib/proc-parser");

class TrueNASCollector extends BaseCollector {
  /**
   * Create a new TrueNAS collector
   * @param {Object} config Configuration options
   */
  constructor(config = {}) {
    super(config);
    this.platform = "truenas";
    this.platformName = "TrueNAS";
    this.name = "TrueNAS Collector";
    this.client = new TrueNASClient({ debug: this.debug });
  this.procParser = new ProcParser();
  this.dockerApi = new DockerAPIClient();
    this._initializeDocker();
  this.cacheDisabled = this.cacheDisabled || process.env.DISABLE_CACHE === 'true';

    this.importantPorts = {
      51820: { service: "WireGuard", protocol: "udp" },
      51821: { service: "WireGuard-UI", protocol: "tcp" },
      51822: { service: "WireGuard", protocol: "udp" },
      500: { service: "IPsec IKE", protocol: "udp" },
      4500: { service: "IPsec NAT-T", protocol: "udp" },
      1194: { service: "OpenVPN", protocol: "udp" },
      1198: { service: "OpenVPN", protocol: "udp" },
      53: { service: "DNS", protocol: "udp" },
      67: { service: "DHCP", protocol: "udp" },
      68: { service: "DHCP", protocol: "udp" },
    };

    this.importantUdpPorts = {
      51820: "WireGuard",
      51822: "WireGuard",
      500: "IPsec IKE",
      4500: "IPsec NAT-T",
      1194: "OpenVPN",
      1198: "OpenVPN",
      53: "DNS",
      67: "DHCP",
      68: "DHCP",
    };
  }

  /**
   * Return only ports (used for quick port generation flows)
   * @returns {Promise<Array>} List of port entries
   */
  async getPorts() {
    try {
      const full = await this.collect();
      return full?.ports || [];
    } catch (err) {
      this.logError("Error collecting ports in getPorts:", err.message, err.stack);
      throw err;
    }
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
   * Safely convert container names to string format
   * Docker API can return Names as either string or array depending on context
   * @param {string|Array} names - Container names from Docker API
   * @returns {string} - Formatted container name string
   */
  _formatContainerNames(names) {
    if (Array.isArray(names)) {
      return names.join(', ');
    }
    return names || 'unknown';
  }

  /**
   * Check if this system is TrueNAS with confidence score
   * @param {Object} serverConfig The server's configuration, including API keys.
   * @returns {Promise<number>} Confidence score 0-100
   */
  async isCompatible(serverConfig) {
    let score = 0;
    let reasons = [];
    this.logInfo("Checking TrueNAS compatibility...");
    try {
      const { stdout: kernelInfo } = await execAsync("uname -a");
      if (kernelInfo.toLowerCase().includes("truenas")) {
        score += 60;
        reasons.push("TrueNAS kernel signature found");
        this.log("✓ Found TrueNAS kernel signature (+60)");
      }
    } catch (err) {
      this.logWarn(
        "Error checking kernel for TrueNAS compatibility:",
        err.message
      );
    }
    try {
      const { stdout: osRelease } = await execAsync(
        'cat /etc/os-release 2>/dev/null || echo ""'
      );
      if (osRelease.toLowerCase().includes("truenas")) {
        score += 40;
        reasons.push("TrueNAS OS release identifier found");
        this.log("✓ Found TrueNAS in OS release (+40)");
      }
    } catch (err) {
      this.logWarn(
        "Error checking OS release for TrueNAS compatibility:",
        err.message
      );
    }
    const socketPaths = [
      "/var/run/middlewared.sock",
      "/run/middlewared.sock",
      "/run/middleware/middlewared.sock",
    ];
    for (const socketPath of socketPaths) {
      try {
        const exists = fs.existsSync(socketPath);
        if (exists) {
          score += 10;
          reasons.push(`Found middleware socket at ${socketPath}`);
          this.log(`✓ Found middleware socket at ${socketPath} (+10)`);
          break; 
        }
      } catch (err) {
        this.logWarn(`Error checking socket at ${socketPath}:`, err.message);
      }
    }
    const truenasDirs = [
      "/usr/local/etc/ix",
      "/etc/netcli",
      "/data/truenas-config",
    ];
    for (const dir of truenasDirs) {
      try {
        const exists = fs.existsSync(dir);
        if (exists) {
          score += 10;
          reasons.push(`TrueNAS directory found: ${dir}`);
          this.log(`✓ Found TrueNAS directory: ${dir} (+10)`);
          break;
        }
      } catch (err) {
        this.logWarn(`Error checking directory ${dir}:`, err.message);
      }
    }

    if (
      (serverConfig && serverConfig.truenas_api_key) ||
      process.env.TRUENAS_API_KEY
    ) {
      score += 20;
      reasons.push("TrueNAS API key provided");
      this.log("✓ Found TrueNAS API key (+20)");
    }

    this.detectionReasons = reasons;
    if (score > 0) {
      this.logInfo(
        `TrueNAS detector final score: ${score}/100. Reasons: ${reasons.join(
          "; "
        )}`
      );
    } else {
      this.log(
        `TrueNAS detector final score: ${score}/100. Reasons: ${reasons.join(
          "; "
        )}`
      );
    }
    return score;
  }

  /**
   * Store detection information for API access
   * @param {Object} info Detection information
   */
  setDetectionInfo(info) {
    this.log("Setting detection info for TrueNASCollector:", info);
    this.detectionInfo = info;
  }

  /**
   * Get Docker containers using Docker API
   * @returns {Promise<Array>} List of Docker containers
   */
  async _getDockerContainers() {
    try {
      this.log('Getting Docker containers via Docker API');
      await this.dockerApi._ensureConnected();
      
      const containers = await this.dockerApi.listContainers({ all: true });
      
      const containerData = [];
      for (const container of containers) {
        try {
          const inspection = await this.dockerApi.inspectContainer(container.ID);
          containerData.push({
            id: container.ID,
            name: this._formatContainerNames(container.Names),
            status: this._mapDockerStatus(container.State),
            image: container.Image,
            command: container.Command,
            created: container.Created,
            ports: inspection.HostConfig.PortBindings,
            networks: Object.keys(inspection.NetworkSettings.Networks).join(", "),
          });
        } catch (inspectErr) {
          this.logWarn(`Failed to inspect container ${container.ID}: ${inspectErr.message}`);
          containerData.push({
            id: container.ID,
            name: this._formatContainerNames(container.Names),
            status: this._mapDockerStatus(container.State),
            image: container.Image,
            command: container.Command,
            created: container.Created,
            ports: {},
            networks: '',
          });
        }
      }

      return containerData;
    } catch (err) {
      this.logError(
        'Error getting Docker containers via Docker API:',
        err.message,
        err.stack
      );
      return this._getDockerContainersAlternative();
    }
  }

  /**
   * Alternative method to get Docker containers using Docker API (retry with different options).
   * @returns {Promise<Array>} List of Docker containers
   */
  async _getDockerContainersAlternative() {
    try {
      this.logWarn('Using alternative Docker API call for container collection.');
      const containers = await this.dockerApi.listContainers({ all: true });
      return containers.map((container) => ({
        id: container.ID,
        name: this._formatContainerNames(container.Names),
        status: this._mapDockerStatus(container.State),
        image: container.Image,
        command: container.Command,
        created: container.Created,
        ports: container.Ports,
        networks: container.Networks || '',
      }));
    } catch (err) {
      this.logError(
        'Error getting Docker containers via alternative Docker API call:',
        err.message,
        err.stack
      );
      return [];
    }
  }

  /**
   * Parse Docker ports string into structured format
   * @param {string} portsString Ports string from Docker
   * @returns {Array} Structured ports information
   */
  _parseDockerPorts(portsString) {
    if (!portsString || typeof portsString !== "string") {
      return [];
    }
    try {
      const ports = [];
      const portMappings = portsString.split(", ");
      for (const mapping of portMappings) {
        if (mapping.includes("->")) {
          const [external, internal] = mapping.split("->");
          let hostIP = "0.0.0.0";
          let hostPort;
          if (external.includes(":")) {
            [hostIP, hostPort] = external.split(":");
          } else {
            hostPort = external;
          }
          const [containerPort, proto] = internal.split("/");
          ports.push({
            host_ip: hostIP === "0.0.0.0" || hostIP === "::" ? "*" : hostIP,
            host_port: parseInt(hostPort, 10),
            container_port: parseInt(containerPort, 10),
            protocol: proto || "tcp",
          });
        } else {
          const [port, proto] = mapping.split("/");
          ports.push({
            container_port: parseInt(port, 10),
            protocol: proto || "tcp",
          });
        }
      }
      return ports;
    } catch (err) {
      this.logWarn("Error parsing Docker ports string:", err.message, {
        portsString,
      });
      return [];
    }
  }

  /**
   * Extract ports from TrueNAS app configuration
   * @param {Object} app TrueNAS app object
   * @returns {Array} Array of port objects
   */
  _extractAppPorts(app) {
    const ports = [];
    try {
      if (app.port_mappings && Array.isArray(app.port_mappings)) {
        for (const mapping of app.port_mappings) {
          ports.push({
            host_ip: mapping.host_ip || "*",
            host_port: mapping.host_port,
            container_port: mapping.container_port,
            protocol: mapping.protocol || "tcp",
          });
        }
      }
      if (
        app.config &&
        app.config.port_mappings &&
        Array.isArray(app.config.port_mappings)
      ) {
        for (const mapping of app.config.port_mappings) {
          ports.push({
            host_ip: mapping.host_ip || "*",
            host_port: mapping.host_port,
            container_port: mapping.container_port,
            protocol: mapping.protocol || "tcp",
          });
        }
      }
    } catch (err) {
      this.logWarn(
        "Error extracting app ports from TrueNAS app object:",
        err.message,
        { appName: app.name }
      );
    }
    return ports;
  }

  /**
   * Map TrueNAS app status to standardized status
   * @param {string} status TrueNAS app status
   * @returns {string} Standardized status
   */
  _mapStatus(status) {
    switch (status?.toLowerCase()) {
      case "running":
        return "running";
      case "stopped":
        return "stopped";
      case "error":
        return "error";
      default:
        return status || "unknown";
    }
  }

  /**
   * Map Docker status to standardized status
   * @param {string} status Docker status
   * @returns {string} Standardized status
   */
  _mapDockerStatus(status) {
    const lowerStatus = status?.toLowerCase() || "";
    if (lowerStatus.includes("up") || lowerStatus.includes("running")) {
      return "running";
    } else if (
      lowerStatus.includes("exited") ||
      lowerStatus.includes("stopped")
    ) {
      return "stopped";
    } else if (lowerStatus.includes("restarting")) {
      return "restarting";
    } else if (lowerStatus.includes("created")) {
      return "created";
    } else if (lowerStatus.includes("paused")) {
      return "paused";
    } else {
      return "unknown";
    }
  }

  /**
   * Get ports from Docker containers
   * @returns {Promise<Array>} List of Docker container ports
   */
  async _getDockerPorts() {
    try {
      this.logInfo('Getting Docker port mappings via Docker API');
      this._debugNetworkInterfaces();
      
      await this.dockerApi._ensureConnected();
      const containers = await this.dockerApi.listContainers({ all: true });
      const ports = [];
      
      for (const container of containers) {
        const containerName = this._formatContainerNames(container.Names);
        const containerId = container.ID;

        const rawPorts = await this.dockerApi.docker.getContainer(container.ID).inspect();
        const portBindings = rawPorts.NetworkSettings.Ports || {};

        if (container.Ports && container.Ports.length > 0) {
          for (const [containerPort, hostBindings] of Object.entries(portBindings)) {
            if (!hostBindings) continue;
          
          const [port, protocol] = containerPort.split('/');
          
          for (const hostBinding of hostBindings) {
            const hostIP = this._resolveHostIP(hostBinding.HostIp || '0.0.0.0');
            const hostPort = hostBinding.HostPort;

            if (hostIP.endsWith(".255")) {
              this.log(
                `Skipping broadcast address port for ${containerName}: ${hostIP}:${hostPort}`
              );
              continue;
            }

            ports.push({
              source: "docker",
              owner: containerName,
              protocol: protocol || "tcp",
              host_ip: hostIP,
              host_port: parseInt(hostPort, 10),
              target: port,
              container_id: containerId,
              vm_id: null,
              app_id: containerId,
            });
          }
        }
        }

        const containerInspection = await this.dockerApi.inspectContainer(containerId);
        const exposedPorts = containerInspection.Config.ExposedPorts || {};
        
        for (const [exposedPort] of Object.entries(exposedPorts)) {
          const [port, protocol] = exposedPort.split('/');
          const portNum = parseInt(port, 10);
          
          const isPublished = portBindings[exposedPort] && portBindings[exposedPort] !== null;
          
          if (!isNaN(portNum) && !isPublished) {
            ports.push({
              source: "docker",
              owner: containerName,
              protocol: protocol || "tcp",
              host_ip: "0.0.0.0",
              host_port: portNum,
              target: `${containerId.substring(0, 12)}:${portNum}(internal)`,
              container_id: containerId,
              vm_id: null,
              app_id: containerId,
              internal: true
            });
          }
        }
      }
      
      return ports;
    } catch (err) {
      this.logError(
        "Error getting Docker port mappings for port list:",
        err.message,
        err.stack
      );
      return [];
    }
  }

  /**
   * Resolve wildcard and generic IPs to actual server IP with network context awareness
   * @param {string} host_ip The host IP from Docker
   * @returns {string} Resolved IP address
   */
  _resolveHostIP(host_ip) {
    if (host_ip === "0.0.0.0" || host_ip === "::") {
      return host_ip;
    }

    switch (host_ip) {
      case "*":
        return "0.0.0.0"; 
      case "127.0.0.1":
      case "localhost":
        return "127.0.0.1";
      default:
        return host_ip;
    }
  }

  /**
   * @returns {string} Server IP address, now always '0.0.0.0' for wildcard.
   */
  _getServerIP() {
    try {
      const os = require("os");
      const networkInterfaces = os.networkInterfaces();
      
      const primaryInterfaces = ['eth0', 'enp0s3', 'enp0s8', 'ens33', 'ens160', 'em0'];
      
      for (const interfaceName of primaryInterfaces) {
        if (networkInterfaces[interfaceName]) {
          const addresses = networkInterfaces[interfaceName];
          for (const addr of addresses) {
            if (!addr.internal && addr.family === 'IPv4') {
              this.log(`Found primary interface ${interfaceName}: ${addr.address}`);
              return addr.address;
            }
          }
        }
      }
      
      for (const [interfaceName, addresses] of Object.entries(networkInterfaces)) {
        if (interfaceName.startsWith('docker') || 
            interfaceName.startsWith('br-') ||
            interfaceName.startsWith('veth') ||
            interfaceName === 'lo') {
          continue;
        }
        
        for (const addr of addresses) {
          if (!addr.internal && addr.family === 'IPv4') {
            if (addr.address.startsWith('192.168.') ||
                addr.address.startsWith('10.') ||
                (addr.address.startsWith('172.') && 
                 parseInt(addr.address.split('.')[1]) >= 16 && 
                 parseInt(addr.address.split('.')[1]) <= 31)) {
              this.log(`Found suitable interface ${interfaceName}: ${addr.address}`);
              return addr.address;
            }
          }
        }
      }
      
      this.logWarn("Could not determine server IP, falling back to 0.0.0.0");
      return "0.0.0.0";
    } catch (error) {
      this.logError("Error determining server IP:", error.message);
      return "0.0.0.0";
    }
  }

  /**
   * Get system ports using platform-adaptive approach
   * @returns {Promise<Array>} List of system ports
   */
  async _getSystemPorts() {
    this.logInfo('=== TrueNAS System Ports Collection (Platform-Adaptive) ===');
    
    const isContainerized = this._detectContainerizedEnvironment();
    this.logInfo(`Container environment detected: ${isContainerized}`);
    
    if (this.procParser && !isContainerized) {
      try {
        this.logInfo('Attempting primary method: Enhanced /proc filesystem parsing');
        const procWorks = await this.procParser.testProcAccess();
        
        if (procWorks) {
          const tcpPorts = await this.procParser.getTcpPorts();
          const includeUdp = process.env.INCLUDE_UDP === 'true';
          const udpPorts = await this.procParser.getUdpPorts(includeUdp);
          
          const allPorts = [...tcpPorts, ...udpPorts].map(port => ({
            source: 'system',
            owner: port.owner,
            protocol: port.protocol,
            host_ip: port.host_ip === '*' ? '0.0.0.0' : port.host_ip,
            host_port: port.host_port,
            target: null,
            container_id: null,
            app_id: null,
            pids: port.pid ? [port.pid] : []
          }));

          this.logInfo(`Enhanced /proc parsing successful: ${allPorts.length} ports found`);
          if (allPorts.length > 0) {
            return allPorts;
          }
        } else {
          this.logWarn('Enhanced /proc filesystem test failed, trying fallback methods');
        }
      } catch (procErr) {
        this.logWarn('Failed to get ports via enhanced /proc parsing:', procErr.message);
      }
    } else if (isContainerized) {
      this.logInfo('Containerized environment detected, skipping /proc method and using network commands');
    }
    
    try {
      this.logInfo('Attempting enhanced ss command with host namespace access');
      let ssOutput = '';
      let ssMethod = 'container';
      
      if (!isContainerized) {
        try {
          const { stdout: nsenterOutput } = await execAsync('nsenter -t 1 -n ss -tulpn 2>/dev/null');
          if (nsenterOutput && nsenterOutput.trim().length > 100) {
            ssOutput = nsenterOutput;
            ssMethod = 'nsenter-host';
            this.logInfo('Successfully accessed host network namespace via nsenter');
          }
        } catch (nsenterErr) {
          this.logInfo(`nsenter method failed: ${nsenterErr.message}, falling back to container ss`);
        }
      }
      
      if (!ssOutput) {
        const { stdout } = await execAsync('ss -tulpn 2>/dev/null');
        ssOutput = stdout;
        ssMethod = 'container';
      }
      
      const ports = this._parseSSOutput(ssOutput, ssMethod);
      this.logInfo(`ss command (${ssMethod}) successful: ${ports.length} ports found`);
      if (ports.length > 0) {
        return ports;
      }
    } catch (ssErr) {
      this.logWarn(`ss command failed: ${ssErr.message}, trying tertiary methods`);
    }

    try {
      this.logInfo('Attempting tertiary method: netstat command');
      const { stdout } = await execAsync('netstat -tulpn 2>/dev/null');
      const ports = this._parseNetstatOutput(stdout);
      this.logInfo(`netstat command successful: ${ports.length} ports found`);
      if (ports.length > 0) {
        return ports;
      }
    } catch (netstatErr) {
      this.logWarn(`netstat command failed: ${netstatErr.message}, trying final fallback`);
    }

    try {
      this.logInfo('Attempting fallback method: nsenter for host network access');
      const { stdout } = await execAsync('nsenter -t 1 -n ss -tulpn 2>/dev/null');
      if (stdout.trim()) {
        const ports = this._parseSSOutput(stdout);
        this.logInfo(`nsenter method successful: ${ports.length} ports found`);
        return ports;
      }
    } catch (nsenterErr) {
      this.logWarn(`nsenter method failed: ${nsenterErr.message}`);
      const msg = String(nsenterErr?.message || '').toLowerCase();
      if (msg.includes('permission denied') || msg.includes('operation not permitted') || msg.includes('exit code 1')) {
        this.logWarn('Hint: nsenter requires cap_add: [SYS_ADMIN] to access the host network namespace on Docker Desktop (macOS/Windows).');
      }
    }

    this.logError('All port collection methods failed');
    return [];
  }

  /**
   * Parse ss command output to extract port information
   * @param {string} output ss command output
   * @param {string} method Execution method context (container, nsenter-host, etc.)
   * @returns {Array} Parsed port entries
   */
  _parseSSOutput(output, method = 'container') {
    const entries = [];
    const lines = output.split('\n');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(/\s+/);
      if (cols.length < 5) continue;

      const protocol = cols[0].toLowerCase();
      if (!protocol.includes('tcp') && !protocol.includes('udp')) continue;

      const state = cols[1];
      if (protocol.includes('tcp') && state !== 'LISTEN') continue;
      if (protocol.includes('udp') && state !== 'UNCONN') continue;

      const localAddr = cols[4];
      if (!localAddr || !localAddr.includes(':')) continue;

      let host_ip, portStr;
      if (localAddr.includes('[') && localAddr.includes(']:')) {
        const match = localAddr.match(/\[(.+)\]:(\d+)$/);
        if (!match) continue;
        host_ip = match[1];
        portStr = match[2];
      } else {
        const lastColon = localAddr.lastIndexOf(':');
        if (lastColon === -1) continue;
        host_ip = localAddr.substring(0, lastColon);
        portStr = localAddr.substring(lastColon + 1);
      }

      const host_port = parseInt(portStr, 10);
      if (isNaN(host_port) || host_port <= 0 || host_port > 65535) continue;

      let owner = 'unknown';
      let pid = null;
      if (cols.length > 6) {
        const processCol = cols[6];
        if (processCol && processCol !== '-') {
          
          const processMatch = processCol.match(/users:\(\("([^"]+)",pid=(\d+)/);
          if (processMatch) {
            owner = processMatch[1];
            pid = parseInt(processMatch[2], 10);
          }
        }
      }
      
      if (owner === 'unknown') {
        owner = this._getIntelligentPortOwner(host_port, protocol.includes('tcp') ? 'tcp' : 'udp', method);
        this.logInfo(`Port ${host_port}/${protocol.includes('tcp') ? 'tcp' : 'udp'}: No process name from ${method} command, using intelligent mapping → "${owner}"`);
      } else {
        this.logInfo(`Port ${host_port}/${protocol.includes('tcp') ? 'tcp' : 'udp'}: Found process name from ${method} command → "${owner}" (PID: ${pid || 'N/A'})`);
      }

      entries.push({
        source: 'system',
        owner,
        protocol: protocol.includes('tcp') ? 'tcp' : 'udp',
        host_ip: host_ip === '*' ? '0.0.0.0' : host_ip,
        host_port,
        target: null,
        container_id: null,
        app_id: null,
        pids: pid !== null ? [pid] : [],
        detection_method: method
      });
    }

    return entries;
  }

  /**
   * Parse netstat command output to extract port information
   * @param {string} output netstat command output
   * @returns {Array} Parsed port entries
   */
  _parseNetstatOutput(output) {
    const entries = [];
    const lines = output.split('\n');

    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(/\s+/);
      if (cols.length < 4) continue;

      const protocol = cols[0].toLowerCase();
      if (!protocol.includes('tcp') && !protocol.includes('udp')) continue;

      const localAddr = cols[3];
      if (!localAddr || !localAddr.includes(':')) continue;

      if (protocol.includes('tcp')) {
        const state = cols[5];
        if (state !== 'LISTEN') continue;
      }

      let host_ip, portStr;
      if (localAddr.includes('[') && localAddr.includes(']:')) {
        const match = localAddr.match(/\[(.+)\]:(\d+)$/);
        if (!match) continue;
        host_ip = match[1];
        portStr = match[2];
      } else {
        const lastColon = localAddr.lastIndexOf(':');
        if (lastColon === -1) continue;
        host_ip = localAddr.substring(0, lastColon);
        portStr = localAddr.substring(lastColon + 1);
      }

      const host_port = parseInt(portStr, 10);
      if (isNaN(host_port) || host_port <= 0 || host_port > 65535) continue;

      let owner = 'unknown';
      let pid = null;
      if (cols.length > 6) {
        const processCol = cols[cols.length - 1];
        if (processCol && processCol !== '-') {
          const pidMatch = processCol.match(/^(\d+)\//);
          if (pidMatch) {
            pid = parseInt(pidMatch[1], 10);
            const nameMatch = processCol.match(/\/(.+)$/);
            if (nameMatch) {
              owner = nameMatch[1];
            }
          }
        }
      }
      
      if (owner === 'unknown') {
        owner = this._getIntelligentPortOwner(host_port, protocol.includes('tcp') ? 'tcp' : 'udp', 'netstat');
        this.logInfo(`Port ${host_port}/${protocol.includes('tcp') ? 'tcp' : 'udp'}: No process name from netstat command, using intelligent mapping → "${owner}"`);
      } else {
        this.logInfo(`Port ${host_port}/${protocol.includes('tcp') ? 'tcp' : 'udp'}: Found process name from netstat command → "${owner}" (PID: ${pid || 'N/A'})`);
      }

      entries.push({
        source: 'system',
        owner,
        protocol: protocol.includes('tcp') ? 'tcp' : 'udp',
        host_ip: host_ip === '*' ? '0.0.0.0' : host_ip,
        host_port,
        target: null,
        container_id: null,
        app_id: null,
        pids: pid !== null ? [pid] : [],
        detection_method: 'netstat'
      });
    }

    return entries;
  }

  /**
   * Map VM status to standardized status
   * @param {string} status VM status
   * @returns {string} Standardized status
   */
  _mapVMStatus(status) {
    switch (status?.toUpperCase()) {
      case "RUNNING":
        return "running";
      case "STOPPED":
        return "stopped";
      case "PAUSED":
        return "paused";
      default:
        return status?.toLowerCase() || "unknown";
    }
  }

  /**
   * Main collection method - with clean API key separation
   * @returns {Promise<Object>} Collection results
   */
  async collect() {
    const perf = new PerformanceTracker();
    perf.start("total-collection");

    const results = {
      platform: this.platform,
      platformName: this.platformName,
      systemInfo: null,
      applications: [],
      ports: [],
      vms: [],
      error: null,
      enhancedFeaturesEnabled: !!process.env.TRUENAS_API_KEY,
    };

    let containerCreationTimeMap = new Map();

    try {
      this.logInfo("Starting core functionality collection (Docker + System)");

      perf.start("system-info-collection");
      try {
  results.systemInfo = await this.cacheGetOrSet('systemInfo', () => this._getBasicSystemInfoViaDocket(), { ttlMs: 30000 });
        this.logInfo("Basic system info collected via Docker commands");
      } catch (err) {
        this.logWarn(
          "Basic system info collection encountered issues, using fallback data if available.",
          { error: err.message }
        );
        results.systemInfo = this._getFallbackSystemInfo();
      }
      perf.end("system-info-collection");

      perf.start("docker-containers-collection");
      try {
      const dockerContainers = await this.cacheGetOrSet('dockerContainers', () => this._getDockerContainers(), { ttlMs: 45000 });        containerCreationTimeMap = new Map(
          dockerContainers.map((c) => [c.id, c.created])
        );

        results.applications.push(
          ...dockerContainers.map((container) => ({
            type: "application",
            id: container.id,
            name: container.name,
            status: container.status,
            version: "N/A",
            image: container.image,
            command: container.command,
            created: container.created,
            platform: "docker",
            platform_data: {
              type: "container",
              size: "N/A",
              mounts: "N/A",
              networks: container.networks || "N/A",
              ports: [],
            },
          }))
        );
        this.log(`Collected ${dockerContainers.length} Docker containers`);
      } catch (err) {
        this.logWarn("Docker container collection failed:", err.message);
      }
      perf.end("docker-containers-collection");

      perf.start("port-collection-and-reconciliation");
      try {
        perf.start("docker-ports-collection");
        const dockerPorts = await this._getDockerPorts();
        perf.end("docker-ports-collection");

        const portsByContainer = new Map();
        dockerPorts.forEach(port => {
          if (port.container_id) {
            if (!portsByContainer.has(port.container_id)) {
              portsByContainer.set(port.container_id, []);
            }
            portsByContainer.get(port.container_id).push({
              host_ip: port.host_ip,
              host_port: port.host_port,
              container_port: parseInt(port.target.toString().split(':')[1]?.split('(')[0] || port.host_port),
              protocol: port.protocol,
              internal: port.internal || false
            });
          }
        });

        results.applications.forEach(app => {
          if (app.platform === "docker" && portsByContainer.has(app.id)) {
            app.platform_data.ports = portsByContainer.get(app.id);
          }
        });

        perf.start("system-ports-collection");
  const systemPorts = await this.cacheGetOrSet('systemPorts', () => this._getSystemPorts(), { ttlMs: 30000 });
        perf.end("system-ports-collection");

        perf.start("pid-to-container-mapping");
        const pidToContainerMap = new Map();
        try {
          await this.dockerApi._ensureConnected();
          const containers = await this.dockerApi.listContainers();
          
          for (const container of containers) {
            try {
              const inspection = await this.dockerApi.inspectContainer(container.ID);
              const pid = inspection.State.Pid;
              if (pid && pid !== 0) {
                pidToContainerMap.set(pid, {
                  id: container.ID,
                  name: this._formatContainerNames(container.Names),
                });
              }
            } catch (inspectErr) {
              this.logWarn(`Failed to inspect container ${container.ID} for PID mapping: ${inspectErr.message}`);
            }
          }
          
          this.log(
            `Successfully built PID-to-Container map with ${pidToContainerMap.size} entries.`
          );
        } catch (e) {
          this.logWarn(
            "Could not build PID-to-Container map. Host-networked apps may be misidentified.",
            { error: e.message }
          );
        }
        perf.end("pid-to-container-mapping");

        perf.start("process-start-times-collection");
        const pids = [
          ...new Set(systemPorts.map((p) => p.pid).filter(Boolean)),
        ];
        const processStartTimeMap = new Map();
        if (pids.length > 0) {
          try {
            const { stdout } = await execAsync(
              `ps -o pid,lstart --no-headers -p ${pids.join(",")}`
            );
            stdout
              .trim()
              .split("\n")
              .forEach((line) => {
                const parts = line.trim().split(/\s+/);
                const pid = parts[0];
                const startTime = new Date(
                  parts.slice(1).join(" ")
                ).toISOString();
                processStartTimeMap.set(parseInt(pid, 10), startTime);
              });
          } catch (psErr) {
            this.logWarn("Could not fetch process start times:", psErr.message);
          }
        }
        perf.end("process-start-times-collection");

        perf.start("port-reconciliation");
        const uniquePorts = new Map();

        const hostProcToContainerMap =
          await this._buildHostProcToContainerMap();

  for (const port of dockerPorts) {
          const key = port.internal
            ? `${port.container_id}:${port.host_port}:internal`
            : `${port.host_ip}:${port.host_port}`;
          port.created =
            containerCreationTimeMap.get(port.container_id) || null;
          uniquePorts.set(key, port);
        }

        for (const port of systemPorts) {
          const key = `${port.host_ip}:${port.host_port}`;
          if (uniquePorts.has(key)) {
            const existingPort = uniquePorts.get(key);
            if (!existingPort.pid) existingPort.pid = port.pid;
            continue;
          }

          let containerIdForPort = null;
          let ownerName = port.owner;

          if (port.pid && pidToContainerMap.has(port.pid)) {
            const containerInfo = pidToContainerMap.get(port.pid);
            containerIdForPort = containerInfo.id;
            ownerName = containerInfo.name;
            port.source = "docker";
            this.log(
              `Re-classified port ${port.host_port} to owner ${ownerName} via PID map.`
            );
          } else if (port.pid && hostProcToContainerMap.has(port.pid)) {
            const containerInfo = hostProcToContainerMap.get(port.pid);
            containerIdForPort = containerInfo.id;
            ownerName = containerInfo.name;
            port.source = "docker";
            port.target = port.host_port;
            this.log(
              `Re-classified port ${port.host_port} to owner ${ownerName} via HOST-PROC map.`
            );
          }

          port.owner = ownerName;
          if (containerIdForPort) {
            port.container_id = containerIdForPort;
            port.app_id = containerIdForPort;
            port.created =
              containerCreationTimeMap.get(containerIdForPort) || null;
          }

          if (port.pid) {
            port.created = processStartTimeMap.get(port.pid) || null;
          }

          uniquePorts.set(key, port);
        }

  perf.start("self-container-attribution");
  const ourPort = parseInt(process.env.PORT || "4999", 10);
  for (const port of uniquePorts.values()) {
          if (
            port.host_port === ourPort &&
            (port.owner === "node" || port.owner === "system") &&
            port.source === "system"
          ) {
            try {
              await this.dockerApi._ensureConnected();
              const containers = await this.dockerApi.listContainers();
              const portrackerContainer = containers.find(c => c.Names.includes('portracker'));

              if (portrackerContainer) {
                const containerId = portrackerContainer.ID;
                const containerName = this._formatContainerNames(portrackerContainer.Names);

                this.log(
                  `Re-classifying our own application port ${ourPort} from system/node to ${containerName}`
                );
                port.source = "docker";
                port.owner = containerName;
                port.container_id = containerId;
                port.app_id = containerId;
                port.target = port.host_port;

                port.created =
                  containerCreationTimeMap.get(containerId) || port.created;
              }
            } catch (e) {
              this.logWarn(
                `Could not re-classify our own application port ${ourPort}:`,
                e.message
              );
            }
          }
        }
        perf.end("self-container-attribution");

        perf.start("port-filtering");
        const includeSystemUdp = process.env.INCLUDE_UDP === "true";
        results.ports = Array.from(uniquePorts.values())
          .filter((port) => {
            if (port.protocol === "tcp") {
              if (
                this.importantPorts &&
                this.importantPorts[port.host_port] &&
                this.importantPorts[port.host_port].protocol === "tcp" &&
                port.source === "system" &&
                !port.container_id
              ) {
                this._enhanceKnownPort(port, results.applications);
              }
              return true;
            }

            if (port.source === "docker") {
              return true;
            }

            if (
              port.protocol === "udp" &&
              this.importantUdpPorts[port.host_port]
            ) {
              if (port.source === "system" && !port.container_id) {
                this._enhanceKnownPort(port, results.applications);
              }
              return true;
            }

            if (port.protocol === "udp" && port.source === "system") {
              return includeSystemUdp;
            }

            return false;
          })
          .map((port) => this.normalizePortEntry(port));
        perf.end("port-filtering");
        perf.end("port-reconciliation");

        this.logInfo(
          `Collected ${dockerPorts.length} Docker ports and ${systemPorts.length} system ports = ${results.ports.length} unique ports after reconciliation.`
        );
      } catch (err) {
        this.logWarn("Port collection failed:", err.message);
      }
      perf.end("port-collection-and-reconciliation");

      perf.start("enhanced-features-collection");
      const apiKey = process.env.TRUENAS_API_KEY;
      if (apiKey) {
        this.logInfo("API key detected - collecting enhanced TrueNAS features");
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("TrueNAS connection timeout after 15 seconds")), 15000)
        );
        
        try {
          const enhancedData = await Promise.race([
            this._collectEnhancedFeatures(),
            timeoutPromise
          ]);
          if (enhancedData.systemInfo) {
            results.systemInfo = {
              ...results.systemInfo,
              ...enhancedData.systemInfo,
              enhanced: true,
            };
          }
          if (enhancedData.apps && enhancedData.apps.length > 0) {
            const truenasApps = enhancedData.apps.map((app) => ({
              type: "application",
              id: app.id,
              name: app.name,
              status: app.status,
              version: app.version || "N/A",
              image: app.image || "N/A",
              command: "N/A",
              created: app.started || "N/A",
              platform: "truenas",
              platform_data: {
                type: "truenas_app",
                app_type: app.catalog || "unknown",
                catalog: app.catalog,
                ports: this._extractAppPorts(app),
                orig_data: app,
              },
            }));
            results.applications.push(...truenasApps);
            this.log(`Collected ${truenasApps.length} TrueNAS native apps`);
          }
          if (enhancedData.vms && enhancedData.vms.length > 0) {
            const realVMs = enhancedData.vms.map((vm) => ({
              type: "vm",
              id: vm.id,
              name: vm.name,
              status: vm.status,
              vcpus: vm.vcpus,
              memory: vm.memory ? vm.memory * 1024 * 1024 : null,
              autostart: vm.autostart,
              platform: "truenas",
              platform_data: {
                vnc_enabled: vm.vnc_enabled,
                vnc_port: vm.vnc_port,
                devices: vm.devices || [],
                orig_data: vm,
              },
            }));
            results.vms.push(...realVMs);
            this.log(`Collected ${realVMs.length} TrueNAS virtual machines`);
          }
          if (enhancedData.containers && enhancedData.containers.length > 0) {
            const lxcContainers = enhancedData.containers.map((vm) => ({
              type: "vm",
              id: vm.id,
              name: vm.name,
              status: this._mapVMStatus(vm.status),
              vcpus: vm.cpu,
              memory: vm.memory ? vm.memory * 1024 * 1024 : null,
              autostart: vm.autostart,
              platform: "truenas",
              platform_data: {
                container_type: "lxc",
                aliases: vm.aliases,
                image: vm.image,
                os: vm.image?.os || "unknown",
                vnc_enabled: vm.vnc_enabled,
                storage_pool: vm.storage_pool,
                orig_data: vm,
              },
            }));
            results.vms.push(...lxcContainers);
            this.log(`Collected ${lxcContainers.length} TrueNAS LXC containers`);
          }
          this.logInfo("Enhanced features collection completed successfully");
        } catch (err) {
          this.logWarn("TrueNAS enhanced features collection failed:", err.message);
          this.logInfo("Continuing with Docker and system port data only");
        } finally {
          if (this.client) {
            try {
              this.client.close();
            } catch (closeErr) {
              this.logWarn("Error while closing TrueNAS client:", closeErr.message);
            }
          }
        }
      } else {
        this.logInfo(
          "No TRUENAS_API_KEY provided - enhanced features disabled"
        );
        this.logInfo(
          "To enable VMs and TrueNAS native apps, set TRUENAS_API_KEY environment variable"
        );
      }
      perf.end("enhanced-features-collection");

      perf.end("total-collection");

      const summary = perf.getSummary();
      this.log("=== Performance Summary ===");
      summary.forEach(({ operation, duration }) => {
        this.log(`  ${operation}: ${duration}ms`);
      });
      this.log("=== End Performance Summary ===");

      let cacheStatus = "empty";
      try {
        if (this._cache && this._cache.store && this._cache.store.size > 0) {
          cacheStatus = Array.from(this._cache.store.entries())
            .map(([key, entry]) => {
              const remainingMs = entry.expires === 0 ? "no-expiry" : `${Math.max(0, entry.expires - Date.now())}ms ttl-left`;
              let valueDesc;
              if (Array.isArray(entry.value)) {
                valueDesc = `array(len=${entry.value.length})`;
              } else if (entry && typeof entry.value === 'object') {
                valueDesc = `object(${Object.keys(entry.value).length} keys)`;
              } else {
                valueDesc = typeof entry.value;
              }
              return `${key}: ${valueDesc} (${remainingMs})`;
            })
            .join(', ');
        }
      } catch (cacheDiagErr) {
        cacheStatus = `diagnostic-error: ${cacheDiagErr.message}`;
      }

      this.log(`Cache status: ${cacheStatus}`);
      this.logInfo(
        `Collection complete: ${results.applications.length} apps, ${results.ports.length} ports, ${results.vms.length} VMs`
      );
      this.log(
        `Enhanced features: ${
          results.enhancedFeaturesEnabled ? "ENABLED" : "DISABLED"
        }`
      );
      return results;
    } catch (err) {
      perf.end("total-collection");
      this.logError(
        "Critical collection error in TrueNASCollector:",
        err.message,
        err.stack
      );
      results.error = `Critical error during collection: ${err.message}`;
      this.logWarn(
        `Returning partially collected data due to error: ${results.applications.length} apps, ${results.ports.length} ports, ${results.vms.length} VMs`
      );
      return results;
    }
  }

  /**
   * Detect if running in containerized environment
   * @returns {boolean} True if containerized
   * @private
   */
  _detectContainerizedEnvironment() {
    try {
      const fs = require('fs');
      
      const hasDockerEnv = fs.existsSync('/.dockerenv');
      const hasContainerInit = fs.existsSync('/proc/1/cgroup') && 
        fs.readFileSync('/proc/1/cgroup', 'utf8').includes('docker');
      
      return hasDockerEnv || hasContainerInit;
    } catch (err) {
      this.logWarn('Error detecting containerized environment:', err.message);
      return false;
    }
  }
  
  /**
   * Provide intelligent process name inference for system ports
   * @param {number} port Port number
   * @param {string} protocol Protocol (tcp/udp) 
   * @param {string} method Detection method context
   * @returns {string} Inferred process name
   * @private
   */
  _getIntelligentPortOwner(port, protocol, method) {
    const systemServices = {
      22: 'sshd',
      23: 'telnetd', 
      25: 'postfix',
      53: protocol === 'udp' ? 'dnsmasq' : 'named',
      67: 'dnsmasq',
      68: 'dhclient',
      80: 'nginx',
      110: 'dovecot',
      123: 'chronyd',
      137: 'nmbd',
      138: 'nmbd',
      139: 'smbd',
      143: 'dovecot',
      161: 'snmpd',
      162: 'snmpd',
      389: 'slapd',
      443: 'nginx',
      445: 'smbd',
      500: 'strongswan',
      514: 'rsyslogd',
      587: 'postfix',
      636: 'slapd',
      993: 'dovecot',
      995: 'dovecot',
      1194: 'openvpn',
      1433: 'sqlservr',
      3306: 'mysqld',
      4500: 'strongswan',
      5432: 'postgres',
      6379: 'redis-server',
      8080: 'nginx',
      8443: 'nginx',
      51820: 'wireguard',
      51821: 'wg-easy',
      51822: 'wireguard'
    };
    
    const serviceName = systemServices[port];
    if (serviceName) {
      return serviceName;
    }
    
    if (method === 'nsenter-host' && port >= 8000 && port <= 9000) {
      return 'docker-proxy';
    }
    
    if (port < 1024) {
      return 'system-service';
    }
    
    return method === 'container' ? 'container-service' : 'host-service';
  }

  /**
   * Attempts to enhance attribution for known services (both TCP and UDP)
   * @param {Object} port Port object to enhance
   * @param {Array} allApps List of all applications
   */
  _enhanceKnownPort(port, allApps) {
    const portInfo = this.importantPorts[port.host_port];
    if (!portInfo) return;

    const service = portInfo.service;

    if (service === "WireGuard" || service === "WireGuard-UI") {
      const possibleContainers = allApps.filter(
        (app) =>
          app.name.toLowerCase().includes("wireguard") ||
          app.name.toLowerCase().includes("wg-") ||
          app.name.toLowerCase().includes("wg_") ||
          app.image?.toLowerCase().includes("wireguard") ||
          app.image?.toLowerCase().includes("wg-easy")
      );

      if (possibleContainers.length === 1) {
        const container = possibleContainers[0];
        port.source = "docker";
        port.container_id = container.id;
        port.app_id = container.id;
        port.owner = container.name;
        port.target = port.host_port;
        port.created =
          container.created ||
          this.containerCreationTimeMap?.get(container.id) ||
          null;
        this.log(
          `Enhanced attribution for WireGuard port ${port.host_port} to ${container.name}`
        );
      } else if (possibleContainers.length > 0) {
        const bestMatch =
          possibleContainers.find(
            (c) => c.name === "wg-easy" || c.name === "wireguard"
          ) || possibleContainers[0];

        port.source = "docker";
        port.container_id = bestMatch.id;
        port.app_id = bestMatch.id;
        port.owner = bestMatch.name;
        port.target = port.host_port;
        port.created = bestMatch.created;
        this.log(
          `Enhanced attribution for WireGuard port ${port.host_port} to best match: ${bestMatch.name}`
        );
      }
    }
  }

  /**
   * [OPTIMIZED & COMPATIBLE] Builds a map of all process PIDs running inside host-networked
   * containers to their respective container information. This version uses standard `ps`
   * flags to ensure compatibility with systems like TrueNAS.
   * @returns {Promise<Map<number, {id: string, name: string}>>} Map of PID to container info.
   */
  async _buildHostProcToContainerMap() {
    const perf = new PerformanceTracker();
    perf.start("build-host-proc-map");
    const pidToContainerMap = new Map();

    try {
      const hostContainerIds = await this.cacheGetOrSet('hostNetworkContainers', async () => {
          await this.dockerApi._ensureConnected();
          const containers = await this.dockerApi.listContainers();
          const hostContainers = [];
          
          for (const container of containers) {
            try {
              const inspection = await this.dockerApi.inspectContainer(container.ID);
              if (inspection.HostConfig.NetworkMode === 'host') {
                hostContainers.push(container.ID);
              }
            } catch (inspectErr) {
              this.logWarn(`Failed to inspect container ${container.ID} for network mode: ${inspectErr.message}`);
            }
          }
          
          return hostContainers;
        }, { ttlMs: 120000 });

      if (hostContainerIds.length === 0) {
        perf.end("build-host-proc-map");
        return pidToContainerMap;
      }

      const dockerContainers = await this.cacheGetOrSet('dockerContainers', () => this._getDockerContainers(), { ttlMs: 45000 });
      const idToNameMap = new Map(
        dockerContainers.map((c) => [c.id.substring(0, 12), c.name])
      );

      for (const containerId of hostContainerIds) {
        try {
          await this.dockerApi._ensureConnected();
          const pids = await this.dockerApi.getContainerProcesses(containerId);
          const containerName = idToNameMap.get(containerId.substring(0, 12)) || `container-${containerId.substring(0, 12)}`;

          for (const pid of pids) {
            if (pid > 0) {
              const fullId = dockerContainers.find((c) =>
                c.id.startsWith(containerId)
              )?.id;
              
              if (fullId && containerName) {
                pidToContainerMap.set(pid, {
                  id: fullId,
                  name: containerName,
                });
              }
            }
          }
        } catch (err) {
          this.logWarn(
            `Could not get container processes for ${containerId.substring(
              0,
              12
            )}. It may have stopped.`,
            err.message
          );
        }
      }
      this.log(
        `Built host process map with ${pidToContainerMap.size} PIDs from ${hostContainerIds.length} containers.`
      );
    } catch (err) {
      this.logWarn(
        "Failed to build host process to container map. Orphaned port attribution may be incomplete.",
        err.message
      );
    }

    perf.end("build-host-proc-map");
    return pidToContainerMap;
  }

  /**
   * Helper to find the parent PID of a given process.
   * @param {number} pid The process ID.
   * @returns {Promise<number|null>} The parent PID or null.
   */
  async _findParentPid(pid) {
    try {
      const { stdout } = await execAsync(`cat /proc/${pid}/status`);
      const ppidMatch = stdout.match(/^PPid:\s*(\d+)/m);
      return ppidMatch ? parseInt(ppidMatch[1], 10) : null;
    } catch {
      
      return null;
    }
  }

  /**
   * Get basic system info using Docker commands (hybrid approach)
   */
  async _getBasicSystemInfoViaDocket() {
    const perf = new PerformanceTracker();
    perf.start("basic-system-info-total");

    try {
      this.log(
        "Collecting TrueNAS system info via Docker API"
      );

      perf.start("docker-version-info");
      await this.dockerApi._ensureConnected();
      await this.dockerApi.getSystemVersion();
      const systemInfo = await this.dockerApi.getSystemInfo();
  
      perf.end("docker-version-info");

      perf.start("proc-meminfo");
      let totalMemoryGB = 0;
      try {
        const { stdout: memInfo } = await execAsync("cat /proc/meminfo");
        const memTotal = memInfo.match(/MemTotal:\s+(\d+) kB/);
        if (memTotal && memTotal[1]) {
          const kbValue = parseInt(memTotal[1], 10);
          const bytesValue = kbValue * 1024;
          this.log(
            `Collected memory from /proc/meminfo: ${(
              bytesValue /
              (1024 * 1024 * 1024)
            ).toFixed(2)} GB (${bytesValue} bytes)`
          );
          totalMemoryGB = bytesValue;
        }
      } catch (memErr) {
        this.logWarn(
          "Failed to get memory info from /proc/meminfo:",
          memErr.message
        );
        totalMemoryGB = systemInfo.MemTotal
          ? systemInfo.MemTotal
          : 0;
      }
      perf.end("proc-meminfo");

      let cpuModel = "Unknown";
      try {
        const { stdout: cpuInfo } = await execAsync(
          "cat /proc/cpuinfo | grep 'model name' | head -1"
        );
        const modelMatch = cpuInfo.match(/model name\s+:\s+(.*)/);
        if (modelMatch && modelMatch[1]) {
          cpuModel = modelMatch[1].trim();
          this.log(`Collected CPU model from /proc/cpuinfo: ${cpuModel}`);
        }
      } catch (cpuErr) {
        this.logWarn(
          "Failed to get CPU model from /proc/cpuinfo:",
          cpuErr.message
        );
      }

      
      let uptime = null;
      let uptimeSeconds = 0;
      try {
        const { stdout: uptimeOutput } = await execAsync("cat /proc/uptime");
        uptimeSeconds = parseFloat(uptimeOutput.split(" ")[0]);
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        uptime = days > 0 ? `${days} day${days !== 1 ? "s" : ""}, ` : "";
        uptime += `${hours}:${minutes < 10 ? "0" : ""}${minutes}`;
        this.log(
          `Collected uptime from /proc/uptime: ${uptime} (${uptimeSeconds} seconds)`
        );
      } catch (uptimeErr) {
        this.logWarn(
          "Failed to get uptime from /proc/uptime:",
          uptimeErr.message
        );
      }

      let systemProduct = "TrueNAS SCALE";
      try {
        const { stdout: dmidecode } = await execAsync(
          'dmidecode -s system-product-name 2>/dev/null || echo ""'
        );
        if (dmidecode.trim()) {
          systemProduct = dmidecode.trim();
          this.log(`Collected system product from dmidecode: ${systemProduct}`);
        }
      } catch (dmidecodeErr) {
        this.logWarn(
          "Failed to get system product from dmidecode:",
          dmidecodeErr.message
        );
      }

      
      let truenasVersion = "";
      try {
        
        const { stdout: versionFile } = await execAsync(
          'cat /etc/version 2>/dev/null || echo ""'
        );
        if (versionFile.trim()) {
          truenasVersion = versionFile.trim();
        } else if (
          systemInfo.KernelVersion &&
          systemInfo.KernelVersion.includes("truenas")
        ) {
          
          const versionMatch = systemInfo.KernelVersion.match(
            /truenas-(\d+\.\d+\.\d+)/i
          );
          if (versionMatch && versionMatch[1]) {
            truenasVersion = versionMatch[1];
          }
        }

        if (!truenasVersion) {
          const { stdout: versionAlternative } = await execAsync(
            'cat /etc/truenas-release 2>/dev/null || echo ""'
          );
          if (versionAlternative.trim()) {
            truenasVersion = versionAlternative.trim();
          }
        }
      } catch (err) {
        this.logWarn(
          "All attempts to get TrueNAS version failed:",
          err.message
        );
      }

      const formattedOS = `TrueNAS SCALE${
        truenasVersion ? ` ${truenasVersion}` : ""
      }`;

      return {
        type: "system",
        hostname: systemInfo.Name || "truenas-system",
        platform: "truenas",
        version: truenasVersion,
        system_product: systemProduct,
        enhanced: false,
        kernel_version: systemInfo.KernelVersion,
        operating_system: formattedOS,
        os_type: systemInfo.OSType,
        architecture: systemInfo.Architecture,
        ncpu: systemInfo.NCPU,
        memory: totalMemoryGB,
        model: cpuModel,
        uptime: uptime,
        uptime_seconds: uptimeSeconds,
        containers_running: systemInfo.ContainersRunning,
        containers_total: systemInfo.Containers,
        docker_images: systemInfo.Images,
        platform_data: {
          description: `TrueNAS SCALE${
            truenasVersion ? ` ${truenasVersion}` : ""
          }`,
          deployment_method: "native",
          container_runtime: "docker",
          source: "docker-host-info",
          api_key_required_for: ["vms", "native_apps", "detailed_system_info"],
        },
      };
    } catch (err) {
      perf.end("basic-system-info-total");
      this.logError(
        "Error getting system info via Docker (hybrid approach):",
        err.message,
        err.stack
      );
      return this._getFallbackSystemInfo();
    }
  }

  /**
   * Collect enhanced features using API key
   */
  async _collectEnhancedFeatures() {
    const results = {
      systemInfo: null,
      apps: [],
      vms: [],
    };
    try {
      this.logInfo("Attempting enhanced TrueNAS API calls...");
      try {
        const systemInfo = await this.client.call("system.info");
        results.systemInfo = systemInfo;
        this.log("Enhanced system info retrieved");
      } catch (err) {
        this.logWarn(
          "Enhanced system info API call failed:",
          err.message.substring(0, 50)
        );
      }
      try {
        const apps = await this.client.call("app.query");
        results.apps = apps || [];
      } catch (err) {
        this.logWarn(
          "TrueNAS apps API query failed:",
          err.message.substring(0, 50)
        );
      }
      try {
        const vms = await this.client.call("vm.query");
        results.vms = vms || [];
      } catch (err) {
        this.logWarn("VM API query failed:", err.message.substring(0, 50));
      }
      try {
        const containers = await this.client.call("virt.instance.query");
        results.containers = containers || [];
      } catch (err) {
        this.logWarn("LXC Container API query failed:", err.message.substring(0, 50));
      }
    } catch (err) {
      this.logError(
        "Overall enhanced features collection failed:",
        err.message,
        err.stack
      );
      throw err;
    }
    return results;
  }

  /**
   * Provides fallback system information when primary methods fail.
   * @returns {Object} Basic system information.
   */
  _getFallbackSystemInfo() {
    this.logWarn("Using fallback system information for TrueNASCollector.");
    return {
      type: "system",
      hostname: "truenas-system",
      platform: "truenas",
      version: "unknown",
      system_product: "TrueNAS SCALE",
      enhanced: false,
      kernel_version: "unknown",
      operating_system: "unknown",
      os_type: "Linux",
      architecture: "unknown",
      ncpu: 0,
      memory: 0,
      model: "Unknown",
      uptime: "N/A",
      uptime_seconds: 0,
      containers_running: 0,
      containers_total: 0,
      docker_images: 0,
      platform_data: {
        description: "TrueNAS SCALE (fallback data)",
        deployment_method: "native",
        container_runtime: "docker",
        source: "fallback",
        api_key_required_for: ["vms", "native_apps", "detailed_system_info"],
      },
    };
  }

  /**
   * Detect the network context and return appropriate IP resolution strategy
   * @returns {Object} Network context information
   */
  _detectNetworkContext() {
    try {
      const os = require("os");
      const networkInterfaces = os.networkInterfaces();
      const interfaceNames = Object.keys(networkInterfaces);
      const context = {
        hasTrueNASAppNetworks: false,
        hasDockerNetworks: false,
        hasHostNetwork: false,
        primaryInterface: null,
        recommendedIP: null,
      };
      context.hasTrueNASAppNetworks = interfaceNames.some(
        (name) =>
          name.startsWith("ix-") ||
          name.startsWith("truenas-") ||
          name.includes("app-")
      );
      context.hasDockerNetworks = interfaceNames.some(
        (name) => name.startsWith("docker") || name.startsWith("br-")
      );
      context.hasHostNetwork = interfaceNames.some((name) =>
        ["eth0", "enp", "ens", "em0"].some((prefix) => name.startsWith(prefix))
      );
      const primaryCandidates = interfaceNames.filter((name) =>
        ["eth0", "enp0s", "ens", "em0"].some((prefix) =>
          name.startsWith(prefix)
        )
      );
      if (primaryCandidates.length > 0) {
        context.primaryInterface = primaryCandidates[0];
      }
      this.log("Network context detected:", {
        truenasApp: context.hasTrueNASAppNetworks,
        docker: context.hasDockerNetworks,
        host: context.hasHostNetwork,
        primary: context.primaryInterface,
      });
      return context;
    } catch (error) {
      this.logError("Error detecting network context:", error.message);
      return {
        hasTrueNASAppNetworks: false,
        hasDockerNetworks: false,
        hasHostNetwork: true,
        primaryInterface: null,
        recommendedIP: null,
      };
    }
  }

  /**
   * Debug network interfaces and IP resolution
   */
  _debugNetworkInterfaces() {
    if (!this.debug) return;
    try {
      const os = require("os");
      const networkInterfaces = os.networkInterfaces();
      this.log("=== Network Interface Debug ===");
      for (const [name, addresses] of Object.entries(networkInterfaces)) {
        this.log(`Interface: ${name}`);
        for (const addr of addresses) {
          if (addr.family === "IPv4") {
            this.log(`  IPv4: ${addr.address} (internal: ${addr.internal})`);
          }
        }
      }
      this.log("=== End Network Debug ===");
      const context = this._detectNetworkContext();
      this.log("Network context:", context);
      const resolvedIP = "0.0.0.0";
      this.log(`Final resolved IP: ${resolvedIP}`);
    } catch (error) {
      this.logError("Error debugging network interfaces:", error.message);
    }
  }

  /**
   * Get a map of running Docker container names to their IDs
   * @returns {Promise<Map<string, string>>} Map of container names to full IDs
   */
  async _getDockerNameToIdMap() {
    try {
      await this.dockerApi._ensureConnected();
      const containers = await this.dockerApi.listContainers();
      const nameToId = new Map();

      containers.forEach((container) => {
        container.Names.forEach(name => {
          if (name) {
            nameToId.set(name.trim(), container.ID);
          }
        });
      });

      return nameToId;
    } catch (err) {
      this.logWarn(
        "Failed to get Docker container name to ID map:",
        err.message
      );
      return new Map();
    }
  }

  /**
   * Generic cache wrapper for expensive operations
   * @param {string} cacheKey Cache key identifier
   * @param {Function} fetchFunction Function to call if cache miss
   * @param {number} customTimeout Optional custom timeout override
   * @returns {Promise<any>} Cached or fresh data
   */
}

module.exports = TrueNASCollector;
