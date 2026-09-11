/**
 * Authentication Middleware
 * 
 * Provides session management and authentication checking for portracker.
 * Authentication can be enabled/disabled via ENABLE_AUTH environment variable.
 */

const { Logger } = require('../lib/logger');
const { validateAnyApiKey } = require('../lib/api-key-manager');

const logger = new Logger('AuthMiddleware', { debug: process.env.DEBUG === 'true' });
const warnedOriginMismatches = new Set();

function getConfiguredCorsOrigins() {
  return String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map(value => value.trim())
    .filter(value => value && value !== '*')
    .map(value => {
      try {
        return new URL(value).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function requireAllowedOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) {
    return next();
  }

  try {
    const parsedOrigin = new URL(origin);
    const requestHost = req.headers.host;
    const configuredOrigins = getConfiguredCorsOrigins();
    if (
      parsedOrigin.host === requestHost ||
      configuredOrigins.includes(parsedOrigin.origin)
    ) {
      return next();
    }
    const mismatch = `${parsedOrigin.origin}|${requestHost || ''}`;
    if (!warnedOriginMismatches.has(mismatch)) {
      warnedOriginMismatches.add(mismatch);
      logger.warn('Cross-origin request blocked; preserve Host or configure CORS_ORIGIN', {
        origin: parsedOrigin.origin,
        host: requestHost || null,
      });
    }
  } catch {
    logger.debug('Rejected invalid request origin');
  }

  return res.status(403).json({ error: 'Cross-origin request blocked' });
}

/**
 * Check if authentication is enabled
 * Evaluated at runtime to allow dynamic configuration
 */
function isAuthEnabled() {
  return process.env.ENABLE_AUTH === 'true';
}

/**
 * Middleware to check if authentication is enabled in the system
 */
function checkAuthEnabled(req, res, next) {
  req.authEnabled = isAuthEnabled();
  next();
}

/**
 * Middleware to require authentication if enabled
 * If auth is disabled, allows request through
 * If auth is enabled, checks for valid session
 */
function requireAuth(req, res, next) {
  if (!isAuthEnabled()) {
    return next();
  }

  if (req.session && req.session.userId) {
    return next();
  }

  logger.debug('Unauthorized access attempt to protected endpoint:', req.path);
  return res.status(401).json({ 
    error: 'Authentication required',
    authEnabled: true 
  });
}

function requireAuthOrApiKey(req, res, next) {
  if (!isAuthEnabled()) {
    return next();
  }

  if (req.session && req.session.userId) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    validateAnyApiKey(apiKey).then(result => {
      if (result.valid) {
        req.apiKeyServerId = result.serverId;
        return next();
      }
      logger.debug('Invalid API key provided for:', req.path);
      return res.status(401).json({ 
        error: 'Authentication required',
        authEnabled: true 
      });
    }).catch(err => {
      logger.error('API key validation error:', err.message);
      return res.status(500).json({ error: 'Authentication error' });
    });
    return;
  }

  logger.debug('Unauthorized access attempt to protected endpoint:', req.path);
  return res.status(401).json({ 
    error: 'Authentication required',
    authEnabled: true 
  });
}

/**
 * Middleware to optionally check authentication
 * Passes through regardless, but sets req.isAuthenticated flag
 */
function optionalAuth(req, res, next) {
  req.isAuthenticated = false;
  
  if (isAuthEnabled() && req.session && req.session.userId) {
    req.isAuthenticated = true;
    req.userId = req.session.userId;
  }
  
  next();
}

/**
 * Check if a user is currently logged in
 */
function isLoggedIn(req) {
  if (!isAuthEnabled()) {
    return true;
  }
  return !!(req.session && req.session.userId);
}

module.exports = {
  getConfiguredCorsOrigins,
  requireAllowedOrigin,
  checkAuthEnabled,
  requireAuth,
  requireAuthOrApiKey,
  optionalAuth,
  isLoggedIn,
  isAuthEnabled
};
