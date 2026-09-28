const ApiError = require('../utils/apiError');

const errorHandler = (err, req, res, next) => {
  let error = err;

  // Handle specific Mongoose and JWT errors
  if (err.name === 'CastError') {
    const message = `Invalid ${err.path}: ${err.value}`;
    error = new ApiError(400, message);
  } else if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new ApiError(400, `Validation Error: ${message}`);
  } else if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];
    const message = `Duplicate value entered for ${field || 'field'}`;
    error = new ApiError(409, message);
  } else if (err.name === 'JsonWebTokenError') {
    error = new ApiError(401, 'Invalid token. Please authenticate again.');
  } else if (err.name === 'TokenExpiredError') {
    error = new ApiError(401, 'Token expired. Please login again.');
  } else if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal Server Error';
    if (process.env.NODE_ENV === 'development') {
      console.error('[Error Middleware Caught]:', err);
    }
    error = new ApiError(statusCode, message, [], err.stack);
  }

  const response = {
    statusCode: error.statusCode,
    success: false,
    ...(error.code && { code: error.code }),
    message: error.message,
    ...(error.data && { data: error.data }),
    errors: error.errors,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  };

  return res.status(error.statusCode).json(response);
};

module.exports = errorHandler;
