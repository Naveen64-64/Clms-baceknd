const express = require('express');
const router = express.Router();
const fineController = require('../controllers/fine.controller');
const { verifyJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const { logAudit } = require('../middlewares/audit.middleware');
const validate = require('../middlewares/validate.middleware');
const { payFineSchema, fineHistoryQuerySchema } = require('../validators/fine.validator');
const { ROLES } = require('../config/constants');

router.get('/student/:rollNumber', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), fineController.getStudentFines);
router.post('/pay', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), validate(payFineSchema), logAudit('PAY_FINE', 'FINES'), fineController.payFine);
router.get('/history', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN, ROLES.STUDENT), validate(fineHistoryQuerySchema, 'query'), fineController.getFineHistory);

module.exports = router;
