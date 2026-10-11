const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const userService = require('../services/user.service');
const studentService = require('../services/student.service');
const facultyService = require('../services/faculty.service');
const User = require('../models/user.model');
const StudentProfile = require('../models/studentProfile.model');
const FacultyProfile = require('../models/facultyProfile.model');
const ApiError = require('../utils/apiError');

const getAllUsers = asyncHandler(async (req, res) => {
  const result = await userService.getAllUsers(req.query);
  return res.status(200).json(new ApiResponse(200, result, 'Users fetched successfully'));
});

const getUserDetailsByIdentifier = asyncHandler(async (req, res) => {
  const { identifier } = req.params;
  const { type, userType } = req.query;

  if (!identifier) {
    throw new ApiError(400, 'User identifier (Roll Number or Faculty ID) is required');
  }

  const cleanId = identifier.trim().toUpperCase();
  const explicitType = (type || userType || '').trim().toUpperCase();

  if (explicitType === 'FACULTY') {
    const faculty = await FacultyProfile.findOne({ facultyId: cleanId });
    if (!faculty) {
      throw new ApiError(404, `Faculty account with Faculty ID ${cleanId} not found`);
    }
    const details = await facultyService.getFacultyDetailsForStaff(cleanId, req.user);
    return res.status(200).json(new ApiResponse(200, details, 'Faculty details fetched successfully'));
  }

  if (explicitType === 'STUDENT') {
    const student = await StudentProfile.findOne({ rollNumber: cleanId });
    if (!student) {
      throw new ApiError(404, `Student library account with Roll Number ${cleanId} not found`);
    }
    const details = await studentService.getStudentDetails(cleanId, req.user);
    return res.status(200).json(new ApiResponse(200, { userType: 'STUDENT', ...details }, 'Student details fetched successfully'));
  }

  // Check User model first to resolve actual user role unambiguously
  const userRecord = await User.findOne({ username: cleanId.toLowerCase() });
  if (userRecord?.role === 'FACULTY') {
    const details = await facultyService.getFacultyDetailsForStaff(cleanId, req.user);
    return res.status(200).json(new ApiResponse(200, details, 'Faculty details fetched successfully'));
  }
  if (userRecord?.role === 'STUDENT') {
    const details = await studentService.getStudentDetails(cleanId, req.user);
    return res.status(200).json(new ApiResponse(200, { userType: 'STUDENT', ...details }, 'Student details fetched successfully'));
  }

  // Fallback: Check FacultyProfile then StudentProfile
  const faculty = await FacultyProfile.findOne({ facultyId: cleanId });
  if (faculty) {
    const details = await facultyService.getFacultyDetailsForStaff(cleanId, req.user);
    return res.status(200).json(new ApiResponse(200, details, 'Faculty details fetched successfully'));
  }

  const student = await StudentProfile.findOne({ rollNumber: cleanId });
  if (student) {
    const details = await studentService.getStudentDetails(cleanId, req.user);
    return res.status(200).json(new ApiResponse(200, { userType: 'STUDENT', ...details }, 'Student details fetched successfully'));
  }

  throw new ApiError(404, `User with ID '${cleanId}' not found`);
});


module.exports = {
  getAllUsers,
  getUserDetailsByIdentifier
};
