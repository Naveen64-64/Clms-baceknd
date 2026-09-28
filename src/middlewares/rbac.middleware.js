const ApiError = require('../utils/apiError');

const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ApiError(403, `Access denied: Role '${req.user.role}' is not authorized to perform this action`);
    }

    next();
  };
};

module.exports = {
  authorizeRoles
};
