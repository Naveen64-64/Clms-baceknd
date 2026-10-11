const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const { verifyJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const validate = require('../middlewares/validate.middleware');
const { reportQuerySchema } = require('../validators/report.validator');
const { ROLES } = require('../config/constants');

router.get('/empty-hours', verifyJWT, authorizeRoles(ROLES.ADMIN, ROLES.LIBRARIAN), reportController.getEmptyHours);

router.use(verifyJWT, authorizeRoles(ROLES.ADMIN, ROLES.LIBRARIAN), validate(reportQuerySchema, 'query'));

router.get('/dashboard', reportController.getDashboardSummary);
router.get('/library-comparison', reportController.getLibraryComparison);
router.get('/books', reportController.getBookAnalytics);
router.get('/most-borrowed', reportController.getMostBorrowedReport);
router.get('/borrowing-trends', reportController.getBorrowingAnalytics);
router.get('/returns', reportController.getReturnsAnalytics);
router.get('/overdue', reportController.getOverdueAnalytics);
router.get('/visitors', reportController.getVisitorAnalytics);
router.get('/seat-utilization', reportController.getSeatUtilizationReport);
router.get('/financial', reportController.getFinancialAnalytics);
router.get('/student-activity', reportController.getStudentActivityAnalytics);

module.exports = router;
