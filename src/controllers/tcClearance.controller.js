const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const tcClearanceService = require('../services/tcClearance.service');

const createRequest = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const tcRequest = await tcClearanceService.createRequest(userId, req.body);
  return res.status(201).json(new ApiResponse(201, tcRequest, 'No Due / TC Clearance request submitted successfully'));
});

const getMyRequest = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const data = await tcClearanceService.getMyRequest(userId);
  return res.status(200).json(new ApiResponse(200, data, 'My TC Clearance request fetched successfully'));
});

const getRequestsForLibrarian = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const data = await tcClearanceService.getRequestsForLibrarian(userId, req.query);
  return res.status(200).json(new ApiResponse(200, data, 'TC Clearance requests queue fetched successfully'));
});

const getRequestDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const data = await tcClearanceService.getRequestDetails(id, req.user);
  return res.status(200).json(new ApiResponse(200, data, 'TC Clearance request details fetched successfully'));
});

const approveRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id || req.user.id;
  const updatedRequest = await tcClearanceService.approveRequest(id, userId);
  return res.status(200).json(new ApiResponse(200, updatedRequest, 'TC Clearance request approved successfully'));
});

const rejectRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id || req.user.id;
  const { rejectionReason } = req.body;
  const updatedRequest = await tcClearanceService.rejectRequest(id, userId, rejectionReason);
  return res.status(200).json(new ApiResponse(200, updatedRequest, 'TC Clearance request rejected'));
});

module.exports = {
  createRequest,
  getMyRequest,
  getRequestsForLibrarian,
  getRequestDetails,
  approveRequest,
  rejectRequest
};
