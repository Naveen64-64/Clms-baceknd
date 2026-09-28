const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const fineService = require('../services/fine.service');

const getStudentFines = asyncHandler(async (req, res) => {
  const rollNumber = req.params.rollNumber;
  const result = await fineService.getStudentFinesByRollNumber(rollNumber, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Student fine details retrieved successfully'));
});

const payFine = asyncHandler(async (req, res) => {
  const result = await fineService.payFine(req.body, req.user);
  const message = result.isFullyCleared ? 'Fine cleared successfully' : 'Partial fine payment recorded successfully';
  return res.status(200).json(new ApiResponse(200, result, message));
});

const getFineHistory = asyncHandler(async (req, res) => {
  const history = await fineService.getFineHistory(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, history, 'Fine payment history retrieved successfully'));
});

module.exports = {
  getStudentFines,
  payFine,
  getFineHistory
};
