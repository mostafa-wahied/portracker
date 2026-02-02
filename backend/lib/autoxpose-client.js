const { Logger } = require('./logger');
const { SimpleTTLCache } = require('../utils/cache');

const logger = new Logger('AutoxposeClient', { debug: process.env.DEBUG === 'true' });
const CACHE_TTL = parseInt(process.env.AUTOXPOSE_CACHE_TTL_MS || '30000', 10);

class AutoxposeClient {
  constructor(baseUrl = null) {
    this.baseUrl = baseUrl || process.env.AUTOXPOSE_URL || null;
    this.enabled = process.env.AUTOXPOSE_ENABLED === 'true';
    this.cache = new SimpleTTLCache();
    this.connected = false;
    this.domain = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      const settingsManager = require('./settings-manager');
      const settings = settingsManager.getUserSettings(null);
      
      if (settings.autoxposeEnabled && settings.autoxposeUrl) {
        this.baseUrl = settings.autoxposeUrl;
        logger.info(`Restoring autoxpose connection to ${this.baseUrl}`);
        const result = await this.testConnection();
        if (result.success) {
          logger.info('Autoxpose connection restored successfully');
        } else {
          logger.warn(`Failed to restore autoxpose connection: ${result.error}`);
        }
      }
    } catch (error) {
      logger.error(`Error initializing autoxpose client: ${error.message}`);
    }
    
    this.initialized = true;
  }

  setBaseUrl(url) {
    this.baseUrl = url;
    this.connected = false;
    this.cache.clear();
  }

  isEnabled() {
    return this.connected && !!this.baseUrl;
  }

  async testConnection() {
    if (!this.baseUrl) {
      return { success: false, error: 'No Autoxpose URL configured' };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });

      clearTimeout(timeout);

      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }

      const data = await res.json();
      this.connected = data.status === 'ok';
      if (this.connected) {
        logger.info(`Connected to Autoxpose at ${this.baseUrl}`);
      }
      return { success: this.connected, version: data.version || 'unknown' };
    } catch (error) {
      this.connected = false;
      const message = error.name === 'AbortError' ? 'Connection timeout' : error.message;
      logger.warn(`Failed to connect to Autoxpose: ${message}`);
      return { success: false, error: message };
    }
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
      const res = await fetch(`${this.baseUrl}/api/services?includeExternal=true`, {
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        logger.warn(`Failed to fetch services: HTTP ${res.status}`);
        return [];
      }

      const data = await res.json();
      const services = data.services || [];
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
      const res = await fetch(`${this.baseUrl}/api/settings/dns`, {
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) {
        logger.warn(`Failed to fetch DNS settings: HTTP ${res.status}`);
        return null;
      }

      const data = await res.json();
      const domain = data.domain || null;
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

  findServiceForPort(containerName, port, services) {
    if (!services || !services.length) {
      return null;
    }

    const portNum = parseInt(port, 10);

    let match = services.find(svc =>
      svc.sourceId === containerName && svc.port === portNum && svc.enabled
    );

    if (!match) {
      const cleanName = this.cleanContainerName(containerName);
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
      match = services.find(svc =>
        svc.port === portNum &&
        svc.enabled &&
        svc.source === 'external'
      );
      if (match) {
        logger.debug(`External match: port ${portNum} (${containerName}) -> ${match.name}`);
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
      const match = this.findServiceForPort(port.owner, port.host_port, services);
      if (!match) {
        if ([30027, 31030, 30041].includes(parseInt(port.host_port, 10))) {
          logger.debug(`NO MATCH for port ${port.host_port} owner=${port.owner}`);
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
      url: this.baseUrl ? this.baseUrl.replace(/\/+$/, '') : null
    };
  }
}

const autoxposeClient = new AutoxposeClient();
module.exports = autoxposeClient;
