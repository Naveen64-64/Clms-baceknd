const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const AuditLog = require('../models/auditLog.model');

const getAuditLogs = asyncHandler(async (req, res) => {
  const { action, domain, username, startDate, endDate } = req.query;
  const filter = {};

  if (action) filter.action = action;
  if (domain) filter.domain = domain;
  if (username) filter.username = { $regex: username, $options: 'i' };

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(200);
  return res.status(200).json(new ApiResponse(200, logs, 'Audit logs retrieved successfully'));
});

module.exports = {
  getAuditLogs
};
