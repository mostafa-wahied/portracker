/**
 * PORTS TRACKER - SYSTEM COLLECTOR
 *
 * This collector gathers data from the local operating system.
 * It implements the standard collector interface defined in base_collector.js.
 * Based on the original System scanner but with enhanced capabilities.
 */

const BaseCollector = require("./base_collector");
const { exec } = require("child_process");
const util = require("util");
const os = require("os");
const execAsync = util.promisify(exec);
const ProcParser = require("../lib/proc-parser");

class SystemCollector extends BaseCollector {
  /**
   * Create a new System collector
   * @param {Object} config Configuration options
   */
  constructor(config = {}) {
    super(config);
    this.platform = "system";
    this.platformName = "Local System";
    this.name = "System Collector";
    this.isWindows = os.platform() === "win32";
    this.procParser = new ProcParser();
  }

  _normalizeHostIp(hostIp) {
    if (!hostIp || hostIp === "*" || hostIp === "::" || hostIp === "[::]") {
      return "0.0.0.0";
    }
    return hostIp;
  }

  _selectPreferredProcessPortEntry(existingEntry, nextEntry) {
    if (!existingEntry) return nextEntry;
    if (!nextEntry) return existingEntry;
    const score = (entry) => {
      let value = 0;
      const normalizedIp = this._normalizeHostIp(entry.host_ip);
      if (normalizedIp === "0.0.0.0") value += 3;
      if (normalizedIp === "127.0.0.1") value += 2;
      return value;
    };
    return score(nextEntry) > score(existingEntry) ? nextEntry : existingEntry;
  }

  _getProcessLogicalKey(entry) {
    if (!entry || !entry.host_port) return null;
    const hostPort = parseInt(entry.host_port, 10);
    if (Number.isNaN(hostPort) || hostPort <= 0) return null;
    const protocol = entry.protocol || "tcp";
    const owner = String(entry.owner || "").trim().toLowerCase();
    if (!owner || owner === "unknown") {
      const pid =
        entry.pid ||
        (Array.isArray(entry.pids) && entry.pids.length > 0 ? entry.pids[0] : null);
      if (pid) return `pid:${pid}:${hostPort}:${protocol}`;
      return `unknown:${entry.source || "system"}:${hostPort}:${protocol}`;
    }
    return `owner:${owner}:${hostPort}:${protocol}`;
  }

  _collapseProcessLogicalDuplicates(entries) {
    const passthroughEntries = [];
    const processEntries = new Map();

    entries.forEach((rawEntry) => {
      const entry = this.normalizePortEntry(rawEntry);
      if (entry.container_id) {
        passthroughEntries.push(entry);
        return;
      }
      const logicalKey = this._getProcessLogicalKey(entry);
      if (!logicalKey) {
        passthroughEntries.push(entry);
        return;
      }
      processEntries.set(
        logicalKey,
        this._selectPreferredProcessPortEntry(processEntries.get(logicalKey), entry)
      );
    });

    return [...passthroughEntries, ...processEntries.values()];
  }

  /**
   * Get local system information
   * @returns {Promise<Object>} System information
   */
  async getSystemInfo() {
    const ttl = parseInt(process.env.SYSTEM_CACHE_SYSTEMINFO_TTL_MS || '15000', 10);
    return this.cacheGetOrSet('systemInfo', async () => {
      try {
        this.log("Collecting system info");
        const hostname = os.hostname();
        const platform = os.platform();
        const release = os.release();
        const type = os.type();
        const arch = os.arch();
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const uptime = os.uptime();

        let version = release;
        try {
          if (!this.isWindows) {
            const { stdout } = await execAsync("uname -r");
            version = stdout.trim();
          } else {
            const { stdout } = await execAsync("ver");
            version = stdout.trim();
          }
        } catch (err) {
          this.logWarn("Could not get detailed OS version info:", err.message);
        }

        return {
          type: "system",
          hostname,
          version,
          platform: "system",
          os: {
            platform,
            release,
            type,
            arch,
          },
          cpu: {
            model: cpus.length > 0 ? cpus[0].model : "Unknown",
            cores: cpus.length,
            speed: cpus.length > 0 ? cpus[0].speed : 0,
          },
          memory: {
            total: totalMem,
            free: freeMem,
            usage: Math.round(((totalMem - freeMem) / totalMem) * 100),
          },
          uptime,
          platform_data: {
            description: `${type} ${release} (${arch})`,
            uptime_days: Math.floor(uptime / 86400),
            memory_gb: Math.round(totalMem / (1024 * 1024 * 1024)),
          },
        };
      } catch (err) {
        this.logError("Error collecting system info:", err.message, err.stack);
        return {
          type: "system",
          hostname: os.hostname() || "Unknown system",
          version: "unknown",
          platform: "system",
          error: err.message,
        };
      }
    }, { ttlMs: ttl });
  }

  /**
   * Get system applications/processes (not fully implemented)
   * @returns {Promise<Array>} List of applications
   */
  async getApplications() {
    try {
      this.log("Collecting system processes");
      let processes = [];
      if (this.isWindows) {
        const { stdout } = await execAsync("tasklist /FO CSV");
        processes = this.parseWindowsProcesses(stdout);
      } else {
        const { stdout } = await execAsync("ps -e -o pid,ppid,cmd");
        processes = this.parseLinuxProcesses(stdout);
      }
      return processes.slice(0, 50).map((proc) => ({
        type: "application",
        id: proc.pid.toString(),
        name: proc.name,
        status: "running",
        platform: "system",
        platform_data: {
          type: "process",
          pid: proc.pid,
          command: proc.command,
        },
      }));
    } catch (err) {
      this.logError(
        "Error collecting system applications:",
        err.message,
        err.stack
      );
      return [
        {
          type: "application",
          name: "System process collection failed",
          error: err.message,
          platform: "system",
        },
      ];
    }
  }

  /**
   * Get system ports (using code from the original system scanner)
   * @returns {Promise<Array>} List of port entries
   */
  async getPorts() {
    const ttl = parseInt(process.env.SYSTEM_CACHE_PORTS_TTL_MS || '5000', 10);
    return this.cacheGetOrSet('ports', async () => {
      try {
        this.log("Collecting system ports");
        let collectedPorts = null;

        if (!this.isWindows && this.procParser) {
          try {
            this.log("Testing /proc filesystem access effectiveness...");
            const procWorks = await this.procParser.testProcAccess();

            if (procWorks) {
              this.log("Attempting to get ports via /proc filesystem");
              const tcpPorts = await this.procParser.getTcpPorts();
              const includeAllUdp = process.env.INCLUDE_UDP === 'true';
              const udpPorts = await this.procParser.getUdpPorts(includeAllUdp);
              const allPorts = [...tcpPorts, ...udpPorts];

              if (allPorts.length >= 3) {
                this.log(`Successfully collected ${allPorts.length} ports via /proc (TCP: ${tcpPorts.length}, UDP: ${udpPorts.length})`);
                collectedPorts = allPorts.map((port) => this.normalizePortEntry({
                  source: "system",
                  owner: port.owner,
                  protocol: port.protocol,
                  host_ip: port.host_ip,
                  host_port: port.host_port,
                  pid: port.pid,
                  platform_data: {
                    process: port.owner,
                    pid: port.pid,
                  },
                }));
              } else {
                this.logWarn(`/proc parsing returned only ${allPorts.length} ports, falling back to commands`);
              }
            } else {
              this.logWarn("/proc access test failed, falling back to commands");
            }
          } catch (procErr) {
            this.logWarn("Failed to get ports via /proc, falling back to commands:", procErr.message);
          }
        }

        if (!collectedPorts) {
          if (this.isWindows) {
            collectedPorts = await this.getWindowsPorts();
          } else {
            collectedPorts = await this.getLinuxPorts();
          }
        }
        return this._collapseProcessLogicalDuplicates(collectedPorts);
      } catch (err) {
        this.logError("Error collecting system ports:", err.message, err.stack);
        return [
          {
            type: "port",
            error: err.message,
            platform: "system",
          },
        ];
      }
    }, { ttlMs: ttl });
  }

  /**
   * Get Linux ports using ss or netstat commands
   * @returns {Promise<Array>} List of port entries
   */
  async getLinuxPorts() {
    try {
      this.log('Attempting to get Linux ports with "ss" command');
      const { stdout } = await execAsync("ss -tunlp");
      return this.parseLinuxOutput(stdout);
    } catch (ssErr) {
      this.logWarn(
        `Linux "ss" command failed: ${ssErr.message}. Trying "netstat" as fallback.`
      );
      try {
        this.log(
          'Attempting to get Linux ports with "netstat" command (fallback)'
        );
        const { stdout } = await execAsync("netstat -tulpn");
        return this.parseNetstatOutput(stdout);
      } catch (netstatErr) {
        this.logError(
          `Linux "netstat" fallback command also failed: ${netstatErr.message}. Cannot get Linux ports.`
        );
        throw new Error("Both ss and netstat commands failed on Linux");
      }
    }
  }

  /**
   * Get Windows ports using netstat command
   * @returns {Promise<Array>} List of port entries
   */
  async getWindowsPorts() {
    try {
      this.log('Attempting to get Windows ports with "netstat -ano" command');
      const { stdout } = await execAsync("netstat -ano");
      return this.parseWindowsOutput(stdout);
    } catch (err) {
      this.logWarn(
        `Windows "netstat -ano" command failed: ${err.message}. Trying "netstat -an" as fallback.`
      );
      try {
        this.log(
          'Attempting to get Windows ports with "netstat -an" command (fallback)'
        );
        const { stdout } = await execAsync("netstat -an");
        return this.parseWindowsOutput(stdout);
      } catch (fallbackErr) {
        this.logError(
          `Windows "netstat -an" fallback command also failed: ${fallbackErr.message}. Cannot get Windows ports.`
        );
        throw new Error("All Windows port detection methods failed");
      }
    }
  }

  /**
   * Parse ss command output (Linux)
   * @param {string} output Command output
   * @returns {Array} Parsed port entries
   */
  parseLinuxOutput(output) {
    this.log('Parsing Linux "ss" output');
    const entries = [];
    const lines = output.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(/\s+/);
      if (cols.length < 5) continue;
      const protocol = cols[0].toLowerCase();
      const localAddr = cols[4];
      if (!localAddr || !localAddr.includes(":")) continue;
      const [host_ip, portStr] = localAddr.split(":");
      if (!portStr || isNaN(parseInt(portStr, 10))) continue;
      const procInfo = cols[cols.length - 1];
      let owner = "unknown";
      let pid = null;
      const m = procInfo.match(/\("([^"]+)",pid=(\d+)/);
      if (m) {
        owner = m[1];
        pid = m[2];
      }
      entries.push(
        this.normalizePortEntry({
          source: "system",
          owner,
          protocol,
          host_ip: host_ip === "*" ? "0.0.0.0" : host_ip,
          host_port: parseInt(portStr, 10),
          pid,
          platform_data: {
            process: owner,
            pid,
          },
        })
      );
    }
    return entries;
  }

  /**
   * Parse netstat command output (Linux fallback)
   * @param {string} output Command output
   * @returns {Array} Parsed port entries
   */
  parseNetstatOutput(output) {
    this.log('Parsing Linux "netstat" output');
    const entries = [];
    const lines = output.split("\n");
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(/\s+/);
      if (cols.length < 4) continue;
      const protocol = cols[0].toLowerCase();
      const localAddr = cols[3];
      if (!localAddr || !localAddr.includes(":")) continue;
      const [host_ip, portStr] = localAddr.split(":");
      if (!portStr || isNaN(parseInt(portStr, 10))) continue;
      let owner = "unknown";
      let pid = null;
      if (cols.length >= 7) {
        const pidInfo = cols[6];
        if (pidInfo.includes("/")) {
          const [pidStr, name] = pidInfo.split("/");
          pid = pidStr;
          owner = name;
        } else {
          pid = pidInfo;
          owner = `Process (pid ${pid})`;
        }
      }
      entries.push(
        this.normalizePortEntry({
          source: "system",
          owner,
          protocol,
          host_ip: host_ip === "*" ? "0.0.0.0" : host_ip,
          host_port: parseInt(portStr, 10),
          pid,
          platform_data: {
            process: owner,
            pid,
          },
        })
      );
    }
    return entries;
  }

  /**
   * Parse Windows netstat output
   * @param {string} output Command output
   * @returns {Array} Parsed port entries
   */
  parseWindowsOutput(output) {
    this.log('Parsing Windows "netstat" output');
    const entries = [];
    const lines = output
      .split("\n")
      .slice(4)
      .filter((line) => line.trim().length > 0);
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      if (!line.includes("LISTENING")) continue;
      const protocol = cols[0].toLowerCase();
      const localAddr = cols[1];
      const pid = cols[cols.length - 1];
      let host_ip = "0.0.0.0";
      let portStr = "0";
      if (localAddr.includes(":")) {
        const parts = localAddr.split(":");
        host_ip = parts[0];
        if (host_ip === "*" || host_ip === "0.0.0.0") {
          host_ip = "0.0.0.0";
        }
        portStr = parts[parts.length - 1];
      }
      entries.push(
        this.normalizePortEntry({
          source: "system",
          owner: `Process (pid ${pid})`,
          protocol,
          host_ip,
          host_port: parseInt(portStr, 10),
          pid,
          platform_data: {
            pid,
          },
        })
      );
    }
    return entries;
  }

  /**
   * Parse Windows tasklist output
   * @param {string} output Command output
   * @returns {Array} Parsed process entries
   */
  parseWindowsProcesses(output) {
    this.log('Parsing Windows "tasklist" output');
    const entries = [];
    const lines = output.split("\n").slice(1);
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line
        .split(",")
        .map((part) => part.trim().replace(/^"/, "").replace(/"$/, ""));
      if (parts.length >= 2) {
        entries.push({
          name: parts[0],
          pid: parseInt(parts[1], 10),
          command: parts[0],
        });
      }
    }
    return entries;
  }

  /**
   * Parse Linux ps output
   * @param {string} output Command output
   * @returns {Array} Parsed process entries
   */
  parseLinuxProcesses(output) {
    this.log('Parsing Linux "ps" output');
    const entries = [];
    const lines = output.split("\n").slice(1);
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const pid = parseInt(parts[0], 10);
        const command = parts.slice(2).join(" ");
        const nameMatch = command.match(/([^\\/]+?)(?: |$)/);
        const name = nameMatch ? nameMatch[1] : command;
        entries.push({
          name,
          pid,
          command,
        });
      }
    }
    return entries;
  }

  /**
   * Get Docker virtual machines (not applicable, returns empty array)
   * @returns {Promise<Array>} Empty array
   */
  async getVMs() {
    this.log("getVMs called for SystemCollector, returning empty array.");
    return [];
  }

  /**
   * Check if System collector is available. Always true as a fallback.
   * @returns {Promise<number>} Confidence score (always a low score for fallback)
   */
  async isCompatible() {
    this.logInfo("System collector is always available as fallback.");
    return 10;
  }

  /**
   * Store detection information for API access
   * @param {Object} info Detection information
   */
  setDetectionInfo(info) {
    this.log("Setting detection info for SystemCollector:", info);
    this.detectionInfo = info;
  }
}

module.exports = SystemCollector;
