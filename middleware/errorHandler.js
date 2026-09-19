/**
 * Error Handling Middleware
 * 
 * Centralized error handling untuk Express
 */

const logger = require('../utils/logger');

/**
 * Custom Error Class
 */
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Error handler middleware
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  const details = err.details || null;

  // Log error
  if (statusCode >= 500) {
    logger.error(`[${req.method} ${req.path}] ${message}`, err);
  } else {
    logger.warn(`[${req.method} ${req.path}] ${message}`);
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: {
      message: message,
      statusCode: statusCode,
      timestamp: new Date().toISOString(),
      ...(details && { details })
    }
  });
}

/**
 * Async route wrapper untuk handle promise rejections
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Not Found handler
 */
function notFoundHandler(req, res, next) {
  const error = new ApiError(404, `Route tidak ditemukan: ${req.method} ${req.path}`);
  next(error);
}

/**
 * Validation error handler
 */
function validationErrorHandler(errors) {
  const message = errors.map(err => err.msg).join(', ');
  return new ApiError(400, 'Validation Error', { errors });
}

module.exports = {
  ApiError,
  errorHandler,
  asyncHandler,
  notFoundHandler,
  validationErrorHandler
};
