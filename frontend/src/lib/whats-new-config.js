const whatsNewConfig = {
  combineWhatsNewGroups: [
    { versions: ['1.3.1', '1.3.2', '1.3.3', '1.3.4'], mergeTitles: ['Duplicate Ports'] }
  ],
  ignoreVersions: ['Unreleased'],
  maxVersionsOnFirstOpen: 1,
  hiddenTitles: [
    'Frontend Error Logging',
    'CI',
    'npm Vulnerabilities',
    'Remove Vulnerable SQLite System Packages',
    'Port Dedup Key Consistency',
    'TrueNAS WebSocket Base Handling',
    'TrueNAS API Key Revocation',
    'Debug Logging',
    'Internal / Port display fixes',
    'Port protocol reporting',
    'Batch rename migration fix',
    'Misc.',
    'System Port Name Fix',
    'Consistent Status Indicators',
    'Dockerode Integration',
    'Centralized Logging',
    'Security Hardening',
    'Data Collection',
    'Docker Integration',
    'Web Interface',
    'Server Management',
    'Server Health Indicator',
    'Last Refreshed Timestamp'
  ],
  featureOverrides: {
    'Container Heuristic': {
      title: 'Better service naming in stack deployments',
      description: 'Reduced false matches when containers share the same stack name.'
    },
    'Swarm Fallback Icon': {
      title: 'Better Docker service icons',
      description: 'Swarm services keep a recognizable Docker icon when the remote icon lookup fails.'
    },
    'Swarm Ingress Support': {
      title: 'Docker Swarm ingress ports group correctly',
      description: 'Ingress-mode published ports now stay attached to the right Docker service instead of falling back to system ports.'
    },
    'TrueNAS API Key Transport Security': {
      title: 'Safer TrueNAS API key transport',
      description: 'TrueNAS API key connections now stay on secure WebSocket endpoints.'
    },
    'Host-Network Service Deduplication': {
      title: 'No more duplicate host-network services',
      description: 'Services using host networking no longer show up twice when discovered through multiple paths.'
    },
    'Service Port Rendering': {
      title: 'Cleaner service port chips',
      description: 'Services no longer show repeated port chips when entries share the same host port.'
    },
    'Database Schema': {
      title: 'Fresh installs work again',
      description: 'Fixed a missing column that broke brand-new installs on first launch.'
    },
    'API Key Authentication': {
      title: 'Secure peer-to-peer between instances',
      description: 'Generate API keys in Settings to securely connect portracker instances.'
    },
    'Endpoint Protection': {
      title: 'Endpoints protected when auth is on',
      description: 'All data endpoints now require auth when authentication is enabled.'
    },
    'autoxpose Integration': {
      title: "See what's exposed publicly",
      description: 'Connect an autoxpose instance in Settings to see public URLs next to your internal ports.'
    },
    'Settings Modal': {
      title: 'One place for settings',
      description: 'Theme, refresh interval, autoxpose connection, and advanced options live in a single modal.'
    },
    'Reverse Proxy Support': {
      title: 'Works behind a reverse proxy',
      description: 'Set HOST_OVERRIDE to control the hostname used in port links.'
    },
    'System Port Detection': {
      title: 'System ports detected in containers',
      description: 'Restored SSH, SMB, and other system port detection inside containerized deployments.'
    },
    'Service-Centric View': {
      title: 'Ports grouped by service',
      description: 'Ports are now grouped by service in expandable cards. This is the default view.'
    },
    'Service Icons': {
      title: 'Service icons, theme-aware',
      description: 'Known services show icons that adapt to light and dark mode.'
    },
    'Collapsed Health Status': {
      title: 'Health at a glance when collapsed',
      description: 'Collapsed service cards now show an aggregated health indicator.'
    },
    'Favicon': {
      title: 'Favicon follows your theme',
      description: 'The favicon now adapts to light and dark system themes.'
    },
    'TrueNAS Integration': {
      title: 'Faster, more reliable TrueNAS',
      description: 'Parallel API calls, per-call timeouts, and reused connections make TrueNAS collection steadier.'
    },
    'TrueNAS Enhanced Features': {
      title: 'TrueNAS VMs and LXCs from the UI',
      description: 'Add a TrueNAS API key from Settings to see VM and LXC containers in your dashboard.'
    },
    'Authentication': {
      title: 'Optional dashboard login',
      description: 'Turn on ENABLE_AUTH to protect the dashboard. Off by default.'
    },
    'Auto-Refresh': {
      title: 'Auto-refresh every 30s',
      description: 'Toggle auto-refresh from the header to keep ports and services live.'
    },
    'Random Port Generator': {
      title: 'Pick an unused port',
      description: "One click to generate a port that isn't already taken."
    },
    'Virtual Machines & Containers': {
      title: 'VMs and LXCs look right',
      description: 'VMs and LXC containers now show correct icons and badges.'
    },
    'Service renaming': {
      title: 'Rename services from the UI',
      description: 'You can rename services directly in the dashboard.'
    },
    'Batch actions': {
      title: 'Bulk actions on ports',
      description: 'Select multiple services or ports to ignore or annotate them at once.'
    },
    'Container Details Drawer': {
      title: 'Container details drawer',
      description: 'Slide-out panel with stats, labels, mounts, and env vars for Docker containers.'
    },
    'Internal Port Display': {
      title: 'Internal vs published ports, clear',
      description: 'Internal-only ports are now clearly distinguished from published ones, with health status.'
    },
    'Global Search': {
      title: 'Search across all servers',
      description: 'The search bar can search every connected server at once.'
    },
    "What's New": {
      title: 'Release notes modal',
      description: 'portracker tells you what changed when you open a new version.'
    },
    'Collector Caching': {
      title: 'Faster refreshes',
      description: 'Data collectors now cache between refreshes to reduce duplicate work.'
    },
    'Enhanced Service Detection': {
      title: 'Better service detection',
      description: 'Improved identification and categorization of running services, including SPA apps.'
    },
    'Port Status Indicators': {
      title: 'Clearer port status',
      description: 'Visual distinction between published and internal ports, with detailed status.'
    },
    'Removed network_mode: host Requirement': {
      title: 'No host networking required',
      description: 'Direct /proc parsing replaces the need for Docker host networking mode.'
    },
    'Advanced Port Detection': {
      title: 'More accurate port detection',
      description: 'Multiple detection methods improve container and system port identification.'
    },
    'Improved Container Introspection': {
      title: 'Steadier container collection',
      description: 'Better error handling and fallbacks across platforms for reliable port collection.'
    },
    'Simplified Docker Dependencies': {
      title: 'Simpler Docker setup',
      description: 'No extra system socket mounts required, and Docker proxy is supported.'
    },
    'Enhanced Data Accuracy': {
      title: 'More accurate container metadata',
      description: 'Timestamps and metadata parsing are more precise.'
    },
    'Multi-platform Port Tracking': {
      title: 'portracker is out',
      description: 'Monitor ports across multiple servers from one dashboard.'
    }
  }
};

export default whatsNewConfig;
