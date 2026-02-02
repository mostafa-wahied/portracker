/**
 * Utility functions for port-related operations
 */

/**
 * Generates a unique key for a port selection
 * @param {string} serverId - The server ID
 * @param {Object} port - The port object
 * @returns {string} Unique port key
 */
export function generatePortKey(serverId, port) {
  const internalSuffix = port.internal ? '-internal' : '';
  return `${serverId}-${port.host_ip}-${port.host_port}-${port.container_id || ''}${internalSuffix}`;
}

/**
 * Generates display key for port (used for itemKey props)
 * @param {string} serverId - The server ID  
 * @param {Object} port - The port object
 * @returns {string} Display key
 */
export function generatePortDisplayKey(serverId, port) {
  return port.internal
    ? `${serverId}-${port.container_id || port.app_id}-${port.host_port}-internal`
    : `${serverId}-${port.host_ip}-${port.host_port}`;
}

/**
 * Generates autoxpose lookup key from port object
 * Key format: container_id_prefix:host_port
 * @param {Object} port - The port object with container_id and host_port
 * @returns {string|null} Autoxpose lookup key or null if no container_id
 */
export function getAutoxposeKey(port) {
  if (!port.container_id || !port.host_port) return null;
  return `${port.container_id.substring(0, 12)}:${port.host_port}`;
}

/**
 * Lookup autoxpose data for a port
 * Checks two sources:
 * 1. Backend-enriched port.autoxpose (includes external services)
 * 2. Frontend autoxposePorts Map (for real-time updates)
 * @param {Map} autoxposePorts - Map of autoxpose data keyed by container:port
 * @param {Object} port - The port object
 * @returns {Object|null} Autoxpose data or null
 */
export function getAutoxposeData(autoxposePorts, port) {
  if (!port) return null;
  
  if (port.autoxpose) {
    const data = port.autoxpose;
    return {
      url: data.publicUrl || data.url,
      hostname: data.hostname,
      sslStatus: data.sslStatus
    };
  }
  
  if (!autoxposePorts) return null;
  const key = getAutoxposeKey(port);
  return key ? autoxposePorts.get(key) : null;
}