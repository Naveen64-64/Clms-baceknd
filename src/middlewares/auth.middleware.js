const jwt = require('jsonwebtoken');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/user.model');
const StudentProfile = require('../models/studentProfile.model');
const FacultyProfile = require('../models/facultyProfile.model');
const LibrarianProfile = require('../models/librarianProfile.model');

const populateUserData = async (user) => {
  const userData = {
    id: user._id,
    username: user.username,
    email: user.username,
    role: user.role
  };

  if (user.role === 'STUDENT') {
    const studentProfile = await StudentProfile.findOne({ user: user._id });
    if (studentProfile) {
      userData.studentProfile = studentProfile;
      userData.gender = studentProfile.gender;
      userData.rollNumber = studentProfile.rollNumber;
      userData.email = studentProfile.email || user.username;
    }
  } else if (user.role === 'FACULTY') {
    const facultyProfile = await FacultyProfile.findOne({ user: user._id });
    if (facultyProfile) {
      userData.facultyProfile = facultyProfile;
      userData.facultyId = facultyProfile.facultyId;
      userData.name = facultyProfile.name;
      userData.email = facultyProfile.email || user.username;
    }
  } else if (user.role === 'LIBRARIAN') {
    const librarianProfile = await LibrarianProfile.findOne({ user: user._id }).populate('assignedLibrary');
    if (librarianProfile) {
      userData.librarianProfile = librarianProfile;
      userData.assignedLibraryId = librarianProfile.assignedLibrary?._id;
    }
  }

  return userData;
};

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set');
}

const verifyJWT = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'Unauthorized request: Missing or malformed token');
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      throw new ApiError(401, 'Unauthorized request: User no longer exists or is inactive');
    }

    req.user = await populateUserData(user);
    next();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, error.message || 'Invalid or expired token');
  }
});

const optionalJWT = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // No Authorization header -> Proceed as unauthenticated OPEN_USER
  if (!authHeader) {
    return next();
  }

  // Authorization header present -> MUST be valid (Section 36 Security Rule)
  if (!authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'Invalid authentication header format');
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      throw new ApiError(401, 'Unauthorized request: User no longer exists or is inactive');
    }

    req.user = await populateUserData(user);
    next();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'Invalid or expired token provided in Authorization header');
  }
});

module.exports = {
  verifyJWT,
  optionalJWT
};
