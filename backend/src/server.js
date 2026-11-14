const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const transactionsRoutes = require('./routes/transactionsRoutes');
const budgetsRoutes = require('./routes/budgetsRoutes');
const aiRoutes = require('./routes/aiRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json());

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

// Serve frontend static files
const frontendDir = path.resolve(__dirname, '../../');
app.use(express.static(frontendDir));

// Fallback for frontend client routing (non-API routes)
app.use((req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
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
