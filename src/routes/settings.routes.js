const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { verifyJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const { logAudit } = require('../middlewares/audit.middleware');
const validate = require('../middlewares/validate.middleware');
const { updateSettingsSchema } = require('../validators/admin.validator');
const { ROLES } = require('../config/constants');

// GET settings: Available to all authenticated roles (Student, Librarian, Faculty, Admin)
router.get('/', verifyJWT, adminController.getSettings);

// PUT settings: Strictly restricted to ADMIN role
router.put(
  '/',
  verifyJWT,
  authorizeRoles(ROLES.ADMIN),
  validate(updateSettingsSchema),
  logAudit('UPDATE_ADMIN_SETTINGS', 'ADMIN'),
  adminController.updateSettings
);

module.exports = router;
