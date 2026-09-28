const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const Library = require('../models/library.model');
const { ROLES, GENDERS } = require('../config/constants');

const mongoose = require('mongoose');

const checkLibraryAccess = asyncHandler(async (req, res, next) => {
  let libraryId = req.params?.libraryId || req.body?.libraryId || req.query?.libraryId;

  // For LIBRARIAN: If libraryId not explicitly supplied, fallback to librarian assigned library
  if (!libraryId && req.user && req.user.role === ROLES.LIBRARIAN) {
    libraryId = req.user.assignedLibraryId?.toString() || req.user.librarianProfile?.assignedLibrary?._id?.toString() || req.user.librarianProfile?.assignedLibrary?.code;
  }

  if (!libraryId) {
    throw new ApiError(400, 'Library ID is required to evaluate access permissions');
  }

  let library = await Library.findOne({ code: libraryId });
  if (!library && mongoose.Types.ObjectId.isValid(libraryId)) {
    library = await Library.findById(libraryId);
  }

  if (!library) {
    throw new ApiError(400, 'Invalid library');
  }

  req.targetLibrary = library;

  // 1. ADMIN and LIBRARY_ENTRANCE have access to operate at all libraries
  if (req.user && (req.user.role === ROLES.ADMIN || req.user.role === ROLES.LIBRARY_ENTRANCE)) {
    return next();
  }

  // 2. LIBRARIAN has access ONLY to their assigned library (Rule 8 & 9)
  if (req.user && req.user.role === ROLES.LIBRARIAN) {
    const librarianAssignedId = req.user.assignedLibraryId?.toString() || req.user.librarianProfile?.assignedLibrary?._id?.toString() || req.user.librarianProfile?.assignedLibrary?.toString();
    if (!librarianAssignedId || librarianAssignedId !== library._id.toString()) {
      throw new ApiError(403, `Access denied: Librarians are strictly restricted to their assigned library (${req.user.librarianProfile?.assignedLibrary?.name || 'Assigned Library'})`);
    }
    return next();
  }

  // 3. STUDENT access rules (Rules 11, 12, 13, 14)
  if (req.user && req.user.role === ROLES.STUDENT) {
    const isMale = req.user.gender === GENDERS.MALE;
    if (isMale && (library.isWomenOnly || library.code === 'KIET_WOMEN' || library.name.includes("Women"))) {
      throw new ApiError(403, "Access denied: Male students are strictly prohibited from accessing KIET Women's Library");
    }
    return next();
  }

  // 4. OPEN_USER (Unauthenticated or guest) access rules for public view
  if (!req.user) {
    // Open users can view library seat availability, but not perform restricted actions
    return next();
  }

  next();
});

module.exports = {
  checkLibraryAccess
};
