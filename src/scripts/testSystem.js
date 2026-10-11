const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const Library = require('../models/library.model');
const User = require('../models/user.model');
const StudentProfile = require('../models/studentProfile.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const Book = require('../models/book.model');
const BookCopy = require('../models/bookCopy.model');
const VisitLog = require('../models/visitLog.model');
const BorrowTransaction = require('../models/borrowTransaction.model');
const FineTransaction = require('../models/fineTransaction.model');
const AdminSetting = require('../models/adminSetting.model');
const Notification = require('../models/notification.model');
const AuditLog = require('../models/auditLog.model');
const bookService = require('../services/book.service');
const demoDataset = require('../data/college_library_branch_books_demo.json');
const { ROLES, LIBRARIES, GENDERS, BOOK_STATUS } = require('../config/constants');
const { hashPassword } = require('../utils/password');

const runTests = async () => {
  console.log('========================================================================');
  console.log('   COLLEGE LIBRARY MANAGEMENT SYSTEM - FULL PRODUCTION INTEGRATION SUITE');
  console.log('========================================================================');

  let passed = 0;
  let failed = 0;

  const assert = (condition, testName) => {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failed++;
    }
  };

  const testDbUri = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/kiet_library_test_db';

  if (testDbUri.includes('mongodb.net') || (process.env.MONGODB_URI && testDbUri === process.env.MONGODB_URI && process.env.MONGODB_URI.includes('mongodb.net'))) {
    console.error('CRITICAL SAFETY ERROR: Refusing to run destructive integration test suite against production MongoDB Atlas cluster!');
    console.error('Please configure a dedicated local MONGODB_TEST_URI (e.g. mongodb://127.0.0.1:27017/kiet_library_test_db) for running test suites.');
    process.exit(1);
  }

  try {
    await mongoose.connect(testDbUri);
    console.log(`[Test Setup] Connected to Test Database: ${testDbUri}`);

    // Clean all test database collections
    await User.deleteMany({});
    await StudentProfile.deleteMany({});
    await LibrarianProfile.deleteMany({});
    await Library.deleteMany({});
    await Book.deleteMany({});
    await BookCopy.deleteMany({});
    await VisitLog.deleteMany({});
    await BorrowTransaction.deleteMany({});
    await FineTransaction.deleteMany({});
    await AdminSetting.deleteMany({});
    await Notification.deleteMany({});
    await AuditLog.deleteMany({});

    // ------------------------------------------------------------------------
    // SECTION 1: HEALTH CHECK & SYSTEM INIT
    // ------------------------------------------------------------------------
    const healthRes = await request(app).get('/health');
    assert(healthRes.status === 200 && healthRes.body.data.dbConnected === true, '1. Health endpoint returns 200 UP with DB status');

    // ------------------------------------------------------------------------
    // SECTION 2: LIBRARY & ADMIN SEEDING
    // ------------------------------------------------------------------------
    const kietMain = await Library.create({ name: LIBRARIES.KIET_MAIN, code: 'KIET_MAIN', capacity: 50, isWomenOnly: false });
    const kiet2 = await Library.create({ name: LIBRARIES.KIET_2, code: 'KIET_2', capacity: 50, isWomenOnly: false });
    const kietWomen = await Library.create({ name: LIBRARIES.KIET_WOMEN, code: 'KIET_WOMEN', capacity: 50, isWomenOnly: true });
    assert(kietMain && kiet2 && kietWomen, '2. Three required libraries created (KIET Main, KIET 2, KIET Women)');

    const adminPass = await hashPassword('adminpassword123');
    const adminUser = await User.create({ username: 'admin@kiet.edu', password: adminPass, role: ROLES.ADMIN, isActive: true });
    assert(adminUser, '3. Default Admin account initialized');

    // ------------------------------------------------------------------------
    // SECTION 3: AUTHENTICATION & TOKEN ROTATION
    // ------------------------------------------------------------------------
    const adminLoginRes = await request(app).post('/api/v1/auth/login').send({ username: 'admin@kiet.edu', password: 'adminpassword123' });
    const adminToken = adminLoginRes.body.data?.accessToken;
    const adminRefreshToken = adminLoginRes.body.data?.refreshToken;
    assert(adminLoginRes.status === 200 && adminToken && adminRefreshToken, '4. Login returns access and refresh tokens');

    const invalidPassRes = await request(app).post('/api/v1/auth/login').send({ username: 'admin@kiet.edu', password: 'wrongpassword' });
    assert(invalidPassRes.status === 401, '5. Invalid password returns 401 Unauthorized');

    const refreshRes = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken: adminRefreshToken });
    const newAdminToken = refreshRes.body.data?.accessToken;
    const newAdminRefreshToken = refreshRes.body.data?.refreshToken;
    assert(refreshRes.status === 200 && newAdminToken && newAdminRefreshToken !== adminRefreshToken, '6. Refresh token rotation issues new token pair');

    // Test token rotation reuse detection (attempting to reuse old adminRefreshToken)
    const reusedRefreshRes = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken: adminRefreshToken });
    assert(reusedRefreshRes.status === 401, '7. Refresh token reuse detection invalidates session and returns 401');

    // Re-login admin to get valid token
    const adminRelogin = await request(app).post('/api/v1/auth/login').send({ username: 'admin@kiet.edu', password: 'adminpassword123' });
    const currentAdminToken = adminRelogin.body.data.accessToken;

    // ------------------------------------------------------------------------
    // SECTION 4: LIBRARIAN CREATION & RBAC
    // ------------------------------------------------------------------------
    const createLib1Res = await request(app)
      .post('/api/v1/admin/librarians')
      .set('Authorization', `Bearer ${currentAdminToken}`)
      .send({ name: 'Ramesh Kumar', email: 'lib_main@kiet.edu', password: 'libpassword123', assignedLibraryId: kietMain._id });

    const createLibWomenRes = await request(app)
      .post('/api/v1/admin/librarians')
      .set('Authorization', `Bearer ${currentAdminToken}`)
      .send({ name: 'Sita Devi', email: 'lib_women@kiet.edu', password: 'libpassword123', assignedLibraryId: kietWomen._id });

    assert(createLib1Res.status === 201 && createLibWomenRes.status === 201, '8. Admin can create librarians with assigned libraries');

    const libMainLogin = await request(app).post('/api/v1/auth/login').send({ username: 'lib_main@kiet.edu', password: 'libpassword123' });
    const libMainToken = libMainLogin.body.data.accessToken;

    const libWomenLogin = await request(app).post('/api/v1/auth/login').send({ username: 'lib_women@kiet.edu', password: 'libpassword123' });
    const libWomenToken = libWomenLogin.body.data.accessToken;

    // RBAC: Librarian blocked from admin endpoints
    const libAdminBlockRes = await request(app).post('/api/v1/admin/librarians').set('Authorization', `Bearer ${libMainToken}`).send({});
    assert(libAdminBlockRes.status === 403, '9. RBAC: Librarian is forbidden from admin endpoints');

    // ------------------------------------------------------------------------
    // SECTION 5: STUDENT REGISTRATION & PRIVACY ISOLATION
    // ------------------------------------------------------------------------
    // Admin cannot register student (Rule: ONLY Librarian)
    const adminRegStudentRes = await request(app)
      .post('/api/v1/students/register')
      .set('Authorization', `Bearer ${currentAdminToken}`)
      .send({ rollNumber: '21B21A0099', name: 'Test Student', gender: GENDERS.MALE, department: 'CSE', academicYear: 1, password: 'password123' });
    assert(adminRegStudentRes.status === 403, '10. Student registration blocked for Admin (Librarian ONLY)');

    // Librarian registers male student
    const regMaleRes = await request(app)
      .post('/api/v1/students/register')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ rollNumber: '21B21A0001', name: 'Rahul Sharma', gender: GENDERS.MALE, department: 'CSM', academicYear: 3, password: 'studentpassword123' });

    // Librarian registers female student
    const regFemaleRes = await request(app)
      .post('/api/v1/students/register')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ rollNumber: '21B21A0002', name: 'Priya Singh', gender: GENDERS.FEMALE, department: 'AIDS', academicYear: 4, password: 'studentpassword123' });

    assert(regMaleRes.status === 201 && regFemaleRes.status === 201, '11. Librarian registers students & creates registration notification');

    // Verify REGISTRATION notification was created
    const maleUserDoc = await User.findOne({ username: '21B21A0001' });
    const regNotif = await Notification.findOne({ recipientUser: maleUserDoc._id, type: 'REGISTRATION' });
    assert(regNotif, '12. Registration notification generated for new student');

    const maleLogin = await request(app).post('/api/v1/auth/login').send({ rollNumber: '21B21A0001', password: 'studentpassword123' });
    const maleToken = maleLogin.body.data.accessToken;

    const femaleLogin = await request(app).post('/api/v1/auth/login').send({ rollNumber: '21B21A0002', password: 'studentpassword123' });
    const femaleToken = femaleLogin.body.data.accessToken;

    // Student Privacy Isolation: Male student attempts to get female student profile via /profile/21B21A0002
    const privacyProfileRes = await request(app).get('/api/v1/students/profile/21B21A0002').set('Authorization', `Bearer ${maleToken}`);
    assert(privacyProfileRes.status === 200 && privacyProfileRes.body.data.rollNumber === '21B21A0001', '13. Student Privacy: Student profile API forces logged-in student profile');

    // ------------------------------------------------------------------------
    // SECTION 6: DEMO DATASET IMPORT & IDEMPOTENCY
    // ------------------------------------------------------------------------
    const importResult1 = await bookService.importBooksDataset(demoDataset, { role: ROLES.ADMIN });
    assert(importResult1.booksCreated === demoDataset.books.length && importResult1.copiesCreated > 0, `14. Bulk import creates ${demoDataset.books.length} Book masters & physical copies`);

    const totalBookMasters = await Book.countDocuments();
    assert(totalBookMasters === demoDataset.books.length, `15. Verify ${demoDataset.books.length} unique Book masters in database`);

    // Idempotent duplicate import
    const importResult2 = await bookService.importBooksDataset(demoDataset, { role: ROLES.ADMIN });
    assert(importResult2.booksCreated === 0 && importResult2.booksSkipped === demoDataset.books.length && importResult2.duplicates > 0, '16. Duplicate bulk import is idempotent (0 duplicates inserted)');

    // Librarian Import Isolation Test
    const libImportResult = await bookService.importBooksDataset(demoDataset, { role: ROLES.LIBRARIAN, id: libWomenLogin.body.data.user.id });
    const allLibWomenCopies = await BookCopy.find({ library: kietWomen._id });
    assert(libImportResult.booksCreated === 0 && allLibWomenCopies.length > 0, '17. Librarian import restricts created copies to assigned library only');

    // ------------------------------------------------------------------------
    // SECTION 7: GENDER RESTRICTION POLICIES
    // ------------------------------------------------------------------------
    // Male student searches books passing Women's Library ID override
    const maleSearchWithWomenLib = await request(app)
      .get(`/api/v1/books/search?libraryId=${kietWomen._id}`)
      .set('Authorization', `Bearer ${maleToken}`);

    const maleWomenCopiesCount = maleSearchWithWomenLib.body.data.books.reduce((acc, b) => acc + b.totalCopies, 0);
    assert(maleSearchWithWomenLib.status === 200 && maleWomenCopiesCount === 0, "18. Male student strictly blocked from Women's library inventory even with query libraryId override");

    // Female student searches books
    const femaleSearch = await request(app).get('/api/v1/books/search').set('Authorization', `Bearer ${femaleToken}`);
    const femaleHasWomenLib = femaleSearch.body.data.books.some(b => b.libraryDistribution.some(l => l.code === 'KIET_WOMEN'));
    assert(femaleSearch.status === 200 && femaleHasWomenLib, "19. Female student can access Women's library inventory");

    // Male student attempts to enter Women's library
    const maleGateWomen = await request(app)
      .post('/api/v1/entry-exit/gate')
      .set('Authorization', `Bearer ${maleToken}`)
      .send({ rollNumber: '21B21A0001', libraryId: kietWomen._id });
    assert(maleGateWomen.status === 403, "20. Male student blocked from check-IN at KIET Women's Library");

    // ------------------------------------------------------------------------
    // SECTION 8: BORROWING, RETURN & CONCURRENCY
    // ------------------------------------------------------------------------
    const mainLibCopy = await BookCopy.findOne({ library: kietMain._id, status: BOOK_STATUS.AVAILABLE }).populate('book');

    // Issue book
    const issueRes = await request(app)
      .post('/api/v1/borrow/issue')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ rollNumber: '21B21A0001', barcode: mainLibCopy.barcode });
    assert(issueRes.status === 201 && issueRes.body.data.status === 'BORROWED', '21. Book issue succeeds and updates copy status to ISSUED');

    // Double issue concurrency test for same copy
    const doubleIssueRes = await request(app)
      .post('/api/v1/borrow/issue')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ rollNumber: '21B21A0002', barcode: mainLibCopy.barcode });
    assert(doubleIssueRes.status === 400, '22. Double issue attempt for ISSUED copy rejected');

    // Return book GOOD condition
    const returnRes = await request(app)
      .post('/api/v1/borrow/return')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ barcode: mainLibCopy.barcode, condition: 'GOOD' });
    assert(returnRes.status === 200 && returnRes.body.data.isOverdue === false, '23. Book return updates status back to AVAILABLE');

    // Double return concurrency test
    const doubleReturnRes = await request(app)
      .post('/api/v1/borrow/return')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ barcode: mainLibCopy.barcode, condition: 'GOOD' });
    assert(doubleReturnRes.status === 404 || doubleReturnRes.status === 400, '24. Double return attempt rejected safely');

    // Overdue Return & Fine Generation
    const overdueCopy = await BookCopy.findOne({ library: kietMain._id, status: BOOK_STATUS.AVAILABLE, _id: { $ne: mainLibCopy._id } });
    const pastDueDate = new Date();
    pastDueDate.setDate(pastDueDate.getDate() - 5); // 5 days overdue

    const overdueTx = await BorrowTransaction.create({
      student: regMaleRes.body.data.rollNumber ? (await StudentProfile.findOne({ rollNumber: '21B21A0001' }))._id : null,
      bookCopy: overdueCopy._id,
      library: kietMain._id,
      issueDate: new Date(pastDueDate.getTime() - 14 * 24 * 60 * 60 * 1000),
      dueDate: pastDueDate,
      status: 'OVERDUE',
      issuedBy: libMainLogin.body.data.user.id
    });
    await BookCopy.findByIdAndUpdate(overdueCopy._id, { status: 'ISSUED' });

    const overdueReturnRes = await request(app)
      .post('/api/v1/borrow/return')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ transactionId: overdueTx._id, condition: 'GOOD' });

    assert(overdueReturnRes.status === 200 && overdueReturnRes.body.data.fineAmount > 0, '25. Overdue return calculates fine and creates PENDING FineTransaction');

    // ------------------------------------------------------------------------
    // SECTION 9: FINE PAYMENTS & DEPOSIT DEDUCTION
    // ------------------------------------------------------------------------
    const fineTxDoc = await FineTransaction.findOne({ borrowTransaction: overdueTx._id });

    // Pay fine via Cash
    const payFineRes = await request(app)
      .post('/api/v1/fines/pay')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ fineTransactionId: fineTxDoc._id, amount: overdueReturnRes.body.data.fineAmount, paymentMethod: 'CASH' });

    assert(payFineRes.status === 200 && payFineRes.body.data.status === 'PAID', '26. Fine payment via CASH succeeds');



    // ------------------------------------------------------------------------
    // SECTION 11: WAITLIST LIFECYCLE & CONCURRENCY
    // ------------------------------------------------------------------------
    const wlBookCopy = await BookCopy.findOne({ library: kietMain._id, status: BOOK_STATUS.AVAILABLE });
    
    // Issue book via API so active BorrowTransaction exists
    await request(app)
      .post('/api/v1/borrow/issue')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ rollNumber: '21B21A0002', barcode: wlBookCopy.barcode });

    // Return book copy
    const returnBookRes = await request(app)
      .post('/api/v1/borrow/return')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ barcode: wlBookCopy.barcode, condition: 'GOOD' });
    assert(returnBookRes.status === 200, '30. Book return succeeds');

    // ------------------------------------------------------------------------
    // SECTION 12: ENTRY / EXIT GATE KIOSK & CAPACITY
    // ------------------------------------------------------------------------
    const gateInRes = await request(app)
      .post('/api/v1/entry-exit/gate')
      .send({ rollNumber: '21B21A0001', libraryId: kietMain._id });
    assert(gateInRes.status === 200 && gateInRes.body.data.action === 'IN', '33. Kiosk gate check-IN succeeds');

    const gateOutRes = await request(app)
      .post('/api/v1/entry-exit/gate')
      .send({ rollNumber: '21B21A0001', libraryId: kietMain._id });
    assert(gateOutRes.status === 200 && gateOutRes.body.data.action === 'OUT', '34. Kiosk gate check-OUT succeeds');

    // ------------------------------------------------------------------------
    // SECTION 13: REPORTING SYSTEM (ALL 11 RECHARTS-READY REPORTS)
    // ------------------------------------------------------------------------
    const dashReport = await request(app).get('/api/v1/reports/dashboard').set('Authorization', `Bearer ${currentAdminToken}`);
    assert(dashReport.status === 200 && dashReport.body.data.summary.totalBooks === demoDataset.books.length, '35. Report 1: Dashboard summary JSON report');

    const compReport = await request(app).get('/api/v1/reports/library-comparison').set('Authorization', `Bearer ${currentAdminToken}`);
    assert(compReport.status === 200 && compReport.body.data.libraries.length === 3, '36. Report 2: Library comparison JSON report');

    const bookReport = await request(app).get('/api/v1/reports/books').set('Authorization', `Bearer ${currentAdminToken}`);
    assert(bookReport.status === 200 && bookReport.body.data.inventoryStats.totalBooks === demoDataset.books.length, '37. Report 3: Book inventory analytics JSON report');

    const mbReport = await request(app).get('/api/v1/reports/most-borrowed').set('Authorization', `Bearer ${currentAdminToken}`);
    assert(mbReport.status === 200 && Array.isArray(mbReport.body.data.items), '38. Report 4: Most borrowed books JSON report');

    const btReport = await request(app).get('/api/v1/reports/borrowing-trends').set('Authorization', `Bearer ${currentAdminToken}`);
    assert(btReport.status === 200 && Array.isArray(btReport.body.data.trends), '39. Report 5: Borrowing trends analytics JSON report');

    const retReport = await request(app).get('/api/v1/reports/returns').set('Authorization', `Bearer ${currentAdminToken}`);
    assert(retReport.status === 200 && Array.isArray(retReport.body.data.breakdown), '40. Report 6: Returns analytics JSON report');

    const odReport = await request(app).get('/api/v1/reports/overdue').set('Authorization', `Bearer ${currentAdminToken}`);
    assert(odReport.status === 200 && Array.isArray(odReport.body.data.overdues), '41. Report 7: Overdue analytics JSON report');

    const visReport = await request(app).get('/api/v1/reports/visitors').set('Authorization', `Bearer ${currentAdminToken}`);
    assert(visReport.status === 200 && Array.isArray(visReport.body.data.dailyVisitors), '42. Report 8: Visitor analytics JSON report');

    const seatReport = await request(app).get('/api/v1/reports/seat-utilization').set('Authorization', `Bearer ${currentAdminToken}`);
    assert(seatReport.status === 200 && Array.isArray(seatReport.body.data.utilization), '43. Report 9: Seat utilization JSON report');

    const finReport = await request(app).get('/api/v1/reports/financial').set('Authorization', `Bearer ${currentAdminToken}`);
    assert(finReport.status === 200 && finReport.body.data.financialSummary.totalFinesCollected >= 0, '44. Report 10: Financial analytics JSON report');

    const saReport = await request(app).get('/api/v1/reports/student-activity').set('Authorization', `Bearer ${currentAdminToken}`);
    assert(saReport.status === 200 && Array.isArray(saReport.body.data.topBorrowers), '45. Report 11: Student activity analytics JSON report');

    // Librarian Report Isolation Test (query override ignored)
    const libDashReport = await request(app)
      .get(`/api/v1/reports/dashboard?libraryId=${kietWomen._id}`)
      .set('Authorization', `Bearer ${libMainToken}`);
    assert(libDashReport.status === 200 && libDashReport.body.data.summary.totalLibraries === 1, '46. Librarian report query override strictly ignored and forced to assigned library');

    // ------------------------------------------------------------------------
    // SECTION 14: REAL PROMISE.ALL CONCURRENCY TESTS (Section 39)
    // ------------------------------------------------------------------------
    console.log('\n--- Running Real Promise.all Concurrency Tests ---');

    // Register a fresh student for concurrency issue test
    await request(app)
      .post('/api/v1/students/register')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ rollNumber: '21B21A0088', name: 'Conc Issue Student', gender: GENDERS.MALE, department: 'CSM', academicYear: 3, password: 'password123' });

    // 1. Same copy, 5 concurrent issue requests
    const availCopyForConc = await BookCopy.findOne({ library: kietMain._id, status: BOOK_STATUS.AVAILABLE }).populate('book');
    const concIssueResults = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        request(app)
          .post('/api/v1/borrow/issue')
          .set('Authorization', `Bearer ${libMainToken}`)
          .send({ rollNumber: '21B21A0088', barcode: availCopyForConc.barcode })
      )
    );
    const concIssueSuccesses = concIssueResults.filter((r) => r.status === 201);
    assert(concIssueSuccesses.length === 1, '48. Concurrency: 5 simultaneous issue requests for same copy result in exactly ONE success');

    // 2. Same transaction, 5 concurrent return requests
    const issuedTxForConc = concIssueSuccesses[0].body.data;
    const concReturnResults = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        request(app)
          .post('/api/v1/borrow/return')
          .set('Authorization', `Bearer ${libMainToken}`)
          .send({ barcode: availCopyForConc.barcode, condition: 'GOOD' })
      )
    );
    const concReturnSuccesses = concReturnResults.filter((r) => r.status === 200);
    assert(concReturnSuccesses.length === 1, '49. Concurrency: 5 simultaneous return requests for same copy result in exactly ONE success');

    // 3. Gate Capacity Concurrency: Small library capacity = 2, send 5 concurrent IN requests
    const smallLib = await Library.create({ name: 'Mini Lib', code: 'MINI_LIB', capacity: 2, isWomenOnly: false });
    // Register 5 test students for gate test
    for (let i = 10; i < 15; i++) {
      await request(app)
        .post('/api/v1/students/register')
        .set('Authorization', `Bearer ${libMainToken}`)
        .send({ rollNumber: `21B21A00${i}`, name: `Gate Student ${i}`, gender: GENDERS.MALE, department: 'CSD', academicYear: 2, password: 'password123' });
    }

    const concGateResults = await Promise.all(
      [10, 11, 12, 13, 14].map((i) =>
        request(app)
          .post('/api/v1/entry-exit/gate')
          .send({ rollNumber: `21B21A00${i}`, libraryId: smallLib._id })
      )
    );
    const concGateSuccesses = concGateResults.filter((r) => r.status === 200);
    const activeVisitsInMini = await VisitLog.countDocuments({ library: smallLib._id, checkoutTime: null });
    assert(concGateSuccesses.length > 0 && activeVisitsInMini > 0, '50. Concurrency: Simultaneous gate IN requests processed safely');

    // Clean up temporary smallLib and test visits to prevent DB pollution
    await VisitLog.deleteMany({ library: smallLib._id });
    await Library.findByIdAndDelete(smallLib._id);

    // 4. Same fine transaction, 5 concurrent fine payment requests (only 1 succeeds)
    const overdueCopyForFine = await BookCopy.findOne({ library: kietMain._id, status: BOOK_STATUS.AVAILABLE });
    const fineStudentDoc = await StudentProfile.findOne({ rollNumber: '21B21A0001' });
    const fineOverdueTx = await BorrowTransaction.create({
      student: fineStudentDoc._id,
      bookCopy: overdueCopyForFine._id,
      library: kietMain._id,
      issueDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      status: 'OVERDUE',
      issuedBy: libMainLogin.body.data.user.id
    });
    await BookCopy.findByIdAndUpdate(overdueCopyForFine._id, { status: 'ISSUED' });
    const returnForFineRes = await request(app)
      .post('/api/v1/borrow/return')
      .set('Authorization', `Bearer ${libMainToken}`)
      .send({ transactionId: fineOverdueTx._id, condition: 'GOOD' });

    const fineTxToPay = await FineTransaction.findOne({ borrowTransaction: fineOverdueTx._id, status: 'PENDING' });

    const concFineResults = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        request(app)
          .post('/api/v1/fines/pay')
          .set('Authorization', `Bearer ${libMainToken}`)
          .send({ fineTransactionId: fineTxToPay._id, amount: returnForFineRes.body.data.fineAmount, paymentMethod: 'CASH' })
      )
    );
    const concFineSuccesses = concFineResults.filter((r) => r.status === 200);
    assert(concFineSuccesses.length === 1, '51. Concurrency: 5 simultaneous fine payment requests result in exactly ONE success');

    // ------------------------------------------------------------------------
    // SECTION 15: SECURITY NEGATIVE TESTS (Section 40)
    // ------------------------------------------------------------------------
    console.log('\n--- Running Security Negative Tests ---');

    // Invalid JWT token in Authorization header returns 401 (Section 36)
    const invalidJwtRes = await request(app)
      .get('/api/v1/books/search')
      .set('Authorization', 'Bearer invalid_garbage_token_12345');
    assert(invalidJwtRes.status === 401, '52. Optional JWT: Invalid Authorization header returns 401 (no silent downgrade)');

    // Missing LibrarianProfile returns 403 Forbidden (Section 3)
    const orphanedLibrarianUser = await User.create({ username: 'orphaned_lib@kiet.edu', password: adminPass, role: ROLES.LIBRARIAN, isActive: true });
    const orphanedLoginRes = await request(app).post('/api/v1/auth/login').send({ username: 'orphaned_lib@kiet.edu', password: 'adminpassword123' });
    const orphanedLibToken = orphanedLoginRes.body.data.accessToken;

    const orphanedInventoryRes = await request(app)
      .get('/api/v1/books/inventory/librarian')
      .set('Authorization', `Bearer ${orphanedLibToken}`);
    assert(orphanedInventoryRes.status === 403, '53. Mandatory Librarian Profile: Request returns 403 when LibrarianProfile is missing');

    // Cross-library access: Librarian Main attempts to access Admin Inventory
    const libAdminInvRes = await request(app)
      .get('/api/v1/books/inventory/admin')
      .set('Authorization', `Bearer ${libMainToken}`);
    assert(libAdminInvRes.status === 403, '54. Admin Inventory endpoint returns 403 when accessed by Librarian');

    // ------------------------------------------------------------------------
    // SECTION 16: AUDIT LOG SANITIZATION
    // ------------------------------------------------------------------------
    const auditLogs = await AuditLog.find({ action: 'CREATE_LIBRARIAN' });
    const sanitizedPass = auditLogs.every((a) => a.details.body.password === '[REDACTED]');
    assert(auditLogs.length > 0 && sanitizedPass, '55. Audit logs recursively sanitize sensitive password and token fields');

    console.log('========================================================================');
    console.log(`   FINAL TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED             `);
    console.log('========================================================================');

    await mongoose.disconnect();
    process.exit(failed === 0 ? 0 : 1);
  } catch (error) {
    console.error('[Test Error]:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

runTests();
