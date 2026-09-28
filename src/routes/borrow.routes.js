const express = require('express');
const router = express.Router();
const borrowController = require('../controllers/borrow.controller');
const { verifyJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const { logAudit } = require('../middlewares/audit.middleware');
const validate = require('../middlewares/validate.middleware');
const {
  issueBookSchema,
  returnBookSchema,
  overdueQuerySchema,
  historyQuerySchema
} = require('../validators/borrow.validator');
const { ROLES } = require('../config/constants');

// Issue book (Librarians & Admin only)
router.post('/issue', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), validate(issueBookSchema), logAudit('ISSUE_BOOK', 'BORROW'), borrowController.issueBook);

// Return book (Librarians & Admin only)
router.post('/return', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), validate(returnBookSchema), logAudit('RETURN_BOOK', 'BORROW'), borrowController.returnBook);

// Get overdue list
router.get('/overdue', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), validate(overdueQuerySchema, 'query'), borrowController.getOverdueBorrowings);

// Get student borrowing history (Student, Librarian, Admin)
router.get('/history', verifyJWT, authorizeRoles(ROLES.STUDENT, ROLES.LIBRARIAN, ROLES.ADMIN), validate(historyQuerySchema, 'query'), borrowController.getStudentHistory);
router.get('/history/:studentId', verifyJWT, authorizeRoles(ROLES.STUDENT, ROLES.LIBRARIAN, ROLES.ADMIN), validate(historyQuerySchema, 'query'), borrowController.getStudentHistory);

module.exports = router;
