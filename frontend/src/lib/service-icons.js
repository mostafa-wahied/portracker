const HOMARR_BASE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons';
const SELFHST_BASE = 'https://cdn.jsdelivr.net/gh/selfhst/icons';

const ALIASES = {
  'wg-easy': 'wireguard',
  'npm': 'nginx-proxy-manager',
  'pgvecto': 'postgres',
  'pgvecto-rs': 'postgres',
  'plex-media-server': 'plex',
  'jellyfin-server': 'jellyfin',
  'home-assistant-core': 'home-assistant',
  'code-server': 'vscode',
  'actual-server': 'actual',
  'paperless-ngx': 'paperless',
  'overseerr-overseerr': 'overseerr',
  'radarr-radarr': 'radarr',
  'sonarr-sonarr': 'sonarr',
  'prowlarr-prowlarr': 'prowlarr',
  'bazarr-bazarr': 'bazarr',
  'lidarr-lidarr': 'lidarr',
  'readarr-readarr': 'readarr',
  'sabnzbd-sabnzbd': 'sabnzbd',
  'qbittorrent-qbittorrent': 'qbittorrent',
  'transmission-transmission': 'transmission',
  'deluge-deluge': 'deluge',
};

export function extractServiceName(input) {
  if (!input) return '';
  
  let name = input.toLowerCase().trim();
  name = name.replace(/:[^/]+$/, '');
  
  const parts = name.split('/');
  name = parts[parts.length - 1] || parts[parts.length - 2] || '';
  
  name = name.replace(/^(ix-|k8s-|binhex-|linuxserver-|lscr\.io-|ghcr\.io-)/, '');
  name = name.replace(/^(umbrel[-_]|casaos-|cosmos-|tipi_|ynh-)/, '');
  name = name.replace(/^(lxc-\d+-?|vm-\d+-?)/, '');
  name = name.replace(/^(pkg-|cs-container-)/, '');
  
  name = name.replace(/[-_]\d+$/, '');
  
  return name;
}

function getNameVariants(extracted) {
  const variants = new Set([extracted]);
  
  const withoutSuffix = extracted.replace(/[-_](upgrade|test|dev|prod|staging|local|beta|alpha|server|daemon|db|proxy)$/, '');
  if (withoutSuffix !== extracted) variants.add(withoutSuffix);
  
  const hyphenParts = extracted.split('-');
  if (hyphenParts.length >= 2) {
    variants.add(hyphenParts[0]);
    variants.add(hyphenParts[hyphenParts.length - 1]);
    
    for (let i = 0; i < hyphenParts.length - 1; i++) {
      const twoPartName = hyphenParts[i] + '-' + hyphenParts[i + 1];
      variants.add(twoPartName);
    }
    
    const mid = Math.floor(hyphenParts.length / 2);
    const firstHalf = hyphenParts.slice(0, mid).join('-');
    const secondHalf = hyphenParts.slice(mid).join('-');
    if (firstHalf) variants.add(firstHalf);
    if (secondHalf && secondHalf !== firstHalf) variants.add(secondHalf);
  }
  
  const result = [];
  variants.forEach(v => {
    result.push(v);
    if (ALIASES[v]) result.push(ALIASES[v]);
  });
  
  return [...new Set(result)];
}

export function getIconUrls(input, isDarkMode = false) {
  if (!input) return [];
  
  const extracted = extractServiceName(input);
  if (!extracted) return [];
  
  const names = getNameVariants(extracted);
  const seen = new Set();
  const urls = [];
  
  const addUrl = (url, isThemeVariant = false) => {
    if (!seen.has(url)) {
      seen.add(url);
      urls.push({ url, isThemeVariant });
    }
  };
  
  names.forEach(n => {
    addUrl(`${HOMARR_BASE}/svg/${n}.svg`, false);
    
    if (isDarkMode) {
      addUrl(`${HOMARR_BASE}/svg/${n}-light.svg`, true);
    } else {
      addUrl(`${HOMARR_BASE}/svg/${n}-dark.svg`, true);
    }
    
    addUrl(`${SELFHST_BASE}/svg/${n}.svg`, false);
    
    if (isDarkMode) {
      addUrl(`${SELFHST_BASE}/svg/${n}-light.svg`, true);
    } else {
      addUrl(`${SELFHST_BASE}/svg/${n}-dark.svg`, true);
    }
    
    addUrl(`${HOMARR_BASE}/png/${n}.png`, false);
  });
  
  return urls;
}
