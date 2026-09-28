const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const errorHandler = require('./middlewares/error.middleware');
const ApiResponse = require('./utils/apiResponse');

const app = express();

// Security HTTP headers
app.use(helmet());

// Enable CORS with support for credentials and frontend origins
// Development: allow ALL origins (no CORS issues across machines/ports)
// Production: restrict to explicit CORS_ORIGINS whitelist
const corsOptions = process.env.NODE_ENV === 'production'
  ? {
      origin: function (origin, callback) {
        const allowed = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
        if (!origin || allowed.includes(origin)) return callback(null, true);
        return callback(new Error('CORS: Origin not allowed'));
      },
      credentials: true
    }
  : { origin: true, credentials: true };

app.use(cors(corsOptions));

// HTTP request logger
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Body parsers
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));

// const mongoSanitize = require('express-mongo-sanitize');
// app.use(mongoSanitize());

const mongoose = require('mongoose');

// Health Check Endpoint (Rule 48)
app.get('/health', (req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;
  const status = isDbConnected ? 'UP' : 'DOWN';
  const statusCode = isDbConnected ? 200 : 503;

  return res.status(statusCode).json(
    new ApiResponse(
      statusCode,
      {
        status,
        dbConnected: isDbConnected,
        timestamp: new Date()
      },
      isDbConnected ? 'Library Management Backend is healthy' : 'Database disconnected'
    )
  );
});

const apiRoutes = require('./routes');

// Root API Endpoint
app.get('/api/v1', (req, res) => {
  res.status(200).json(new ApiResponse(200, { version: '1.0.0' }, 'Welcome to College Library Management System API'));
});

// SSE endpoint mounted directly to avoid standard rate limiters / middleware conflicts if needed
const sseRoutes = require('./routes/sse.routes');
app.use('/api/v1/libraries', sseRoutes);

// Mount Main API Routes
app.use('/api/v1', apiRoutes);

// Global Error Handler
app.use(errorHandler);

module.exports = app;
