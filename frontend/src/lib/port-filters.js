import ipaddr from 'ipaddr.js';

export const bindingOptions = [
  { value: 'all', label: 'All' },
  { value: 'server', label: 'Server-only' },
  { value: 'network', label: 'Network-listening' },
];

export function normalizePortFilters(saved) {
  return {
    docker: typeof saved?.docker === 'boolean' ? saved.docker : true,
    system: typeof saved?.system === 'boolean' ? saved.system : false,
    binding: bindingOptions.some(option => option.value === saved?.binding) ? saved.binding : 'all',
  };
}

export function classifyPortBinding(port) {
  if (port.internal) return 'unpublished';
  if (typeof port.host_ip !== 'string') return 'unknown';
  const address = port.host_ip.trim().replace(/^\[([^\]]+)\]$/, '$1');
  if (address.toLowerCase() === 'localhost') return 'server';
  if (!ipaddr.isValid(address)) return 'unknown';
  return ipaddr.process(address).range() === 'loopback' ? 'server' : 'network';
}

export function filterPortGroup(group, filters, searchTerm = '') {
  if (!group.ok || !group.data) return group;
  const binding = normalizePortFilters(filters).binding;
  const searchLower = searchTerm.toLowerCase();
  return {
    ...group,
    data: group.data.filter(port => {
      const matchesSource = (port.source === 'docker' && filters.docker) ||
        (port.source === 'system' && filters.system);
      if (!matchesSource || (binding !== 'all' && classifyPortBinding(port) !== binding)) return false;
      if (!searchTerm) return true;
      return port.host_port.toString().includes(searchLower) ||
        (port.owner && port.owner.toLowerCase().includes(searchLower)) ||
        (port.customServiceName && port.customServiceName.toLowerCase().includes(searchLower)) ||
        (port.host_ip && port.host_ip.includes(searchLower)) ||
        port.target?.includes?.(searchLower) ||
        (port.note && port.note.toLowerCase().includes(searchLower));
    }),
  };
}
