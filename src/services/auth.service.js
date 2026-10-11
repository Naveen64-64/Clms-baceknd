const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/user.model');
const StudentProfile = require('../models/studentProfile.model');
const FacultyProfile = require('../models/facultyProfile.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const { comparePassword } = require('../utils/password');
const ApiError = require('../utils/apiError');

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;

if (!JWT_SECRET || !REFRESH_TOKEN_SECRET) {
  console.error('\n❌ FATAL: JWT_SECRET and REFRESH_TOKEN_SECRET must be set in server/.env');
  console.error('   Fix: Copy the example env file:');
  console.error('   cp .env.example .env  (Linux/Mac)');
  console.error('   copy .env.example .env  (Windows)\n');
  process.exit(1);
}

const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  const refreshToken = jwt.sign(
    { id: user._id, nonce: crypto.randomBytes(16).toString('hex') },
    REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d' }
  );

  return { accessToken, refreshToken };
};

const loginUser = async (loginIdentifier, password) => {
  if (!loginIdentifier || !password) {
    throw new ApiError(400, 'Faculty ID / Roll Number / Email and Password are required');
  }

  const rawId = loginIdentifier.trim();
  const formattedId = rawId.toLowerCase();
  
  // Search by User username (lowercased roll number for students, lowercased faculty ID for faculty, or email for staff)
  let user = await User.findOne({ username: formattedId }).select('+password +refreshToken');

  if (!user) {
    // Search StudentProfile by rollNumber (uppercase) or email (lowercase)
    const student = await StudentProfile.findOne({
      $or: [
        { rollNumber: rawId.toUpperCase() },
        { email: formattedId }
      ]
    });
    if (student) {
      user = await User.findById(student.user).select('+password +refreshToken');
    }
  }

  if (!user) {
    // Search FacultyProfile by facultyId (uppercase) or email (lowercase)
    const faculty = await FacultyProfile.findOne({
      $or: [
        { facultyId: rawId.toUpperCase() },
        { email: formattedId }
      ]
    });
    if (faculty) {
      user = await User.findById(faculty.user).select('+password +refreshToken');
    }
  }

  if (!user) {
    throw new ApiError(401, 'Invalid login credentials or password');
  }

  if (!user.isActive) {
    throw new ApiError(403, 'Account is deactivated. Contact Admin');
  }

  let isPasswordValid = await comparePassword(password, user.password);

  // Student password case-insensitivity: if initial match fails, try lowercase and uppercase variants
  if (!isPasswordValid && user.role === 'STUDENT') {
    const lowerPwd = password.toLowerCase();
    if (lowerPwd !== password) {
      isPasswordValid = await comparePassword(lowerPwd, user.password);
    }
    if (!isPasswordValid) {
      const upperPwd = password.toUpperCase();
      if (upperPwd !== password && upperPwd !== lowerPwd) {
        isPasswordValid = await comparePassword(upperPwd, user.password);
      }
    }
  }

  if (!isPasswordValid) {
    throw new ApiError(401, 'Invalid login credentials or password');
  }

  const { accessToken, refreshToken } = generateTokens(user);
  user.refreshToken = refreshToken;
  await user.save();

  let profile = null;
  if (user.role === 'STUDENT') {
    profile = await StudentProfile.findOne({ user: user._id });
  } else if (user.role === 'FACULTY') {
    profile = await FacultyProfile.findOne({ user: user._id });
  } else if (user.role === 'LIBRARIAN') {
    profile = await LibrarianProfile.findOne({ user: user._id }).populate('assignedLibrary');
  }

  return {
    user: {
      id: user._id,
      username: user.username,
      email: user.role === 'STUDENT' || user.role === 'FACULTY' ? profile?.email || user.username : user.username,
      role: user.role,
      studentProfile: user.role === 'STUDENT' ? profile : undefined,
      facultyProfile: user.role === 'FACULTY' ? profile : undefined,
      librarianProfile: user.role === 'LIBRARIAN' ? profile : undefined,
      assignedLibraryId: user.role === 'LIBRARIAN' ? profile?.assignedLibrary?._id : undefined
    },
    profile,
    accessToken,
    refreshToken
  };
};

const refreshTokens = async (incomingRefreshToken) => {
  if (!incomingRefreshToken) {
    throw new ApiError(401, 'Refresh token is required');
  }

  try {
    const decoded = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET
    );

    const user = await User.findById(decoded.id).select('+refreshToken');

    if (!user || !user.isActive) {
      throw new ApiError(401, 'Invalid user or account is inactive');
    }

    // Refresh Token Rotation Reuse Detection:
    // If incoming refresh token does not match active DB token, revoke token series!
    if (user.refreshToken !== incomingRefreshToken) {
      user.refreshToken = null;
      await user.save();
      throw new ApiError(401, 'Revoked or reused refresh token. All active sessions invalidated for security.');
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
    user.refreshToken = newRefreshToken;
    await user.save();

    return { accessToken, refreshToken: newRefreshToken };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, 'Invalid or expired refresh token');
  }
};

const logoutUser = async (userId) => {
  await User.findByIdAndUpdate(userId, { refreshToken: null });
  return { message: 'Logged out successfully' };
};

const changePassword = async (userId, oldPassword, newPassword) => {
  const user = await User.findById(userId).select('+password');
  if (!user) throw new ApiError(404, 'User not found');

  const isPasswordValid = await comparePassword(oldPassword, user.password);
  if (!isPasswordValid) throw new ApiError(400, 'Incorrect old password');

  const { hashPassword } = require('../utils/password');
  user.password = await hashPassword(newPassword);
  
  // Optionally invalidate refresh tokens so user has to login again on other devices
  user.refreshToken = null; 
  await user.save();
  return true;
};

module.exports = {
  loginUser,
  refreshTokens,
  logoutUser,
  changePassword
};
