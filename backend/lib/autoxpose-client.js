const { Logger } = require('./logger');
const { SimpleTTLCache } = require('../utils/cache');
const { requestAutoxposeJson } = require('./autoxpose-http');

const logger = new Logger('AutoxposeClient', { debug: process.env.DEBUG === 'true' });
const configuredCacheTtl = parseInt(process.env.AUTOXPOSE_CACHE_TTL_MS || '30000', 10);
const CACHE_TTL = Number.isInteger(configuredCacheTtl) && configuredCacheTtl > 0
  ? configuredCacheTtl
  : 30000;

class AutoxposeClient {
  constructor(baseUrl = null, options = {}) {
    this.baseUrl = baseUrl || process.env.AUTOXPOSE_URL || null;
    this.enabled = process.env.AUTOXPOSE_ENABLED === 'true';
    this.cache = new SimpleTTLCache();
    this.connected = false;
    this.domain = null;
    this.initialized = false;
    this.initializePromise = null;
    this.restoreError = null;
    this.nextRestoreAttemptAt = 0;
    this.now = options.now || Date.now;
    this.restoreRetryMs = options.restoreRetryMs || CACHE_TTL;
    this.requestJson = options.requestJson || requestAutoxposeJson;
    this.lookup = options.lookup;
    this.settingsManager = options.settingsManager;
  }

  async initialize() {
    if (this.initialized) return;
    if (this.now() < this.nextRestoreAttemptAt) return;
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.restoreConnection();
    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  async restoreConnection() {
    try {
      const settingsManager = this.settingsManager || require('./settings-manager');
      const connection = settingsManager.getAutoxposeConnection();
      const configuredUrl = connection?.url
        ? connection.url
        : this.enabled && this.baseUrl
          ? this.baseUrl
          : null;

      if (configuredUrl) {
        logger.info('Restoring configured autoxpose connection');
        const result = await this.connect(configuredUrl);
        if (result.success) {
          this.nextRestoreAttemptAt = 0;
          logger.info('Autoxpose connection restored successfully');
        } else {
          this.nextRestoreAttemptAt = this.now() + this.restoreRetryMs;
          this.restoreError = result.error;
          logger.warn(`Failed to restore autoxpose connection: ${result.error}`);
        }
      } else {
        this.initialized = true;
        this.restoreError = null;
      }
    } catch (error) {
      this.nextRestoreAttemptAt = this.now() + this.restoreRetryMs;
      this.restoreError = error.message;
      logger.error(`Error initializing autoxpose client: ${error.message}`);
    }
  }

  setBaseUrl(url) {
    this.baseUrl = url;
    this.connected = false;
    this.domain = null;
    if (!url) {
      this.enabled = false;
    }
    this.cache.clear();
    this.restoreError = null;
    this.nextRestoreAttemptAt = 0;
  }

  isEnabled() {
    return this.connected && !!this.baseUrl;
  }

  async fetchEndpoint(baseUrl, endpoint) {
    return this.requestJson(baseUrl, endpoint, {
      lookup: this.lookup,
    });
  }

  async probeConnection(baseUrl) {
    if (!baseUrl) {
      return { success: false, error: 'No Autoxpose URL configured' };
    }

    try {
      const res = await this.fetchEndpoint(baseUrl, '/health');

      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }

      const success = res.data && typeof res.data === 'object' && res.data.status === 'ok';
      return success
        ? { success: true, url: res.url }
        : { success: false, error: 'Unexpected health response' };
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Connection timeout' : error.message;
      logger.warn(`Failed to connect to Autoxpose: ${message}`);
      return { success: false, error: message };
    }
  }

  async connect(baseUrl) {
    const result = await this.probeConnection(baseUrl);
    if (result.success) {
      this.setBaseUrl(result.url);
      this.connected = true;
      this.enabled = true;
      this.initialized = true;
      this.restoreError = null;
      logger.info(`Connected to Autoxpose at ${result.url}`);
      return { success: true };
    }
    return result;
  }

  async testConnection() {
    const result = await this.probeConnection(this.baseUrl);
    this.connected = result.success;
    if (result.success) {
      this.setBaseUrl(result.url);
      this.connected = true;
      logger.info(`Connected to Autoxpose at ${result.url}`);
      return { success: true };
    }
    return result;
  }

  async getServices() {
    if (!this.isEnabled()) {
      return [];
    }

    const cached = this.cache.get('services');
    if (cached) {
      return cached;
    }

    try {
      const res = await this.fetchEndpoint(
        this.baseUrl,
        '/api/services?includeExternal=true'
      );

      if (!res.ok) {
        logger.warn(`Failed to fetch services: HTTP ${res.status}`);
        return [];
      }

      const services = Array.isArray(res.data?.services) ? res.data.services : [];
      this.cache.set('services', services, CACHE_TTL);
      return services;
    } catch (error) {
      logger.error(`Error fetching Autoxpose services: ${error.message}`);
      return [];
    }
  }

  async getDomain() {
    if (!this.isEnabled()) {
      return null;
    }

    if (this.domain) {
      return this.domain;
    }

    const cached = this.cache.get('domain');
    if (cached) {
      return cached;
    }

    try {
      const res = await this.fetchEndpoint(this.baseUrl, '/api/settings/dns');

      if (!res.ok) {
        logger.warn(`Failed to fetch DNS settings: HTTP ${res.status}`);
        return null;
      }

      const domain = typeof res.data?.domain === 'string'
        ? res.data.domain.slice(0, 253)
        : null;
      if (domain) {
        this.domain = domain;
        this.cache.set('domain', domain, CACHE_TTL * 10);
      }
      return domain;
    } catch (error) {
      logger.error(`Error fetching Autoxpose domain: ${error.message}`);
      return null;
    }
  }

  findServiceForPort(containerName, port, services, hostIp = null) {
    if (!services || !services.length) {
      return null;
    }

    const portNum = parseInt(port, 10);
    const cleanName = this.cleanContainerName(containerName);

    let match = services.find(svc =>
      svc.sourceId === containerName && svc.port === portNum && svc.enabled
    );

    if (!match) {
      match = services.find(svc =>
        svc.port === portNum &&
        svc.enabled &&
        (svc.name.includes(cleanName) || cleanName.includes(svc.name))
      );
      if (match) {
        logger.debug(`Name match: port ${portNum} (${containerName} -> ${cleanName}) -> ${match.name}`);
      }
    }

    if (!match) {
      const subdomain = (svc) => (svc.subdomain || svc.exposedSubdomain || '').toLowerCase();
      match = services.find(svc =>
        svc.port === portNum &&
        svc.enabled &&
        (subdomain(svc).includes(cleanName) || cleanName.includes(subdomain(svc)))
      );
      if (match) {
        logger.debug(`Subdomain match: port ${portNum} (${cleanName}) -> ${match.subdomain}`);
      }
    }

    if (!match && hostIp) {
      const externalServicesOnPort = services.filter(s => s.port === portNum && s.enabled && s.source === 'external');
      const effectiveIp = this.normalizeHostIp(hostIp);
      match = externalServicesOnPort.find(svc => {
        const target = (svc.targetHost || '').toLowerCase();
        const normalizedTarget = this.normalizeHostIp(target);
        return target && (normalizedTarget === effectiveIp || target === hostIp);
      });
      if (match) {
        logger.debug(`TargetHost match: port ${portNum} (${hostIp} -> ${effectiveIp}) -> ${match.subdomain} (${match.targetHost})`);
      }
    }

    if (!match) {
      const externalServicesOnPort = services.filter(s => s.port === portNum && s.enabled && s.source === 'external');
      
      if (externalServicesOnPort.length === 1) {
        match = externalServicesOnPort[0];
        logger.debug(`External port match: port ${portNum} (${containerName}) -> ${match.subdomain}`);
      }
    }

    return match || null;
  }

  cleanContainerName(name) {
    if (!name) return '';
    return name
      .replace(/^ix-/, '')
      .replace(/-\d+$/, '')
      .replace(/_\d+$/, '')
      .toLowerCase();
  }

  normalizeHostIp(ip) {
    if (!ip) return 'local';
    const lower = ip.toLowerCase();
    if (lower === '0.0.0.0' || lower === '127.0.0.1' || lower === 'localhost') return 'local';
    if (lower.startsWith('172.16.') || lower.startsWith('172.17.') || lower.startsWith('172.18.')) return 'local';
    const serverIp = this.getServerIp();
    if (serverIp && lower === serverIp) return 'local';
    return lower;
  }

  getServerIp() {
    if (!this.baseUrl) return null;
    try {
      const url = new URL(this.baseUrl);
      return url.hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  buildExposureData(service, domain) {
    if (!service || !domain) {
      return null;
    }

    const subdomain = service.exposedSubdomain || service.subdomain;
    const publicUrl = `https://${subdomain}.${domain}`;
    
    let sslStatus = 'none';
    if (service.sslPending) {
      sslStatus = 'pending';
    } else if (service.sslError) {
      sslStatus = 'error';
    } else if (subdomain) {
      sslStatus = 'active';
    }

    return {
      subdomain,
      domain,
      publicUrl,
      hostname: `${subdomain}.${domain}`,
      sslStatus,
      sslError: service.sslError || null,
      online: service.reachabilityStatus === 'online'
    };
  }

  async enrichPorts(ports) {
    if (!this.isEnabled()) {
      logger.debug('enrichPorts: autoxpose not enabled, skipping');
      return ports;
    }

    const [services, domain] = await Promise.all([
      this.getServices(),
      this.getDomain()
    ]);

    logger.debug(`enrichPorts: ${services.length} services, domain: ${domain}, ports: ${ports.length}`);

    if (!services.length || !domain) {
      return ports;
    }

    let matchCount = 0;
    const result = ports.map(port => {
      const match = this.findServiceForPort(port.owner, port.host_port, services, port.host_ip);
      if (!match) {
        if ([30027, 31030, 30041].includes(parseInt(port.host_port, 10))) {
          logger.debug(`NO MATCH for port ${port.host_port} owner=${port.owner} ip=${port.host_ip}`);
        }
        return port;
      }
      matchCount++;
      return {
        ...port,
        autoxpose: this.buildExposureData(match, domain)
      };
    });
    
    logger.debug(`enrichPorts: matched ${matchCount} ports with autoxpose services`);
    return result;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      configured: !!this.baseUrl,
      connected: this.connected,
      url: this.baseUrl ? this.baseUrl.replace(/\/+$/, '') : null,
      error: this.restoreError,
    };
  }
}

const autoxposeClient = new AutoxposeClient();
module.exports = autoxposeClient;
module.exports.AutoxposeClient = AutoxposeClient;
