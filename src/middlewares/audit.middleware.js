const AuditLog = require('../models/auditLog.model');

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'authorization',
  'cookie',
  'mongodb_uri',
  'hash'
];

const sanitizePayload = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizePayload);
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizePayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

const logAudit = (action, domainName) => {
  return async (req, res, next) => {
    const originalJson = res.json;

    res.json = function (body) {
      res.json = originalJson;

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = req.user ? req.user.id : null;
        const username = req.user ? req.user.username : 'PUBLIC';
        const role = req.user ? req.user.role : 'GUEST';

        const details = {
          params: sanitizePayload(req.params),
          query: sanitizePayload(req.query),
          body: sanitizePayload(req.body)
        };

        AuditLog.create({
          action,
          domain: domainName || 'SYSTEM',
          performedBy: userId,
          username,
          role,
          ipAddress: req.ip || req.connection?.remoteAddress,
          details
        }).catch((err) => console.error('[Audit Log Error]:', err.message));
      }

      return res.json.call(this, body);
    };

    next();
  };
};

module.exports = {
  logAudit,
  sanitizePayload
};
