const express = require('express');
const router = express.Router();
const studentController = require('../controllers/student.controller');
const { verifyJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const { logAudit } = require('../middlewares/audit.middleware');
const validate = require('../middlewares/validate.middleware');
const upload = require('../middlewares/upload.middleware');
const { registerStudentSchema, studentQuerySchema, bulkRegisterStudentSchema } = require('../validators/student.validator');
const { ROLES } = require('../config/constants');

// Register student: ONLY Librarians can register students
router.post(
  '/register',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN),
  validate(registerStudentSchema),
  logAudit('REGISTER_STUDENT', 'STUDENTS'),
  studentController.registerStudent
);

// Bulk import students (JSON array)
router.post(
  '/import',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN),
  validate(bulkRegisterStudentSchema),
  logAudit('BULK_IMPORT_STUDENTS', 'STUDENTS'),
  studentController.bulkImportStudents
);

// Bulk import students from file (.xlsx, .xls, .csv)
router.post(
  '/import-file',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN),
  upload.single('file'),
  logAudit('BULK_IMPORT_STUDENTS_FILE', 'STUDENTS'),
  studentController.bulkImportFromFile
);

// Get all students: Librarians & Admin
router.get(
  '/',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN),
  validate(studentQuerySchema, 'query'),
  studentController.getAllStudents
);

// Get student profile (Student can view own profile; Librarian & Admin can view any profile)
router.get('/profile', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN, ROLES.STUDENT), studentController.getStudentProfile);
router.get('/profile/:rollNumber', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN, ROLES.STUDENT), studentController.getStudentProfile);

// TC Clearance Check (Librarians & Admin only)
router.get(
  '/tc-clearance/:rollNumber',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN),
  logAudit('TC_CLEARANCE_CHECK', 'STUDENTS'),
  studentController.getTcClearance
);

// Clear Student Data / Exit Purge (Librarians & Admin only)
router.post(
  '/tc-clearance/:rollNumber/clear',
  verifyJWT,
  authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN),
  logAudit('CLEAR_STUDENT_DATA', 'STUDENTS'),
  studentController.clearStudentData
);

// Get comprehensive student details & activity view (Librarian & Admin only)
router.get('/:rollNumber/details', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), studentController.getStudentDetails);
router.get('/:rollNumber', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), studentController.getStudentDetails);

module.exports = router;
