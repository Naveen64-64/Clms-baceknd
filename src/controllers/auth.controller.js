const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const authService = require('../services/auth.service');

const login = asyncHandler(async (req, res) => {
  const { username, email, rollNumber, password } = req.body;
  const loginId = email || username || rollNumber;

  if (!loginId || !password) {
    return res.status(400).json(new ApiResponse(400, null, 'Email / Roll Number and Password are required'));
  }

  const result = await authService.loginUser(loginId, password);
  return res.status(200).json(new ApiResponse(200, result, 'Login successful'));
});

const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;
  const result = await authService.refreshTokens(token);
  return res.status(200).json(new ApiResponse(200, result, 'Token refreshed successfully'));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res.status(200).json(new ApiResponse(200, req.user, 'Current user profile fetched successfully'));
});

const logout = asyncHandler(async (req, res) => {
  await authService.logoutUser(req.user.id);
  return res.status(200).json(new ApiResponse(200, null, 'Logged out successfully'));
});

const changePassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  await authService.changePassword(req.user.id, oldPassword, newPassword);
  return res.status(200).json(new ApiResponse(200, null, 'Password changed successfully'));
});

module.exports = {
  login,
  refreshToken,
  getCurrentUser,
  logout,
  changePassword
};
