const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../../config');

const WEAK_SECRETS = ['dev_secret_change_in_production', 'test_secret', 'dev_secret', 'default_secret', 'secret'];

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  // Reject missing or weak/default JWT secrets in production environments
  if (!jwtSecret || (process.env.NODE_ENV === 'production' && WEAK_SECRETS.includes(jwtSecret.toLowerCase().trim())) || jwtSecret === 'dev_secret_change_in_production') {
    console.error('[Security] JWT_SECRET is weak or not properly configured.');
    return res.status(500).json({ error: 'Internal server configuration error' });
  }

  jwt.verify(token, jwtSecret, (err, user) => {
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
