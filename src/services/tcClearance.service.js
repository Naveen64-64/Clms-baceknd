const TCClearanceRequest = require('../models/tcClearanceRequest.model');
const StudentProfile = require('../models/studentProfile.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const Library = require('../models/library.model');
const BorrowTransaction = require('../models/borrowTransaction.model');
const FineTransaction = require('../models/fineTransaction.model');
const Notification = require('../models/notification.model');
const { CAMPUS_CODES, BORROW_STATUS, ROLES } = require('../config/constants');
const ApiError = require('../utils/apiError');

/**
 * Resolves or assigns the student's home/assigned library based on StudentProfile or campusCode.
 */
const resolveStudentAssignedLibrary = async (studentProfile) => {
  if (studentProfile.assignedLibrary) {
    let lib = await Library.findById(studentProfile.assignedLibrary);
    if (lib) return lib;
  }

  // Determine from campusCode ('B2' -> KIET_MAIN, '6Q' -> KIET_2, 'JN' -> KIET_WOMEN)
  const targetCode = CAMPUS_CODES[studentProfile.campusCode] || 'KIET_MAIN';
  let library = await Library.findOne({ code: targetCode });

  if (!library) {
    library = await Library.findOne({ code: 'KIET_MAIN' }) || await Library.findOne();
  }

  if (library) {
    studentProfile.assignedLibrary = library._id;
    await studentProfile.save();
  }

  return library;
};

/**
 * Student submits a new No Due / TC Clearance Request.
 */
const createRequest = async (userId, requestData) => {
  const student = await StudentProfile.findOne({ user: userId });
  if (!student) {
    throw new ApiError(404, 'Student profile not found');
  }

  const assignedLibrary = await resolveStudentAssignedLibrary(student);
  if (!assignedLibrary) {
    throw new ApiError(400, 'Could not determine assigned library for student');
  }

  // Check for existing active requests
  const existingPending = await TCClearanceRequest.findOne({
    student: student._id,
    status: 'PENDING'
  });
  if (existingPending) {
    throw new ApiError(400, 'You already have a pending No Due request.');
  }

  const existingApproved = await TCClearanceRequest.findOne({
    student: student._id,
    status: 'APPROVED'
  });
  if (existingApproved) {
    throw new ApiError(400, 'Your No Due request has already been approved.');
  }

  const { reason, fathersName, enclosures } = requestData;
  if (!reason || !reason.trim()) {
    throw new ApiError(400, 'Reason for requesting No Due / TC is required');
  }

  // Create request document
  const tcRequest = await TCClearanceRequest.create({
    student: student._id,
    user: userId,
    rollNumber: student.rollNumber,
    studentName: student.name,
    assignedLibrary: assignedLibrary._id,
    assignedLibraryName: assignedLibrary.name,
    department: student.department,
    academicYear: student.academicYear,
    email: student.email,
    fathersName: fathersName ? fathersName.trim() : '',
    reason: reason.trim(),
    enclosures: enclosures || { idCard: true, libraryCard: true, photocopyPC: false },
    status: 'PENDING',
    requestDate: new Date()
  });

  // Notify student
  await Notification.create({
    recipientUser: userId,
    type: 'TC_CLEARANCE',
    title: 'TC Clearance Request Submitted',
    message: `Your No Due request has been submitted to ${assignedLibrary.name} for verification.`,
    relatedEntity: { requestId: tcRequest._id }
  }).catch(() => {}); // Non-blocking notification

  return tcRequest;
};

/**
 * Get the current student's latest TC Clearance request and current obligations.
 */
const getMyRequest = async (userId) => {
  const student = await StudentProfile.findOne({ user: userId });
  if (!student) {
    throw new ApiError(404, 'Student profile not found');
  }

  const assignedLibrary = await resolveStudentAssignedLibrary(student);

  const request = await TCClearanceRequest.findOne({ student: student._id })
    .sort({ createdAt: -1 })
    .populate('assignedLibrary', 'name code location')
    .populate('reviewedBy', 'username');

  // Compute live obligations
  const activeBorrowsCount = await BorrowTransaction.countDocuments({
    student: student._id,
    status: { $in: [BORROWED_STATUS_ENUM('BORROWED'), BORROWED_STATUS_ENUM('OVERDUE')] }
  });

  const pendingFines = await FineTransaction.find({
    student: student._id,
    status: 'PENDING'
  });
  const pendingFineTotal = pendingFines.reduce((sum, f) => sum + (f.amount || 0), 0);

  return {
    student: {
      _id: student._id,
      name: student.name,
      rollNumber: student.rollNumber,
      department: student.department,
      academicYear: student.academicYear,
      email: student.email,
      phone: student.phone,
      campusCode: student.campusCode,
      assignedLibrary: assignedLibrary
    },
    request,
    obligations: {
      activeBorrowsCount,
      pendingFineTotal,
      isEligible: activeBorrowsCount === 0 && pendingFineTotal === 0
    }
  };
};

// Helper for status enums safely
function BORROWED_STATUS_ENUM(val) {
  return BORROW_STATUS[val] || val;
}

/**
 * Resolves or validates the authenticated librarian's profile and assigned library.
 * Derives assigned library strictly from DB / authenticated librarian record.
 */
const getLibrarianAssignedLibrary = async (callingUserOrId) => {
  if (!callingUserOrId) {
    throw new ApiError(400, 'Librarian is not assigned to any library');
  }

  const userId = typeof callingUserOrId === 'object'
    ? (callingUserOrId._id || callingUserOrId.id)
    : callingUserOrId;

  if (!userId) {
    throw new ApiError(400, 'Librarian is not assigned to any library');
  }

  const profile = await LibrarianProfile.findOne({ user: userId }).populate('assignedLibrary');
  if (!profile || !profile.assignedLibrary) {
    throw new ApiError(400, 'Librarian is not assigned to any library');
  }

  return { profile, library: profile.assignedLibrary };
};

/**
 * Get all TC Clearance requests for a librarian's assigned library.
 */
const getRequestsForLibrarian = async (librarianUserId, queryParams = {}) => {
  const { profile: librarianProfile, library: assignedLib } = await getLibrarianAssignedLibrary(librarianUserId);
  const assignedLibId = assignedLib._id;

  const filter = { assignedLibrary: assignedLibId };

  if (queryParams.status && queryParams.status !== 'ALL') {
    filter.status = queryParams.status.toUpperCase();
  }

  if (queryParams.search) {
    const searchRegex = new RegExp(queryParams.search.trim(), 'i');
    filter.$or = [
      { rollNumber: searchRegex },
      { studentName: searchRegex }
    ];
  }

  const requests = await TCClearanceRequest.find(filter)
    .sort({ createdAt: -1 })
    .populate('student', 'name rollNumber department academicYear email section phone')
    .populate('assignedLibrary', 'name code')
    .populate('reviewedBy', 'username');

  // Counts by status for librarian tab badges
  const counts = {
    pending: await TCClearanceRequest.countDocuments({ assignedLibrary: assignedLibId, status: 'PENDING' }),
    approved: await TCClearanceRequest.countDocuments({ assignedLibrary: assignedLibId, status: 'APPROVED' }),
    rejected: await TCClearanceRequest.countDocuments({ assignedLibrary: assignedLibId, status: 'REJECTED' }),
    all: await TCClearanceRequest.countDocuments({ assignedLibrary: assignedLibId })
  };

  return {
    requests,
    counts,
    library: {
      _id: assignedLib._id,
      name: assignedLib.name,
      code: assignedLib.code
    }
  };
};

/**
 * Get single request details including real-time library obligation check.
 */
const getRequestDetails = async (requestId, callingUser) => {
  const request = await TCClearanceRequest.findById(requestId)
    .populate('student')
    .populate('assignedLibrary', 'name code location')
    .populate('reviewedBy', 'username');

  if (!request) {
    throw new ApiError(404, 'TC Clearance request not found');
  }

  // Authorization check
  if (callingUser.role === ROLES.STUDENT) {
    const studentUserId = (callingUser._id || callingUser.id).toString();
    if (request.user.toString() !== studentUserId) {
      throw new ApiError(403, 'Unauthorized access to TC clearance request');
    }
  } else if (callingUser.role === ROLES.LIBRARIAN) {
    const { library: librarianLib } = await getLibrarianAssignedLibrary(callingUser);
    const libId = librarianLib._id.toString();
    const requestLibId = (request.assignedLibrary._id || request.assignedLibrary).toString();
    if (requestLibId !== libId) {
      throw new ApiError(403, 'Unauthorized: Request belongs to another library');
    }
  }

  // Real-time obligation checks
  const activeBorrows = await BorrowTransaction.find({
    student: request.student._id,
    status: { $in: [BORROWED_STATUS_ENUM('BORROWED'), BORROWED_STATUS_ENUM('OVERDUE')] }
  }).populate({
    path: 'bookCopy',
    populate: { path: 'book', select: 'title isbn author' }
  });

  const formattedBorrows = activeBorrows.map((b) => ({
    transactionId: b._id,
    bookTitle: b.bookCopy?.book?.title || 'Unknown Title',
    isbn: b.bookCopy?.book?.isbn || 'N/A',
    barcode: b.bookCopy?.barcode || 'N/A',
    issueDate: b.issueDate,
    dueDate: b.dueDate,
    status: b.status
  }));

  const pendingFines = await FineTransaction.find({
    student: request.student._id,
    status: 'PENDING'
  }).populate('borrowTransaction');

  const formattedFines = pendingFines.map((f) => ({
    fineTransactionId: f._id,
    amount: f.amount,
    reason: f.reason || 'Overdue Book Fine',
    status: f.status,
    borrowTransactionId: f.borrowTransaction?._id || f.borrowTransaction
  }));

  const pendingFineTotal = formattedFines.reduce((sum, f) => sum + (f.amount || 0), 0);
  const activeBorrowsCount = formattedBorrows.length;
  const isEligibleForNoDue = activeBorrowsCount === 0 && pendingFineTotal === 0;

  return {
    request,
    activeBorrows: formattedBorrows,
    pendingFines: formattedFines,
    activeBorrowsCount,
    pendingFineTotal,
    isEligibleForNoDue
  };
};

/**
 * Librarian approves a TC Clearance Request.
 */
const approveRequest = async (requestId, librarianUserId) => {
  const { profile: librarianProfile, library: librarianLib } = await getLibrarianAssignedLibrary(librarianUserId);

  const request = await TCClearanceRequest.findById(requestId);
  if (!request) {
    throw new ApiError(404, 'TC Clearance request not found');
  }

  // Cross-library enforcement
  const librarianLibId = librarianLib._id.toString();
  const requestLibId = (request.assignedLibrary._id || request.assignedLibrary).toString();
  if (requestLibId !== librarianLibId) {
    throw new ApiError(403, 'Unauthorized: This request belongs to another library');
  }

  // Status check (prevent double approval/conflict)
  if (request.status !== 'PENDING') {
    throw new ApiError(409, `Request is no longer PENDING. Current status is ${request.status}.`);
  }

  // RE-CHECK LIVE OBLIGATIONS AT APPROVAL TIME (Requirement 10 & 24)
  const activeBorrowsCount = await BorrowTransaction.countDocuments({
    student: request.student,
    status: { $in: [BORROWED_STATUS_ENUM('BORROWED'), BORROWED_STATUS_ENUM('OVERDUE')] }
  });

  const pendingFines = await FineTransaction.find({
    student: request.student,
    status: 'PENDING'
  });
  const pendingFineTotal = pendingFines.reduce((sum, f) => sum + (f.amount || 0), 0);

  if (activeBorrowsCount > 0) {
    throw new ApiError(400, `Cannot approve: Student has ${activeBorrowsCount} active unreturned borrowed book(s).`);
  }

  if (pendingFineTotal > 0) {
    throw new ApiError(400, `Cannot approve: Student has outstanding library fines of ₹${pendingFineTotal}.`);
  }

  // Update status
  const reviewerId = typeof librarianUserId === 'object' ? (librarianUserId._id || librarianUserId.id) : librarianUserId;
  request.status = 'APPROVED';
  request.reviewedBy = reviewerId;
  request.reviewedByName = librarianProfile.name;
  request.reviewedAt = new Date();
  request.approvedAt = new Date();
  await request.save();

  // Notify student
  await Notification.create({
    recipientUser: request.user,
    type: 'TC_CLEARANCE',
    title: 'No Due Certificate Approved!',
    message: `Your No Due / TC Clearance request has been APPROVED by ${librarianProfile.name} (${librarianLib.name}). You can now download your digital No Due Form.`,
    relatedEntity: { requestId: request._id }
  }).catch(() => {});

  return request;
};

/**
 * Librarian rejects a TC Clearance Request.
 */
const rejectRequest = async (requestId, librarianUserId, rejectionReason) => {
  if (!rejectionReason || !rejectionReason.trim()) {
    throw new ApiError(400, 'Rejection reason is required when rejecting a request');
  }

  const { profile: librarianProfile, library: librarianLib } = await getLibrarianAssignedLibrary(librarianUserId);

  const request = await TCClearanceRequest.findById(requestId);
  if (!request) {
    throw new ApiError(404, 'TC Clearance request not found');
  }

  // Cross-library enforcement
  const librarianLibId = librarianLib._id.toString();
  const requestLibId = (request.assignedLibrary._id || request.assignedLibrary).toString();
  if (requestLibId !== librarianLibId) {
    throw new ApiError(403, 'Unauthorized: This request belongs to another library');
  }

  if (request.status !== 'PENDING') {
    throw new ApiError(409, `Request is no longer PENDING. Current status is ${request.status}.`);
  }

  const reviewerId = typeof librarianUserId === 'object' ? (librarianUserId._id || librarianUserId.id) : librarianUserId;
  request.status = 'REJECTED';
  request.rejectionReason = rejectionReason.trim();
  request.reviewedBy = reviewerId;
  request.reviewedByName = librarianProfile.name;
  request.reviewedAt = new Date();
  await request.save();

  // Notify student
  await Notification.create({
    recipientUser: request.user,
    type: 'TC_CLEARANCE',
    title: 'No Due Request Rejected',
    message: `Your No Due / TC Clearance request was rejected. Reason: ${rejectionReason.trim()}`,
    relatedEntity: { requestId: request._id }
  }).catch(() => {});

  return request;
};

module.exports = {
  resolveStudentAssignedLibrary,
  createRequest,
  getMyRequest,
  getRequestsForLibrarian,
  getRequestDetails,
  approveRequest,
  rejectRequest
};
