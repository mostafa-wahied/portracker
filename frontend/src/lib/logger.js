/**
 * Frontend Logger System for portracker
 * Provides centralized logging with component identification and timestamp formatting
 * Consistent with backend logging patterns
 */

class Logger {
  constructor(componentName = 'Unknown', options = {}) {
    this.componentName = componentName;
    
    this.debugEnabled = this._getDebugSetting(options);
  }

  _getDebugSetting(options) {
    if (options.debug !== undefined) {
      return options.debug;
    }
    
    try {
      if (typeof window !== 'undefined' && window.location && typeof window.location.search === 'string') {
        const urlParams = new URLSearchParams(window.location.search);
        const dbg = urlParams.get('debug');
        if (dbg === 'true' || dbg === '1') {
          return true;
        }
        if (dbg === 'false' || dbg === '0') {
          return false;
        }
      }
    } catch { void 0; }
    
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('portracker_debug');
        if (stored === 'true') return true;
        if (stored === 'false') return false;
      }
    } catch { void 0; }
    
  return false;
  }

  formatTimestamp() {
    const now = new Date();
    return now.toISOString().slice(0, 19).replace('T', ' ');
  }

  getPrefix() {
    return `[${this.formatTimestamp()}] [${this.componentName}]`;
  }

  log(...args) {
    console.log(this.getPrefix(), ...args);
  }

  info(...args) {
    console.info(this.getPrefix(), '[INFO]', ...args);
  }

  warn(...args) {
    console.warn(this.getPrefix(), '[WARN]', ...args);
  }

  error(...args) {
    console.error(this.getPrefix(), '[ERROR]', ...args);
  }

  debug(...args) {
    if (this.debugEnabled) {
      console.debug(this.getPrefix(), '[DEBUG]', ...args);
    }
  }

  setDebug(enabled) {
    this.debugEnabled = enabled;
  }

  errorWithContext(message, error, context = {}) {
  console.error(this.getPrefix(), '[ERROR]', message, {
      error: error?.message || error,
      stack: error?.stack,
      ...context
    });
  }

  performance(label, duration) {
  console.log(this.getPrefix(), '[PERF]', `${label}: ${duration}ms`);
  }
}

function LoggerFactory(componentName, options = {}) {
  return new Logger(componentName, options);
}

export { Logger, LoggerFactory };
export default Logger;
