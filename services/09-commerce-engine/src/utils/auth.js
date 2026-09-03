const jwt = require('jsonwebtoken');
const config = require('../../config');

const WEAK_SECRETS = ['dev_secret_change_in_production', 'test_secret', 'dev_secret', 'default_secret', 'secret'];

const isWeakSecret = (secret) => {
  if (!secret) return true;
  return WEAK_SECRETS.includes(secret.toLowerCase().trim());
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const activeSecret = process.env.JWT_SECRET || config.jwtSecret;

  if (!activeSecret) {
    console.error('[Security] JWT_SECRET is not properly configured.');
    return res.status(500).json({ error: 'Internal server configuration error' });
  }

  // [Security Hardening] Reject weak secrets in production environment
  if (process.env.NODE_ENV === 'production' && isWeakSecret(activeSecret)) {
    console.error('[Security] JWT_SECRET is weak, insecure, or default. Blocking authenticated endpoint access in production.');
    return res.status(500).json({ error: 'Internal server configuration error' });
  }

  jwt.verify(token, activeSecret, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

module.exports = {
  authenticateToken,
};
