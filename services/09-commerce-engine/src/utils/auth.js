const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../../config');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  if (!jwtSecret || jwtSecret === 'dev_secret_change_in_production') {
    console.error('[Security] JWT_SECRET is not properly configured.');
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
