import Logger from './logger';

const logger = new Logger('WhatsNewUtils');

const CATEGORY_KEYS = [
  'security',
  'dashboard',
  'integrations',
  'data',
  'tooling',
  'frontend',
  'backend',
  'fixes',
  'misc'
];

function createFeatureBuckets() {
  return CATEGORY_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});
}

const CATEGORY_MAPPINGS = [
  { match: /(security|auth|access)/i, bucket: 'security' },
  { match: /(dashboard|ui|ux|interface)/i, bucket: 'dashboard' },
  { match: /(server|collector|truenas|docker|integration)/i, bucket: 'integrations' },
  { match: /(data|db|database|infrastructure|performance|cache)/i, bucket: 'data' },
  { match: /(tooling|ops|operation|automation|deploy)/i, bucket: 'tooling' },
  { match: /(frontend|client)/i, bucket: 'frontend' },
  { match: /(backend|api)/i, bucket: 'backend' },
  { match: /(fix|bug|stability|patch)/i, bucket: 'fixes' },
];

function mapSectionToCategory(sectionName) {
  const normalized = sectionName.toLowerCase();
  for (const mapping of CATEGORY_MAPPINGS) {
    if (mapping.match.test(normalized)) {
      return mapping.bucket;
    }
  }
  return 'misc';
}

export function parseChangelog(changelogContent) {
  try {
    const versions = {};
    const lines = changelogContent.split('\n');
    let currentVersion = null;
    let currentSection = null;
    let features = createFeatureBuckets();
    let lastFeature = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      const versionMatch = line.match(/^##\s*\[([^\]]+)\]/);
      if (versionMatch) {
        const hasContent = Object.values(features).some(arr => arr.length > 0);
        if (currentVersion && hasContent) {
          versions[currentVersion] = { ...features };
        }
        
        currentVersion = versionMatch[1];
        currentSection = null;
        features = createFeatureBuckets();
        lastFeature = null;
        continue;
      }

      const sectionMatch = line.match(/^###\s+(.+)$/);
      if (sectionMatch && currentVersion) {
        currentSection = mapSectionToCategory(sectionMatch[1]);
        lastFeature = null;
        continue;
      }

      const featureMatch = line.match(/^-\s*\*\*(.+?)\*\*:\s*(.+)$/);
      if (featureMatch && currentSection) {
        const title = featureMatch[1].trim();
        const description = featureMatch[2].trim();
        
        const isSubItem = title.startsWith('[sub]');
        
        if (isSubItem && lastFeature) {
          const cleanTitle = title.replace(/^\[sub\]\s*/, '').trim();
          if (!lastFeature.details) {
            lastFeature.details = [];
          }
          lastFeature.details.push({ title: cleanTitle, description });
        } else {
          const feature = {
            title: isSubItem ? title.replace(/^\[sub\]\s*/, '').trim() : title,
            description,
            details: []
          };
          
          features[currentSection].push(feature);
          lastFeature = feature;
        }
        continue;
      }

      const subItemMatch = line.match(/^-\s*\*\*\[sub\]\*\*\s+(.+)$/);
      if (subItemMatch && lastFeature && currentSection) {
        const text = subItemMatch[1].trim();
        if (!lastFeature.details) {
          lastFeature.details = [];
        }
        lastFeature.details.push({ title: '', description: text });
      }
    }

    const hasContent = Object.values(features).some(arr => arr.length > 0);
    if (currentVersion && hasContent) {
      versions[currentVersion] = { ...features };
    }

    logger.debug('Parsed changelog versions:', Object.keys(versions));
    return versions;
  } catch (error) {
    logger.error('Error parsing changelog:', error);
    return {};
  }
}

export function getLastSeenVersion() {
  try {
    return localStorage.getItem('portracker_last_seen_version') || null;
  } catch (error) {
    logger.warn('Failed to get last seen version:', error);
    return null;
  }
}

export function setLastSeenVersion(version) {
  try {
    localStorage.setItem('portracker_last_seen_version', version);
    logger.debug('Set last seen version:', version);
  } catch (error) {
    logger.warn('Failed to set last seen version:', error);
  }
}

export function compareVersions(v1, v2) {
  if (!v1 || !v2) return 0;
  
  const parseVersion = (version) => {
    return version.split('.').map(num => parseInt(num, 10) || 0);
  };

  const version1 = parseVersion(v1);
  const version2 = parseVersion(v2);
  
  const maxLength = Math.max(version1.length, version2.length);
  
  for (let i = 0; i < maxLength; i++) {
    const num1 = version1[i] || 0;
    const num2 = version2[i] || 0;
    
    if (num1 < num2) return -1;
    if (num1 > num2) return 1;
  }
  
  return 0;
}

export function getNewVersions(parsedVersions, lastSeenVersion) {
  logger.debug('getNewVersions called:', {
    parsedVersionsKeys: Object.keys(parsedVersions),
    lastSeenVersion,
    parsedVersions: parsedVersions
  });
  
  if (!parsedVersions || Object.keys(parsedVersions).length === 0) {
    logger.debug('getNewVersions: No parsed versions available');
    return [];
  }
  
  const availableVersions = Object.keys(parsedVersions).sort((a, b) => compareVersions(b, a));
  logger.debug('getNewVersions: Available versions sorted:', availableVersions);
  
  if (!lastSeenVersion) {
    logger.debug('getNewVersions: No last seen version, returning all versions:', availableVersions);
    return availableVersions;
  }
  
  const newVersions = availableVersions.filter(version => {
    const comparison = compareVersions(version, lastSeenVersion);
    logger.debug('getNewVersions: Comparing', version, 'vs', lastSeenVersion, '=', comparison);
    return comparison > 0;
  });
  
  logger.debug('getNewVersions: Filtered new versions:', newVersions);
  return newVersions;
}

export function combineVersionChanges(versions, versionKeys) {
  const combined = createFeatureBuckets();
  
  const sortedVersions = versionKeys.sort((a, b) => compareVersions(b, a));
  
  for (const version of sortedVersions) {
    const versionChanges = versions[version];
    if (versionChanges) {
      CATEGORY_KEYS.forEach(key => {
        if (versionChanges[key]?.length) {
          combined[key].push(...versionChanges[key]);
        }
      });
    }
  }
  
  return combined;
}

export function groupVersionChanges(versions, versionKeys) {
  const sortedVersions = versionKeys.sort((a, b) => compareVersions(b, a));
  
  return sortedVersions.map(version => {
    const versionChanges = versions[version];
    const changes = createFeatureBuckets();
    
    if (versionChanges) {
      CATEGORY_KEYS.forEach(key => {
        if (versionChanges[key]?.length) {
          changes[key].push(...versionChanges[key]);
        }
      });
    }
    
    return {
      version,
      changes
    };
  }).filter(item => CATEGORY_KEYS.some(key => item.changes[key]?.length > 0));
}

export function shouldShowWhatsNew(currentVersion) {
  if (!currentVersion) {
    logger.debug('shouldShowWhatsNew: No current version provided');
    return false;
  }
  
  const lastSeenVersion = localStorage.getItem('portracker_last_seen_version');
  
  if (!lastSeenVersion) {
    logger.debug('shouldShowWhatsNew: No last seen version, first time user');
    return true;
  }
  
  const comparison = compareVersions(currentVersion, lastSeenVersion);
  logger.debug('shouldShowWhatsNew: Version comparison:', {
    currentVersion,
    lastSeenVersion,
    comparison,
    shouldShow: comparison > 0
  });
  
  return comparison > 0;
}
