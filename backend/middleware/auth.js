/**
 * Authentication Middleware
 * 
 * Provides session management and authentication checking for portracker.
 * Authentication can be enabled/disabled via ENABLE_AUTH environment variable.
 */

const { Logger } = require('../lib/logger');

const logger = new Logger('AuthMiddleware', { debug: process.env.DEBUG === 'true' });

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
  checkAuthEnabled,
  requireAuth,
  optionalAuth,
  isLoggedIn,
  isAuthEnabled
};
