const express = require('express');
const router = express.Router();
const libraryController = require('../controllers/library.controller');
const { verifyJWT, optionalJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const { checkLibraryAccess } = require('../middlewares/libraryAccess.middleware');
const { logAudit } = require('../middlewares/audit.middleware');
const validate = require('../middlewares/validate.middleware');
const { createLibrarySchema, updateLibrarySchema } = require('../validators/library.validator');
const { ROLES } = require('../config/constants');

// Public routes: View library status & seat availability
router.get('/', optionalJWT, libraryController.getAllLibrariesStatus);
router.get('/status', optionalJWT, libraryController.getAllLibrariesStatus);
router.get('/occupancy-stream', libraryController.streamOccupancyUpdates);
router.get('/:libraryId/status', optionalJWT, checkLibraryAccess, libraryController.getLibrarySeatStatus);

// Admin routes: Create & Update library
router.post(
  '/',
  verifyJWT,
  authorizeRoles(ROLES.ADMIN),
  validate(createLibrarySchema),
  logAudit('CREATE_LIBRARY', 'LIBRARIES'),
  libraryController.createLibrary
);
router.put(
  '/:libraryId',
  verifyJWT,
  authorizeRoles(ROLES.ADMIN),
  validate(updateLibrarySchema),
  logAudit('UPDATE_LIBRARY', 'LIBRARIES'),
  libraryController.updateLibrary
);

module.exports = router;
