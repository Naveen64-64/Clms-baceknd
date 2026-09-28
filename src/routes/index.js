const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const adminRoutes = require('./admin.routes');
const libraryRoutes = require('./library.routes');
const studentRoutes = require('./student.routes');
const facultyRoutes = require('./faculty.routes');
const userRoutes = require('./user.routes');
const bookRoutes = require('./book.routes');
const borrowRoutes = require('./borrow.routes');
const entryExitRoutes = require('./entryExit.routes');
const fineRoutes = require('./fine.routes');
const notificationRoutes = require('./notification.routes');
const reportRoutes = require('./report.routes');
const auditRoutes = require('./audit.routes');
const chatRoutes = require('./chat.routes');
const settingsRoutes = require('./settings.routes');

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/settings', settingsRoutes);
router.use('/libraries', libraryRoutes);
router.use('/students', studentRoutes);
router.use('/faculty', facultyRoutes);
router.use('/users', userRoutes);
router.use('/books', bookRoutes);
router.use('/borrow', borrowRoutes);
router.use('/entry-exit', entryExitRoutes);
router.use('/fines', fineRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reports', reportRoutes);
router.use('/audit', auditRoutes);
router.use('/chat', chatRoutes);

module.exports = router;
