const express = require('express');
const router = express.Router();
const tcClearanceController = require('../controllers/tcClearance.controller');
const { verifyJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const { logAudit } = require('../middlewares/audit.middleware');
const validate = require('../middlewares/validate.middleware');
const { createTcRequestSchema, rejectTcRequestSchema } = require('../validators/tcClearance.validator');
const { ROLES } = require('../config/constants');

// Student endpoints
router.post(
  '/request',
  verifyJWT,
  authorizeRoles(ROLES.STUDENT),
  validate(createTcRequestSchema),
  logAudit('TC_CLEARANCE_SUBMIT_REQUEST', 'STUDENTS'),
  tcClearanceController.createRequest
);

router.get(
  '/my-request',
  verifyJWT,
  authorizeRoles(ROLES.STUDENT),
  tcClearanceController.getMyRequest
);

// Librarian endpoints
router.get(
  '/requests',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN),
  tcClearanceController.getRequestsForLibrarian
);

router.get(
  '/requests/:id',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN, ROLES.STUDENT),
  tcClearanceController.getRequestDetails
);

router.patch(
  '/requests/:id/approve',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN),
  logAudit('TC_CLEARANCE_APPROVE', 'STUDENTS'),
  tcClearanceController.approveRequest
);

router.patch(
  '/requests/:id/reject',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN),
  validate(rejectTcRequestSchema),
  logAudit('TC_CLEARANCE_REJECT', 'STUDENTS'),
  tcClearanceController.rejectRequest
);

module.exports = router;
