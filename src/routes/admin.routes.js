const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { verifyJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const { logAudit } = require('../middlewares/audit.middleware');
const validate = require('../middlewares/validate.middleware');
const {
  createLibrarianSchema,
  updateLibrarianSchema,
  toggleLibrarianStatusSchema,
  resetLibrarianPasswordSchema,
  updateSettingsSchema
} = require('../validators/admin.validator');
const { ROLES } = require('../config/constants');

// All Admin routes require ADMIN role
router.use(verifyJWT, authorizeRoles(ROLES.ADMIN));

router.post(
  '/librarians',
  validate(createLibrarianSchema),
  logAudit('CREATE_LIBRARIAN', 'ADMIN'),
  adminController.createLibrarian
);
router.get('/librarians', adminController.getAllLibrarians);
router.get('/librarians/:librarianId', adminController.getLibrarianById);
router.put(
  '/librarians/:librarianId',
  validate(updateLibrarianSchema),
  logAudit('UPDATE_LIBRARIAN', 'ADMIN'),
  adminController.updateLibrarian
);
router.patch(
  '/librarians/:librarianId/status',
  validate(toggleLibrarianStatusSchema),
  logAudit('TOGGLE_LIBRARIAN_STATUS', 'ADMIN'),
  adminController.toggleLibrarianStatus
);
router.post(
  '/librarians/:librarianId/reset-password',
  validate(resetLibrarianPasswordSchema),
  logAudit('RESET_LIBRARIAN_PASSWORD', 'ADMIN'),
  adminController.resetLibrarianPassword
);

router.get('/settings', adminController.getSettings);
router.put(
  '/settings',
  validate(updateSettingsSchema),
  logAudit('UPDATE_ADMIN_SETTINGS', 'ADMIN'),
  adminController.updateSettings
);

module.exports = router;
