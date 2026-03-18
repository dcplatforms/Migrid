const express = require('express');
const app = express();
const port = process.env.PORT || 3011;

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ml-engine',
    version: '0.1.0',
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`L11 ML Engine listening at http://localhost:${port}`);
});
