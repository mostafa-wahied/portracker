/**
 * Centralized logging system for portracker
 * Provides consistent logging across all components
 */

class Logger {
  constructor(component, options = {}) {
    this.component = component;
    this.debugEnabled = options.debug !== undefined ? options.debug : process.env.DEBUG === 'true';
  }

  /**
   * Internal logging method with consistent formatting
   */
  _log(level, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${this.component}] ${level}:`;
    
    switch (level) {
      case 'DEBUG':
        if (this.debugEnabled) {
          console.log(prefix, ...args);
        }
        break;
      case 'INFO':
        console.log(prefix, ...args);
        break;
      case 'WARN':
        console.warn(prefix, ...args);
        break;
      case 'ERROR':
        console.error(prefix, ...args);
        break;
      case 'FATAL':
        console.error(prefix, ...args);
        break;
    }
  }

  /**
   * Log debug messages (only shown when debug is enabled)
   */
  debug(...args) {
    this._log('DEBUG', ...args);
  }

  /**
   * Log informational messages
   */
  info(...args) {
    this._log('INFO', ...args);
  }

  /**
   * Log warning messages
   */
  warn(...args) {
    this._log('WARN', ...args);
  }

  /**
   * Log error messages
   */
  error(...args) {
    this._log('ERROR', ...args);
  }

  /**
   * Log fatal error messages
   */
  fatal(...args) {
    this._log('FATAL', ...args);
  }

  /**
   * Enable or disable debug logging
   */
  setDebugEnabled(enabled) {
    this.debugEnabled = enabled;
  }

  /**
   * Check if debug logging is enabled
   */
  isDebugEnabled() {
    return this.debugEnabled;
  }
}

/**
 * Static logger factory for quick access
 */
class LoggerFactory {
  static create(component, options = {}) {
    return new Logger(component, options);
  }

  /**
   * Quick static logging methods for simple use cases
   */
  static info(component, ...args) {
    const logger = new Logger(component);
    logger.info(...args);
  }

  static debug(component, enabled, ...args) {
    const logger = new Logger(component, { debug: enabled });
    logger.debug(...args);
  }

  static warn(component, ...args) {
    const logger = new Logger(component);
    logger.warn(...args);
  }

  static error(component, ...args) {
    const logger = new Logger(component);
    logger.error(...args);
  }

  static fatal(component, ...args) {
    const logger = new Logger(component);
    logger.fatal(...args);
  }
}

module.exports = { Logger, LoggerFactory };
