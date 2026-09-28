const LibrarianProfile = require('../models/librarianProfile.model');
const { ROLES } = require('../config/constants');
const ApiError = require('./apiError');

/**
 * Extracts and validates the librarian profile for a calling user.
 * Throws an error if the user is a librarian but lacks an assigned library.
 * @param {Object|String} callingUser - The user object or ID
 * @returns {Promise<Object|null>} The librarian profile or null if not a librarian
 */
const getMandatoryLibrarianProfile = async (callingUser) => {
  if (!callingUser) return null;
  const userRole = callingUser.role;
  const userId = callingUser.id || callingUser._id || callingUser;
  if (userRole === ROLES.LIBRARIAN) {
    const profile = await LibrarianProfile.findOne({ user: userId });
    if (!profile || !profile.assignedLibrary) {
      throw new ApiError(403, 'Access denied: Mandatory librarian profile or assigned library missing');
    }
    return profile;
  }
  return null;
};

module.exports = {
  getMandatoryLibrarianProfile
};
