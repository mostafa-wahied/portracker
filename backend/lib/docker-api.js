const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const { Logger } = require('./logger');
const { SimpleTTLCache } = require('../utils/cache');

class DockerAPIClient {
  constructor(options = {}) {
    this.logger = new Logger('DockerAPI');
    this.docker = this._initializeDocker(options);
    this.isConnected = false;
    this.deploymentPattern = null;
    this.cache = new SimpleTTLCache();
    this.ttl = {
      containers: parseInt(process.env.DOCKER_CACHE_CONTAINERS_TTL_MS || '4000', 10),
      inspect: parseInt(process.env.DOCKER_CACHE_INSPECT_TTL_MS || '5000', 10),
      stats: parseInt(process.env.DOCKER_CACHE_STATS_TTL_MS || '1500', 10)
    };
  this.cacheCounters = { containers:{hits:0,misses:0}, inspect:{hits:0,misses:0}, stats:{hits:0,misses:0}, ops:0, lastSummary:0 };
  }

  _initializeDocker(options) {
    const dockerHost = options.dockerHost ?? process.env.DOCKER_HOST;
    const defaultSocket = options.socketPath ?? process.env.DOCKER_SOCK ?? '/var/run/docker.sock';
    const tlsVerify = options.tlsVerify ?? (process.env.DOCKER_TLS_VERIFY === '1');
    const certPath = options.certPath ?? process.env.DOCKER_CERT_PATH;

  
    if (dockerHost?.startsWith('unix://')) {
      this.deploymentPattern = 'socket';
      const socketPath = dockerHost.replace(/^unix:\/\//, '');
      return new Docker({ socketPath });
    }

  
    if (dockerHost?.startsWith('npipe://')) {
      this.deploymentPattern = 'npipe';
      const npipePath = dockerHost.replace(/^npipe:\/\//, '');
      return new Docker({ socketPath: npipePath });
    }

  
    if (!dockerHost) {
      if (process.platform === 'win32') {
  
        this.deploymentPattern = 'npipe';
        return new Docker({ socketPath: '//./pipe/docker_engine' });
      }
  
      this.deploymentPattern = 'socket';
      return new Docker({ socketPath: defaultSocket });
    }

  
    const urlStr = dockerHost.replace(/^tcp:\/\//, 'http://');
    const u = new URL(urlStr);
    const dockerOpts = {
      host: u.hostname,
      port: u.port ? Number(u.port) : (tlsVerify ? 2376 : 2375),
  protocol: (u.protocol || 'http:').slice(0, -1)
    };

    if (tlsVerify && certPath) {
      try {
        dockerOpts.protocol = 'https';
        dockerOpts.ca = fs.readFileSync(path.join(certPath, 'ca.pem'));
        dockerOpts.cert = fs.readFileSync(path.join(certPath, 'cert.pem'));
        dockerOpts.key = fs.readFileSync(path.join(certPath, 'key.pem'));
      } catch (certError) {
        this.logger.warn('Failed to load TLS certificates, falling back to HTTP:', certError.message);
        dockerOpts.protocol = 'http';
      }
    }

    this.deploymentPattern = 'proxy';
    return new Docker(dockerOpts);
  }

  async connect() {
    try {
      this.logger.debug(`Attempting Docker API connection (${this.deploymentPattern})`);
      await this.docker.ping();
      this.isConnected = true;
      this.logger.info(`Docker API connected successfully (${this.deploymentPattern})`);
      return true;
    } catch (error) {
    this.logger.error(`Docker API connection failed (${this.deploymentPattern})`, { err: error });
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Retrieve low-level Docker version info (wrapper used by detection logic)
   * Provides backward compatibility where code expected dockerApi.version().
   * @returns {Promise<Object>} version information
   */
  async version() {
    await this._ensureConnected();
    try {
      return await this.docker.version();
    } catch (error) {
      this.logger.error('version() call failed', { err: error });
      throw error;
    }
  }

  async _ensureConnected() {
    if (!this.isConnected) {
      this.logger.debug('Docker API not connected, attempting to connect...');
      const connected = await this.connect();
      if (!connected) {
        this.logger.error('Failed to establish Docker API connection in _ensureConnected');
        throw new Error('Docker API connection failed');
      }
    }
  }

  async listContainers(options = {}) {
    await this._ensureConnected();
    const key = `containers:${options.all?'all':'running'}:${JSON.stringify(options.filters||{})}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cacheCounters.containers.hits++;
      this.cacheCounters.ops++;
      if (process.env.CACHE_DEBUG_VERBOSE === 'true') this.logger.debug(`cache hit ${key}`);
      this._maybeLogCacheSummary();
      return cached;
    }
    this.cacheCounters.containers.misses++;
    this.cacheCounters.ops++;
    if (process.env.CACHE_DEBUG_VERBOSE === 'true') this.logger.debug(`cache miss ${key}`);
    this._maybeLogCacheSummary();
    return await this.cache.getOrSet(key, this.ttl.containers, async () => {
      try {
        const containers = await this.docker.listContainers({
          all: options.all || false,
          filters: options.filters || {}
        });
        return containers.map(container => ({
          ID: container.Id.substring(0, 12),
          Names: container.Names.map(name => name.replace(/^\//, '')).join(','),
          Image: container.Image,
          Command: container.Command,
          Created: container.Created,
          Status: container.Status,
          State: container.State,
          Ports: this._formatPorts(container.Ports),
          Labels: container.Labels,
          NetworkSettings: container.NetworkSettings,
          Mounts: container.Mounts,
          HostConfig: container.HostConfig
        }));
      } catch (error) {
        this.logger.error('listContainers failed:', error.message);
        throw error;
      }
    });
  }

  async listServices(options = {}) {
    await this._ensureConnected();
    const key = `services:${JSON.stringify(options.filters || {})}`;
    return await this.cache.getOrSet(key, this.ttl.containers, async () => {
      try {
        return await this.docker.listServices(options);
      } catch (error) {
        this.logger.error('listServices failed:', error.message);
        throw error;
      }
    });
  }

  async inspectContainer(containerId, options = {}) {
    await this._ensureConnected();
    const useSize = options.size === true;
    const cacheKey = useSize ? null : `inspect:${containerId}`;
    if (!useSize) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.cacheCounters.inspect.hits++;
        this.cacheCounters.ops++;
        if (process.env.CACHE_DEBUG_VERBOSE === 'true') this.logger.debug(`cache hit ${cacheKey}`);
        this._maybeLogCacheSummary();
        return cached;
      }
      this.cacheCounters.inspect.misses++;
      this.cacheCounters.ops++;
      if (process.env.CACHE_DEBUG_VERBOSE === 'true') this.logger.debug(`cache miss ${cacheKey}`);
      this._maybeLogCacheSummary();
    }
    try {
      const container = this.docker.getContainer(containerId);
      const insp = await container.inspect({ size: useSize });
      if (!useSize) this.cache.set(cacheKey, insp, this.ttl.inspect);
      return insp;
    } catch (error) {
      this.logger.error(`inspectContainer failed for ${containerId}:`, error.message);
      throw error;
    }
  }

  async getContainerStats(containerId) {
    await this._ensureConnected();
    const key = `stats:${containerId}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cacheCounters.stats.hits++;
      this.cacheCounters.ops++;
      if (process.env.CACHE_DEBUG_VERBOSE === 'true') this.logger.debug(`cache hit ${key}`);
      this._maybeLogCacheSummary();
      return cached;
    }
    this.cacheCounters.stats.misses++;
    this.cacheCounters.ops++;
    if (process.env.CACHE_DEBUG_VERBOSE === 'true') this.logger.debug(`cache miss ${key}`);
    this._maybeLogCacheSummary();
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });
      if (!stats) return null;
      let cpuPercent = null;
      try {
        const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
        const systemDelta = (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
        const onlineCPUs = stats.cpu_stats?.online_cpus || (stats.cpu_stats?.cpu_usage?.percpu_usage?.length) || 1;
        if (cpuDelta > 0 && systemDelta > 0) cpuPercent = (cpuDelta / systemDelta) * onlineCPUs * 100.0;
      } catch (e) { this.logger.debug('Failed to compute cpuPercent', e.message); }
      const memUsage = stats.memory_stats?.usage || null;
      const memLimit = stats.memory_stats?.limit || null;
      let memPercent = null;
      if (memUsage != null && memLimit && memLimit > 0) memPercent = (memUsage / memLimit) * 100.0;
      const mapped = { cpuPercent, memBytes: memUsage, memLimitBytes: memLimit, memUsagePercent: memPercent, read: stats.read || null };
      this.cache.set(key, mapped, this.ttl.stats);
      return mapped;
    } catch (error) {
      this.logger.warn(`getContainerStats failed for ${containerId}:`, error.message);
      return { error: error.message };
    }
  }

  async getContainerHealth(containerId) {
    try {
      const inspection = await this.inspectContainer(containerId);
      
      return {
        status: inspection.State.Status,
        health: inspection.State.Health?.Status || 'none',
        startedAt: inspection.State.StartedAt,
        finishedAt: inspection.State.FinishedAt,
        restartCount: inspection.RestartCount,
        pid: inspection.State.Pid
      };
    } catch (error) {
      this.logger.warn(`getContainerHealth failed for ${containerId}:`, error.message);
      return {
        status: 'unknown',
        health: 'unknown',
        startedAt: null,
        finishedAt: null,
        restartCount: 0,
        pid: null
      };
    }
  }

  async getContainerProcesses(containerId) {
    await this._ensureConnected();

    try {
      const container = this.docker.getContainer(containerId);
      const { Processes, Titles } = await container.top({ ps_args: '-o pid' });
      const pidIndex = Titles.findIndex(t => t.toLowerCase() === 'pid');
      if (pidIndex === -1) {
        return [];
      }
      return Processes
        .map(row => parseInt(row[pidIndex], 10))
        .filter(Number.isInteger);
    } catch (error) {
      this.logger.warn(`getContainerProcesses failed for ${containerId}:`, error.message);
      return [];
    }
  }

  _formatPorts(ports) {
    if (!ports || ports.length === 0) return '';
    
    return ports.map(port => {
      if (port.PublicPort) {
        return `${port.IP || '0.0.0.0'}:${port.PublicPort}->${port.PrivatePort}/${port.Type}`;
      } else {
        return `${port.PrivatePort}/${port.Type}`;
      }
    }).join(', ');
  }

  async isAvailable() {
    return await this.connect();
  }

  
  async getSystemVersion() {
    await this._ensureConnected();
    
    try {
      const versionInfo = await this.docker.version();
      return {
        version: versionInfo.Version || 'unknown',
        apiVersion: versionInfo.ApiVersion || 'unknown',
        minApiVersion: versionInfo.MinAPIVersion || 'unknown',
        gitCommit: versionInfo.GitCommit || 'unknown',
        goVersion: versionInfo.GoVersion || 'unknown',
        os: versionInfo.Os || 'unknown',
        arch: versionInfo.Arch || 'unknown'
      };
    } catch (error) {
    this.logger.error('getSystemVersion failed', { err: error });
      throw error;
    }
  }

  async getSystemInfo() {
    await this._ensureConnected();
    
    try {
      return await this.docker.info();
    } catch (error) {
      this.logger.error('getSystemInfo failed:', error.message);
      throw error;
    }
  }

  _maybeLogCacheSummary() {
    if (process.env.CACHE_DEBUG !== 'true') return;
    if (process.env.CACHE_DEBUG_VERBOSE === 'true') return;
    const now = Date.now();
    if (this.cacheCounters.ops % 25 === 0 || (now - this.cacheCounters.lastSummary) > 30000) {
      this.cacheCounters.lastSummary = now;
      const c = this.cacheCounters;
      this.logger.debug(`cache summary containers h/m=${c.containers.hits}/${c.containers.misses} inspect h/m=${c.inspect.hits}/${c.inspect.misses} stats h/m=${c.stats.hits}/${c.stats.misses} totalOps=${c.ops}`);
    }
  }
}

module.exports = DockerAPIClient;