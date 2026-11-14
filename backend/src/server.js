const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const transactionsRoutes = require('./routes/transactionsRoutes');
const budgetsRoutes = require('./routes/budgetsRoutes');
const aiRoutes = require('./routes/aiRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON body parser.
// On Vercel the browser talks to this API on the same origin through the
// /api/(.*) rewrite, so CORS is only needed for split-origin local setups.
app.use(cors());
app.use(express.json());

// Trust the proxy so request IPs and protocol reflect Vercel's edge.
app.set('trust proxy', true);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Mount API routes
app.use('/api/transactions', transactionsRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/ai', aiRoutes);

// 404 handler for unknown API routes
app.use('/api', notFoundHandler);

// Serve frontend static files.
// Vercel ignores express.static() and serves the frontend from the separate
// "app" service, so this block only runs in local/single-process setups.
const frontendDir = path.resolve(__dirname, '../../');
const frontendIndex = path.join(frontendDir, 'index.html');
const hasLocalFrontend = fs.existsSync(frontendIndex);

if (hasLocalFrontend) {
  app.use(express.static(frontendDir));
}

// Fallback for frontend client routing (non-API routes).
// On Vercel the app service owns every non-API path; if a request still lands
// here we hand it back to that service over the internal service binding.
app.use((req, res, next) => {
  const appServiceUrl = process.env.APP_SERVICE_URL;

  if (appServiceUrl) {
    const target = new URL(req.originalUrl || req.url || '/', appServiceUrl);
    return res.redirect(302, target.toString());
  }

  if (hasLocalFrontend) {
    return res.sendFile(frontendIndex);
  }

  return res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Central error handler
app.use(errorHandler);

// Start server if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Expense Tracker server running on port ${PORT}`);
    console.log(`App URL: http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });
}

module.exports = app;
