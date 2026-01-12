/**
 * Authentication Routes
 * 
 * Handles user authentication including login, logout, and initial setup.
 * All endpoints use session-based authentication with bcrypt password hashing.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { Logger } = require('../lib/logger');
const { isAuthEnabled } = require('../middleware/auth');
const recoveryManager = require('../lib/recovery-manager');
const { translateForReq } = require('../lib/i18n');

const router = express.Router();
const logger = new Logger('AuthRoutes', { debug: process.env.DEBUG === 'true' });

router.get('/status', (req, res) => {
  try {
    if (!isAuthEnabled()) {
      return res.json({
        authEnabled: false,
        authenticated: true,
        setupRequired: false
      });
    }

    let userCount;
    try {
      userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    } catch (err) {
      logger.warn('Users table does not exist yet, setup required:', err.message);
      return res.json({
        authEnabled: true,
        authenticated: false,
        setupRequired: true
      });
    }

    const setupRequired = userCount.count === 0;
    const authenticated = !!(req.session && req.session.userId);

    res.json({
      authEnabled: true,
      authenticated,
      setupRequired,
      username: authenticated ? req.session.username : null
    });
  } catch (error) {
    logger.error('Error checking auth status:', error.message);
    const def = 'Failed to check authentication status';
    const localized = translateForReq(req, 'auth.check_status_failed', def);
    res.status(500).json({ error: def, error_code: 'auth.check_status_failed', error_localized: localized });
  }
});

router.post('/setup', async (req, res) => {
  try {
    if (!isAuthEnabled()) {
      const def = 'Authentication is not enabled';
      const localized = translateForReq(req, 'auth.not_enabled', def);
      return res.status(400).json({ error: def, error_code: 'auth.not_enabled', error_localized: localized });
    }

    const { username, password } = req.body;

    if (!username || !password) {
      const def = 'Username and password are required';
      const localized = translateForReq(req, 'auth.username_password_required', def);
      return res.status(400).json({ error: def, error_code: 'auth.username_password_required', error_localized: localized });
    }

    if (typeof username !== 'string' || username.trim().length < 3) {
      const def = 'Username must be at least 3 characters';
      const localized = translateForReq(req, 'auth.username_min', def);
      return res.status(400).json({ error: def, error_code: 'auth.username_min', error_localized: localized });
    }

    if (typeof password !== 'string' || password.length < 8) {
      const def = 'Password must be at least 8 characters';
      const localized = translateForReq(req, 'auth.password_min', def);
      return res.status(400).json({ error: def, error_code: 'auth.password_min', error_localized: localized });
    }

    let userCount;
    try {
      userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    } catch (dbError) {
      logger.error('Users table does not exist:', dbError.message);
      const def = 'Database not initialized';
      const localized = translateForReq(req, 'auth.db_not_initialized', def);
      return res.status(500).json({ error: def, error_code: 'auth.db_not_initialized', error_localized: localized });
    }

    if (userCount.count > 0) {
      const def = 'Setup already completed';
      const localized = translateForReq(req, 'auth.setup_already_completed', def);
      return res.status(400).json({ error: def, error_code: 'auth.setup_already_completed', error_localized: localized });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    const now = Date.now();

    db.prepare(
      'INSERT INTO users (id, username, password_hash, created_at, last_login) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, username.trim(), passwordHash, now, now);

    req.session.regenerate((err) => {
      if (err) {
        logger.error('Session regeneration failed:', err.message);
        const def = 'Setup failed';
        const localized = translateForReq(req, 'auth.setup_failed', def);
        return res.status(500).json({ error: def, error_code: 'auth.setup_failed', error_localized: localized });
      }

      req.session.userId = userId;
      req.session.username = username.trim();

      req.session.save((saveErr) => {
        if (saveErr) {
          logger.error('Session save failed:', saveErr.message);
          const def = 'Setup failed';
          const localized = translateForReq(req, 'auth.setup_failed', def);
          return res.status(500).json({ error: def, error_code: 'auth.setup_failed', error_localized: localized });
        }

        logger.info(`Initial admin user created: ${username.trim()}`);

        res.json({
          success: true,
          message: 'Setup completed successfully',
          message_code: 'auth.setup_completed',
          message_localized: translateForReq(req, 'auth.setup_completed', 'Setup completed successfully'),
          username: username.trim()
        });
      });
    });
  } catch (error) {
    logger.error('Error during setup:', error.message);
    const def = 'Setup failed';
    const localized = translateForReq(req, 'auth.setup_failed', def);
    res.status(500).json({ error: def, error_code: 'auth.setup_failed', error_localized: localized });
  }
});

router.post('/login', async (req, res) => {
  try {
    if (!isAuthEnabled()) {
      return res.status(400).json({ error: 'Authentication is not enabled' });
    }

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const trimmedUsername = typeof username === 'string' ? username.trim() : username;

    const isRecoveryKey = recoveryManager.validateKey(password);
    
    if (isRecoveryKey) {
      let user;
      try {
        user = db.prepare('SELECT * FROM users LIMIT 1').get();
      } catch (dbError) {
        logger.error('Database error during recovery:', dbError.message);
        return res.status(500).json({ error: 'Recovery failed' });
      }

      if (!user) {
        return res.status(400).json({ error: 'No users found in database' });
      }

      recoveryManager.markAsUsed();

      req.session.regenerate((err) => {
        if (err) {
          logger.error('Session regeneration failed:', err.message);
          return res.status(500).json({ error: 'Recovery failed' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.requirePasswordChange = true;

        req.session.save((saveErr) => {
          if (saveErr) {
            logger.error('Session save failed:', saveErr.message);
            return res.status(500).json({ error: 'Recovery failed' });
          }

          logger.info(`Recovery key used for user: ${user.username}`);

          return res.json({
            success: true,
            username: user.username,
            requirePasswordChange: true
          });
        });
      });
      return;
    }

    let user;
    try {
      user = db.prepare('SELECT * FROM users WHERE username = ?').get(trimmedUsername);
    } catch (dbError) {
      logger.error('Database error during login:', dbError.message);
      return res.status(500).json({ error: 'Login failed' });
    }

    const hashToCompare = user ? user.password_hash : '$2a$10$AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const isValid = await bcrypt.compare(password, hashToCompare);

    if (!user || !isValid) {
      logger.debug(`Failed login attempt for user: ${trimmedUsername}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);

    req.session.regenerate((err) => {
      if (err) {
        logger.error('Session regeneration failed:', err.message);
        return res.status(500).json({ error: 'Login failed' });
      }

      req.session.userId = user.id;
      req.session.username = user.username;

      req.session.save((saveErr) => {
        if (saveErr) {
          logger.error('Session save failed:', saveErr.message);
          return res.status(500).json({ error: 'Login failed' });
        }

        logger.info(`User logged in: ${user.username}`);

        res.json({
          success: true,
          username: user.username
        });
      });
    });
  } catch (error) {
    logger.error('Error during login:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  const username = req.session?.username;
  
  req.session.destroy((err) => {
    if (err) {
      logger.error('Error destroying session:', err.message);
      return res.status(500).json({ error: 'Logout failed' });
    }

    if (username) {
      logger.info(`User logged out: ${username}`);
    }

    res.json({ success: true, message: 'Logged out successfully' });
  });
});

router.post('/change-password', async (req, res) => {
  try {
    if (!isAuthEnabled()) {
      return res.status(400).json({ error: 'Authentication is not enabled' });
    }

    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { currentPassword, newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const requirePasswordChange = req.session.requirePasswordChange;

    if (!requirePasswordChange && !currentPassword) {
      return res.status(400).json({ error: 'Current password is required' });
    }

    let user;
    try {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    } catch (dbError) {
      logger.error('Database error during password change:', dbError.message);
      return res.status(500).json({ error: 'Password change failed' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!requirePasswordChange) {
      const isValidCurrent = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValidCurrent) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);

    delete req.session.requirePasswordChange;

    req.session.save((saveErr) => {
      if (saveErr) {
        logger.error('Session save failed:', saveErr.message);
        return res.status(500).json({ error: 'Password change failed' });
      }

      logger.info(`Password changed for user: ${user.username}`);

      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    });
  } catch (error) {
    logger.error('Error during password change:', error.message);
    res.status(500).json({ error: 'Password change failed' });
  }
});

module.exports = router;
