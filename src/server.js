const dotenv = require('dotenv');
dotenv.config();

const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/db');
const { startScheduler } = require('./services/scheduler.service');

const PORT = process.env.PORT || 5000;

// Connect to Database and start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`[Server] Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    // Initialize background automated reminders scheduler
    startScheduler();
  });
}).catch((err) => {
  console.error('[Server] Failed to start server:', err);
});

const gracefulShutdown = async (signal) => {
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);
  await mongoose.disconnect();
  console.log('[Server] MongoDB disconnected.');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
