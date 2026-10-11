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

// Public & Gate Kiosk Entry/Exit Check-in toggle using Roll Number or Candidate List
router.post('/gate', optionalJWT, gateLimiter, validate(gateEntryExitSchema), logAudit('GATE_ENTRY_EXIT', 'ENTRY_EXIT'), entryExitController.toggleEntryExit);
router.post('/verify', optionalJWT, gateLimiter, validate(gateEntryExitSchema), logAudit('GATE_ENTRY_EXIT', 'ENTRY_EXIT'), entryExitController.toggleEntryExit);

// Get active visits count and list for library (Entrance Staff, Librarians & Admin, or Gate Kiosks)
router.get('/active', optionalJWT, validate(activeVisitsQuerySchema, 'query'), entryExitController.getActiveVisits);
router.get('/active/:libraryId', optionalJWT, entryExitController.getActiveVisits);

// Get recent entrance activity (last 10 IN/OUT operations)
router.get('/recent', optionalJWT, entryExitController.getRecentVisits);
router.get('/recent/:libraryId', optionalJWT, entryExitController.getRecentVisits);

module.exports = router;
