const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const facultyService = require('../services/faculty.service');

const registerFaculty = asyncHandler(async (req, res) => {
  const result = await facultyService.registerFaculty(req.body);
  return res.status(201).json(new ApiResponse(201, result, 'Faculty registered successfully'));
});

const getFacultyMe = asyncHandler(async (req, res) => {
  const result = await facultyService.getFacultyProfile(req.user.id);
  return res.status(200).json(new ApiResponse(200, result, 'Faculty profile fetched successfully'));
});

const getFacultyBorrowings = asyncHandler(async (req, res) => {
  const result = await facultyService.getFacultyBorrowings(req.user.id);
  return res.status(200).json(new ApiResponse(200, result, 'Faculty borrowings fetched successfully'));
});

const getFacultyFines = asyncHandler(async (req, res) => {
  const result = await facultyService.getFacultyFines(req.user.id);
  return res.status(200).json(new ApiResponse(200, result, 'Faculty fines fetched successfully'));
});

const getFacultyDetailsForStaff = asyncHandler(async (req, res) => {
  const { facultyId } = req.params;
  const result = await facultyService.getFacultyDetailsForStaff(facultyId, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Faculty details fetched successfully'));
});

module.exports = {
  registerFaculty,
  getFacultyMe,
  getFacultyBorrowings,
  getFacultyFines,
  getFacultyDetailsForStaff
};

