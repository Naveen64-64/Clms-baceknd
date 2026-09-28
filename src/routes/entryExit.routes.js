const express = require('express');
const router = express.Router();
const entryExitController = require('../controllers/entryExit.controller');
const { verifyJWT, optionalJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const { checkLibraryAccess } = require('../middlewares/libraryAccess.middleware');
const { logAudit } = require('../middlewares/audit.middleware');
const validate = require('../middlewares/validate.middleware');
const { gateEntryExitSchema, activeVisitsQuerySchema } = require('../validators/entryExit.validator');
const { gateLimiter } = require('../middlewares/rateLimiter.middleware');
const { ROLES } = require('../config/constants');

// Public & Gate Kiosk Entry/Exit Check-in toggle using Roll Number
router.post('/gate', optionalJWT, gateLimiter, validate(gateEntryExitSchema), logAudit('GATE_ENTRY_EXIT', 'ENTRY_EXIT'), entryExitController.toggleEntryExit);

// Get active visits count and list for library (Entrance Staff, Librarians & Admin)
router.get('/active', verifyJWT, authorizeRoles(ROLES.LIBRARY_ENTRANCE, ROLES.LIBRARIAN, ROLES.ADMIN), validate(activeVisitsQuerySchema, 'query'), checkLibraryAccess, entryExitController.getActiveVisits);
router.get('/active/:libraryId', verifyJWT, authorizeRoles(ROLES.LIBRARY_ENTRANCE, ROLES.LIBRARIAN, ROLES.ADMIN), checkLibraryAccess, entryExitController.getActiveVisits);

// Get recent entrance activity (last 10 IN/OUT operations)
router.get('/recent', verifyJWT, authorizeRoles(ROLES.LIBRARY_ENTRANCE, ROLES.LIBRARIAN, ROLES.ADMIN), entryExitController.getRecentVisits);
router.get('/recent/:libraryId', verifyJWT, authorizeRoles(ROLES.LIBRARY_ENTRANCE, ROLES.LIBRARIAN, ROLES.ADMIN), entryExitController.getRecentVisits);

module.exports = router;
