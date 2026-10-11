require('dotenv').config({ path: __dirname + '/../../.env' });
const mongoose = require('mongoose');
const Library = require('../models/library.model');
const User = require('../models/user.model');
const StudentProfile = require('../models/studentProfile.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const TCClearanceRequest = require('../models/tcClearanceRequest.model');
const BorrowTransaction = require('../models/borrowTransaction.model');
const FineTransaction = require('../models/fineTransaction.model');
const tcClearanceService = require('../services/tcClearance.service');
const { ROLES } = require('../config/constants');

async function runTests() {
  console.log('--- STARTING TC CLEARANCE WORKFLOW INTEGRATION TESTS ---');
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not found in environment');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB successfully.');

  try {
    // 1. Ensure Libraries exist
    let libMain = await Library.findOne({ code: 'KIET_MAIN' });
    if (!libMain) {
      libMain = await Library.create({ name: 'KIET Library', code: 'KIET_MAIN', capacity: 200, location: 'Main Block' });
    }
    let lib2 = await Library.findOne({ code: 'KIET_2' });
    if (!lib2) {
      lib2 = await Library.create({ name: 'KIET 2 Library', code: 'KIET_2', capacity: 150, location: 'KIET 2 Campus' });
    }
    let libWomen = await Library.findOne({ code: 'KIET_WOMEN' });
    if (!libWomen) {
      libWomen = await Library.create({ name: "KIET Women's Library", code: 'KIET_WOMEN', capacity: 100, isWomenOnly: true, location: 'Women Block' });
    }

    console.log(`Verified 3 operational libraries: ${libMain.name}, ${lib2.name}, ${libWomen.name}`);

    // Create Test Users & Profiles (prefixed with TEST_TC_)
    const cleanTestDb = async () => {
      await TCClearanceRequest.deleteMany({ rollNumber: { $regex: /^TEST_TC/ } });
      await StudentProfile.deleteMany({ rollNumber: { $regex: /^TEST_TC/ } });
      await User.deleteMany({ username: { $regex: /^test_tc_/ } });
      await LibrarianProfile.deleteMany({ email: { $regex: /^test_tc_/ } });
    };

    await cleanTestDb();

    // Create 3 Librarians (one for each library)
    const libUserMain = await User.create({ username: 'test_tc_lib_main', password: 'password123', role: ROLES.LIBRARIAN });
    const libProfMain = await LibrarianProfile.create({ user: libUserMain._id, name: 'Main Librarian', email: 'test_tc_lib_main@kiet.edu', assignedLibrary: libMain._id });

    const libUser2 = await User.create({ username: 'test_tc_lib_2', password: 'password123', role: ROLES.LIBRARIAN });
    const libProf2 = await LibrarianProfile.create({ user: libUser2._id, name: 'KIET 2 Librarian', email: 'test_tc_lib_2@kiet.edu', assignedLibrary: lib2._id });

    const libUserWomen = await User.create({ username: 'test_tc_lib_women', password: 'password123', role: ROLES.LIBRARIAN });
    const libProfWomen = await LibrarianProfile.create({ user: libUserWomen._id, name: 'Women Librarian', email: 'test_tc_lib_women@kiet.edu', assignedLibrary: libWomen._id });

    // Create 3 Students
    const studentUser1 = await User.create({ username: 'test_tc_student1', password: 'password123', role: ROLES.STUDENT });
    const studentProf1 = await StudentProfile.create({
      user: studentUser1._id,
      rollNumber: 'TEST_TC_21B21A0001',
      campusCode: 'B2',
      name: 'Student KIET Main',
      gender: 'MALE',
      department: 'CSE',
      academicYear: 4,
      assignedLibrary: libMain._id
    });

    const studentUser2 = await User.create({ username: 'test_tc_student2', password: 'password123', role: ROLES.STUDENT });
    const studentProf2 = await StudentProfile.create({
      user: studentUser2._id,
      rollNumber: 'TEST_TC_216Q1A0002',
      campusCode: '6Q',
      name: 'Student KIET 2',
      gender: 'FEMALE',
      department: 'AIDS',
      academicYear: 3,
      assignedLibrary: lib2._id
    });

    const studentUser3 = await User.create({ username: 'test_tc_student3', password: 'password123', role: ROLES.STUDENT });
    const studentProf3 = await StudentProfile.create({
      user: studentUser3._id,
      rollNumber: 'TEST_TC_21JN1A0003',
      campusCode: 'JN',
      name: 'Student KIET Women',
      gender: 'FEMALE',
      department: 'CAI',
      academicYear: 4,
      assignedLibrary: libWomen._id
    });

    console.log('Setup completed: 3 librarians and 3 students created.');

    // TEST 1: Student 1 submits request (KIET_MAIN)
    console.log('\n--- TEST 1: Student 1 submits request ---');
    const req1 = await tcClearanceService.createRequest(studentUser1._id, {
      reason: 'Course Completed',
      fathersName: 'Father One'
    });
    console.log('✓ Request 1 created:', req1._id.toString(), 'Assigned Library:', req1.assignedLibraryName);

    // Verify Routing (backend isolation):
    const queueMain = await tcClearanceService.getRequestsForLibrarian(libUserMain._id);
    const queue2 = await tcClearanceService.getRequestsForLibrarian(libUser2._id);
    const queueWomen = await tcClearanceService.getRequestsForLibrarian(libUserWomen._id);

    const testRequestsMain = queueMain.requests.filter(r => r.rollNumber.startsWith('TEST_TC'));
    const testRequests2 = queue2.requests.filter(r => r.rollNumber.startsWith('TEST_TC'));
    const testRequestsWomen = queueWomen.requests.filter(r => r.rollNumber.startsWith('TEST_TC'));

    console.log(`Main Lib Test Queue Count: ${testRequestsMain.length}`);
    console.log(`KIET 2 Lib Test Queue Count: ${testRequests2.length}`);
    console.log(`Women Lib Test Queue Count: ${testRequestsWomen.length}`);

    if (testRequestsMain.length !== 1 || testRequests2.length !== 0 || testRequestsWomen.length !== 0) {
      throw new Error('FAILED TEST 1: Request routing cross-library isolation failed!');
    }
    console.log('✓ TEST 1 PASSED: Request 1 visible to KIET Main librarian ONLY.');

    // TEST A, B, C: Review endpoints for each librarian
    console.log('\n--- TEST A, B, C: Review endpoints for each librarian ---');
    // KIET 1 Review:
    const review1 = await tcClearanceService.getRequestDetails(req1._id, { id: libUserMain._id, role: ROLES.LIBRARIAN });
    if (!review1 || !review1.request) throw new Error('FAILED TEST A: KIET librarian review failed');
    console.log('✓ TEST A PASSED: KIET librarian can review KIET request.');

    // Create request for KIET 2 student & test KIET 2 librarian review
    const req2 = await tcClearanceService.createRequest(studentUser2._id, { reason: 'Higher Studies' });
    const review2 = await tcClearanceService.getRequestDetails(req2._id, { id: libUser2._id, role: ROLES.LIBRARIAN });
    if (!review2 || !review2.request) throw new Error('FAILED TEST B: KIET 2 librarian review failed');
    console.log('✓ TEST B PASSED: KIET 2 librarian can review KIET 2 request.');

    // Create request for KIET Women student & test KIET Women librarian review
    const req3 = await tcClearanceService.createRequest(studentUser3._id, { reason: 'Transfer' });
    const review3 = await tcClearanceService.getRequestDetails(req3._id, { id: libUserWomen._id, role: ROLES.LIBRARIAN });
    if (!review3 || !review3.request) throw new Error('FAILED TEST C: KIET Women librarian review failed');
    console.log('✓ TEST C PASSED: KIET Women librarian can review KIET Women request.');

    // TEST D: Cross-library unauthorized review attempt
    console.log('\n--- TEST D: Cross-library access control for Review API ---');
    try {
      await tcClearanceService.getRequestDetails(req2._id, { id: libUserMain._id, role: ROLES.LIBRARIAN });
      throw new Error('FAILED TEST D: KIET librarian was allowed to review KIET 2 request!');
    } catch (err) {
      if (err.statusCode === 403 || err.message.includes('belongs to another library')) {
        console.log('✓ TEST D PASSED: KIET librarian blocked from reviewing KIET 2 request (403 Forbidden).');
      } else {
        throw err;
      }
    }

    // TEST 4: Prevent Duplicate Pending Requests
    console.log('\n--- TEST 4: Prevent Duplicate Pending Request ---');
    try {
      await tcClearanceService.createRequest(studentUser1._id, { reason: 'Duplicate Request' });
      throw new Error('FAILED TEST 4: Allowed duplicate request creation!');
    } catch (err) {
      if (err.message.includes('already have a pending')) {
        console.log('✓ TEST 4 PASSED: Duplicate request successfully prevented (400 Bad Request).');
      } else {
        throw err;
      }
    }

    // TEST E & F & G: Rejection with reason
    console.log('\n--- TEST E, F, G: Rejection Reason & Student Visibility ---');
    // Test G: Reject without reason should fail
    try {
      await tcClearanceService.rejectRequest(req1._id, { id: libUserMain._id, role: ROLES.LIBRARIAN }, '');
      throw new Error('FAILED TEST G: Allowed rejection without reason!');
    } catch (err) {
      if (err.message.includes('Rejection reason is required')) {
        console.log('✓ TEST G PASSED: Rejection without reason correctly rejected.');
      } else {
        throw err;
      }
    }

    // Test E: Reject with valid reason
    const exactReason = 'Outstanding fine of ₹50';
    const rejectedReq = await tcClearanceService.rejectRequest(req1._id, { id: libUserMain._id, role: ROLES.LIBRARIAN }, exactReason);
    if (rejectedReq.status === 'REJECTED' && rejectedReq.rejectionReason === exactReason) {
      console.log('✓ TEST E PASSED: Request rejected with exact reason saved in MongoDB.');
    } else {
      throw new Error('FAILED TEST E: Rejection reason not saved correctly!');
    }

    // Test F: Student fetches request and sees rejection reason
    const student1Data = await tcClearanceService.getMyRequest(studentUser1._id);
    if (student1Data.request?.status === 'REJECTED' && student1Data.request?.rejectionReason === exactReason) {
      console.log('✓ TEST F PASSED: Student sees REJECTED status and exact rejection reason.');
    } else {
      throw new Error('FAILED TEST F: Student cannot view rejection reason!');
    }

    // TEST H: Resubmission after rejection
    console.log('\n--- TEST H: Resubmission after rejection ---');
    const req1Resubmitted = await tcClearanceService.createRequest(studentUser1._id, {
      reason: 'Course Completed (Resubmitted)',
      fathersName: 'Father One'
    });
    console.log('✓ TEST H PASSED: Resubmitted request created:', req1Resubmitted._id.toString());
    const oldRequestStillExists = await TCClearanceRequest.findById(req1._id);
    if (oldRequestStillExists && oldRequestStillExists.status === 'REJECTED') {
      console.log('✓ Historical rejected request retained in MongoDB.');
    } else {
      throw new Error('FAILED TEST H: Historical rejected request was overwritten!');
    }

    // TEST I: Approval Workflow for Clear Student
    console.log('\n--- TEST I: Approval Workflow ---');
    const approvedReq = await tcClearanceService.approveRequest(req1Resubmitted._id, { id: libUserMain._id, role: ROLES.LIBRARIAN });
    if (approvedReq.status === 'APPROVED' && approvedReq.reviewedByName === 'Main Librarian') {
      console.log('✓ TEST I PASSED: Request successfully approved.');
    } else {
      throw new Error('FAILED TEST I: Approval failed!');
    }

    // Clean up test records
    await cleanTestDb();
    console.log('\nCleaned up test data.');
    console.log('====================================================');
    console.log('ALL TC CLEARANCE INTEGRATION TESTS PASSED SUCCESSFULLY!');
    console.log('====================================================');

  } catch (err) {
    console.error('\n❌ INTEGRATION TEST FAILED:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runTests();
