const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { verifyJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../config/constants');

// Unified User Directory for Librarians and Admins
router.get(
  '/',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN),
  userController.getAllUsers
);

// Dynamic User Details for Librarians and Admins (resolves Student or Faculty by ID)
router.get(
  '/details/:identifier',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN),
  userController.getUserDetailsByIdentifier
);

module.exports = router;
