/**
 * Request Logger Middleware
 * 
 * Middleware untuk logging setiap request ke server
 */

const logger = require('../utils/logger');

/**
 * Request logging middleware
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();
  const method = req.method;
  const path = req.path;
  const ip = req.ip || req.connection.remoteAddress;

  // Log incoming request
  logger.debug(`← [${method}] ${path}`, {
    ip: ip,
    userAgent: req.get('user-agent')?.substring(0, 50)
  });

  // Track response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    
    // Choose log level based on status code
    if (statusCode >= 500) {
      logger.error(`→ [${method}] ${path} - ${statusCode} (${duration}ms)`);
    } else if (statusCode >= 400) {
      logger.warn(`→ [${method}] ${path} - ${statusCode} (${duration}ms)`);
    } else {
      logger.info(`→ [${method}] ${path} - ${statusCode} (${duration}ms)`);
    }
  });

  next();
}

module.exports = requestLogger;
