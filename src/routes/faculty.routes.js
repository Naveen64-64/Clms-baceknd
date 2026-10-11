const express = require('express');
const router = express.Router();
const facultyController = require('../controllers/faculty.controller');
const { verifyJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const validate = require('../middlewares/validate.middleware');
const { registerFacultySchema } = require('../validators/faculty.validator');
const { ROLES } = require('../config/constants');

// Librarian or Admin can register faculty
router.post(
  '/register',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN),
  validate(registerFacultySchema),
  facultyController.registerFaculty
);

// Faculty portal endpoints
router.get(
  '/me',
  verifyJWT,
  authorizeRoles(ROLES.FACULTY),
  facultyController.getFacultyMe
);

router.get(
  '/borrowings',
  verifyJWT,
  authorizeRoles(ROLES.FACULTY),
  facultyController.getFacultyBorrowings
);

router.get(
  '/fines',
  verifyJWT,
  authorizeRoles(ROLES.FACULTY),
  facultyController.getFacultyFines
);

// Staff endpoints for Librarian and Admin to view faculty details
router.get(
  '/details/:facultyId',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN),
  facultyController.getFacultyDetailsForStaff
);

router.get(
  '/:facultyId',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN),
  facultyController.getFacultyDetailsForStaff
);

module.exports = router;

