const rateLimit = require('express-rate-limit');
const ApiResponse = require('../utils/apiResponse');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 auth requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.status(429).json(
      new ApiResponse(429, null, 'Too many authentication attempts from this IP. Please try again after 15 minutes.')
    );
  }
});

const gateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 gate entry/exit requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.status(429).json(
      new ApiResponse(429, null, 'Too many gate check-in/out requests. Please slow down.')
    );
  }
});

const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 chat requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.status(429).json(
      new ApiResponse(429, null, 'Too many chat requests. Please wait a moment before sending another message.')
    );
  }
});

module.exports = {
  authLimiter,
  gateLimiter,
  chatLimiter
};

