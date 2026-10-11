const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const adminService = require('../services/admin.service');

const createLibrarian = asyncHandler(async (req, res) => {
  const { name, email, password, assignedLibraryId } = req.body;
  if (!name || !email || !password || !assignedLibraryId) {
    return res.status(400).json(new ApiResponse(400, null, 'Name, email, password, and assignedLibraryId are required'));
  }

  const librarian = await adminService.createLibrarian(req.body);
  return res.status(201).json(new ApiResponse(201, librarian, 'Librarian account created successfully'));
});

const getAllLibrarians = asyncHandler(async (req, res) => {
  const librarians = await adminService.getAllLibrarians();
  return res.status(200).json(new ApiResponse(200, librarians, 'Librarians retrieved successfully'));
});

const getLibrarianById = asyncHandler(async (req, res) => {
  const { librarianId } = req.params;
  const librarian = await adminService.getLibrarianById(librarianId);
  return res.status(200).json(new ApiResponse(200, librarian, 'Librarian details retrieved successfully'));
});

const updateLibrarian = asyncHandler(async (req, res) => {
  const { librarianId } = req.params;
  const librarian = await adminService.updateLibrarian(librarianId, req.body);
  return res.status(200).json(new ApiResponse(200, librarian, 'Librarian profile updated successfully'));
});

const toggleLibrarianStatus = asyncHandler(async (req, res) => {
  const { librarianId } = req.params;
  const { isActive } = req.body;
  const result = await adminService.toggleLibrarianStatus(librarianId, isActive);
  return res.status(200).json(new ApiResponse(200, result, `Librarian account ${isActive ? 'activated' : 'deactivated'} successfully`));
});

const resetLibrarianPassword = asyncHandler(async (req, res) => {
  const { librarianId } = req.params;
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json(new ApiResponse(400, null, 'New password with minimum 6 characters is required'));
  }
  const result = await adminService.resetLibrarianPassword(librarianId, newPassword);
  return res.status(200).json(new ApiResponse(200, result, 'Librarian password reset successfully'));
});

const getSettings = asyncHandler(async (req, res) => {
  const settings = await adminService.getAdminSettings();
  return res.status(200).json(new ApiResponse(200, settings, 'Admin settings retrieved successfully'));
});

const updateSettings = asyncHandler(async (req, res) => {
  const settings = await adminService.updateAdminSettings(req.body, req.user.id);
  return res.status(200).json(new ApiResponse(200, settings, 'Admin settings updated successfully'));
});

module.exports = {
  createLibrarian,
  getAllLibrarians,
  getLibrarianById,
  updateLibrarian,
  toggleLibrarianStatus,
  resetLibrarianPassword,
  getSettings,
  updateSettings
};
