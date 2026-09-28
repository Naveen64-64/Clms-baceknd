const express = require('express');
const router = express.Router();
const auditController = require('../controllers/audit.controller');
const { verifyJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../config/constants');

// Audit logs view (ADMIN only) (Rule 35)
router.get('/', verifyJWT, authorizeRoles(ROLES.ADMIN), auditController.getAuditLogs);

module.exports = router;
