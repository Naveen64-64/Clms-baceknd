const User = require('../models/user.model');
const StudentProfile = require('../models/studentProfile.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const Library = require('../models/library.model');
const Notification = require('../models/notification.model');
const AdminSetting = require('../models/adminSetting.model');
const Book = require('../models/book.model');
const BookCopy = require('../models/bookCopy.model');
const { ROLES, DEPOSIT_CONSTANTS, DEPOSIT_TRANSACTION_TYPES } = require('../config/constants');
const { hashPassword } = require('../utils/password');
const { runInTransaction } = require('../utils/transaction');
const ApiError = require('../utils/apiError');

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const registerStudent = async (studentData, registeredByUserId) => {
  const { rollNumber, name, gender, department, academicYear, email, phone, password } = studentData;

  // Service-level enforcement: ONLY Librarians can register students (Admin cannot register students)
  const registeredByUser = await User.findById(registeredByUserId);
  if (!registeredByUser || registeredByUser.role !== ROLES.LIBRARIAN) {
    throw new ApiError(403, 'Access denied: Student registration is strictly restricted to Librarians');
  }

  // Get librarian profile and assigned library for branch validation & isolation
  const LibrarianProfile = require('../models/librarianProfile.model');
  const librarianProfile = await LibrarianProfile.findOne({ user: registeredByUserId }).populate('assignedLibrary');
  if (!librarianProfile || !librarianProfile.assignedLibrary) {
    throw new ApiError(400, 'Librarian is not assigned to any library');
  }

  const assignedLibCode = (librarianProfile.assignedLibrary.code || '').toUpperCase();
  const formattedDept = department.trim().toUpperCase();
  const formattedGender = gender.trim().toUpperCase();

  // Validate Gender restriction for KIET Women's Library
  if ((assignedLibCode === 'KIET_WOMEN' || librarianProfile.assignedLibrary.isWomenOnly) && formattedGender === 'MALE') {
    throw new ApiError(400, "Male students cannot be registered through KIET Women's Library.");
  }

  const ALLOWED_BRANCHES_BY_LIBRARY = {
    KIET_MAIN: ['AIDS', 'CSM', 'CSD', 'CAI', 'CSC'],
    KIET_2: ['AIDS', 'CSM', 'CSD', 'CAI', 'CSC'],
    KIET_WOMEN: ['AIDS', 'CAI', 'CSM'],
  };

  const validBranches = ALLOWED_BRANCHES_BY_LIBRARY[assignedLibCode] || ['AIDS', 'CSM', 'CSD', 'CAI', 'CSC'];
  if (!validBranches.includes(formattedDept)) {
    throw new ApiError(400, `Invalid department '${formattedDept}' for assigned library '${librarianProfile.assignedLibrary.name}'. Allowed branches: ${validBranches.join(', ')}`);
  }

  const formattedRoll = rollNumber.trim().toUpperCase();
  const formattedUsername = formattedRoll.toLowerCase();
  
  const campusCodeMatch = formattedRoll.match(/^\d{2}(B2|6Q|JN)/);
  if (!campusCodeMatch) {
    throw new ApiError(400, 'Invalid Roll Number format. Cannot extract campus code.');
  }
  const campusCode = campusCodeMatch[1];
  
  const { WOMEN_CAMPUS_CODE, GENDERS } = require('../config/constants');
  if (campusCode === WOMEN_CAMPUS_CODE && gender.toUpperCase() === GENDERS.MALE) {
    throw new ApiError(400, 'JN campus code is strictly restricted to Female students');
  }

  const existingUser = await User.findOne({ username: formattedUsername });
  if (existingUser) {
    throw new ApiError(400, `Student with Roll Number ${formattedRoll} is already registered`);
  }

  const hashedPassword = await hashPassword(password || formattedUsername);

  return await runInTransaction(async (session) => {
    const opts = session ? { session } : {};

    // 1. Create User
    const [newUser] = await User.create(
      [
        {
          username: formattedUsername,
          password: hashedPassword,
          role: ROLES.STUDENT,
          isActive: true
        }
      ],
      opts
    );

    // 2. Create Student Profile
    const [newStudentProfile] = await StudentProfile.create(
      [
        {
          user: newUser._id,
          rollNumber: formattedRoll,
          campusCode: campusCode,
          name: name.trim(),
          gender: gender.toUpperCase(),
          department: formattedDept,
          academicYear: Number(academicYear),
          section: 'A',
          email: email ? email.trim().toLowerCase() : '',
          phone: phone ? phone.trim() : '',
          securityDepositBalance: 0
        }
      ],
      opts
    );

    // 3. Create REGISTRATION Notification for Student
    await Notification.create(
      [
        {
          recipientUser: newUser._id,
          type: 'REGISTRATION',
          title: 'Welcome to KIET Library!',
          message: `Your library account has been successfully created with Roll Number ${formattedRoll}.`,
          relatedEntity: { studentProfileId: newStudentProfile._id }
        }
      ],
      opts
    );

    return {
      rollNumber: newStudentProfile.rollNumber,
      name: newStudentProfile.name,
      gender: newStudentProfile.gender,
      department: newStudentProfile.department,
      academicYear: newStudentProfile.academicYear,
      section: newStudentProfile.section
    };
  });
};

const getStudentByRollNumber = async (rollNumber) => {
  const formattedRoll = rollNumber.trim().toUpperCase();
  const student = await StudentProfile.findOne({ rollNumber: formattedRoll }).populate('user', 'username role isActive');
  if (!student) {
    throw new ApiError(404, `Student with Roll Number ${formattedRoll} not found`);
  }
  return student;
};

const getTcClearance = async (rollNumber, callingUser) => {
  if (!rollNumber) throw new ApiError(400, 'Student Roll Number is required');
  const formattedRoll = rollNumber.trim().toUpperCase();

  const student = await StudentProfile.findOne({ rollNumber: formattedRoll }).populate('user', 'username email isActive');
  if (!student) {
    throw new ApiError(404, `Student with Roll Number ${formattedRoll} not found`);
  }

  const LibrarianProfile = require('../models/librarianProfile.model');
  const BorrowTransaction = require('../models/borrowTransaction.model');
  const FineTransaction = require('../models/fineTransaction.model');

  if (callingUser && callingUser.role === ROLES.LIBRARIAN) {
    const profile = await LibrarianProfile.findOne({ user: callingUser.id || callingUser._id });
    if (!profile || !profile.assignedLibrary) {
      throw new ApiError(403, 'Access denied: Mandatory librarian profile or assigned library missing');
    }
  }

  const activeBorrows = await BorrowTransaction.find({
    student: student._id,
    status: { $in: ['BORROWED', 'OVERDUE'] }
  }).populate({
    path: 'bookCopy',
    populate: { path: 'book', select: 'title author isbn' }
  }).populate('library', 'name code');

  const pendingFines = await FineTransaction.find({
    student: student._id,
    status: 'PENDING'
  }).populate({
    path: 'borrowTransaction',
    populate: { path: 'bookCopy', populate: { path: 'book', select: 'title' } }
  });

  const pendingFineTotal = pendingFines.reduce((sum, f) => {
    const out = f.outstandingAmount !== undefined ? f.outstandingAmount : (f.amount || 0);
    return sum + out;
  }, 0);

  const VisitLog = require('../models/visitLog.model');
  const activeVisit = await VisitLog.findOne({
    student: student._id,
    checkoutTime: null
  });

  const reasons = [];
  if (activeBorrows.length > 0) {
    reasons.push(`${activeBorrows.length} borrowed book(s) not returned`);
  }
  if (pendingFines.length > 0 || pendingFineTotal > 0) {
    reasons.push(`Outstanding fine of ₹${pendingFineTotal} pending payment`);
  }
  if (activeVisit) {
    reasons.push('Student currently checked in to library (active visit in progress)');
  }

  const isClear = activeBorrows.length === 0 && pendingFineTotal === 0 && !activeVisit;

  return {
    student: {
      _id: student._id,
      rollNumber: student.rollNumber,
      name: student.name,
      gender: student.gender,
      department: student.department,
      academicYear: student.academicYear,
      section: student.section,
      email: student.email,
      phone: student.phone
    },
    activeBorrowsCount: activeBorrows.length,
    activeBorrows: activeBorrows.map((b) => ({
      transactionId: b._id,
      bookTitle: b.bookCopy?.book?.title || 'Unknown Book',
      barcode: b.bookCopy?.barcode,
      libraryName: b.library?.name,
      issueDate: b.issueDate,
      dueDate: b.dueDate,
      status: b.status
    })),
    pendingFinesCount: pendingFines.length,
    pendingFineTotal,
    pendingFines: pendingFines.map((f) => ({
      fineTransactionId: f._id,
      borrowTransactionId: f.borrowTransaction?._id,
      bookTitle: f.borrowTransaction?.bookCopy?.book?.title || 'Overdue Book',
      amount: f.outstandingAmount !== undefined ? f.outstandingAmount : f.amount,
      outstandingAmount: f.outstandingAmount !== undefined ? f.outstandingAmount : f.amount,
      originalAmount: f.originalAmount !== undefined ? f.originalAmount : f.amount,
      paidAmount: f.paidAmount || 0,
      createdAt: f.createdAt
    })),
    status: isClear ? 'CLEAR' : 'HOLD',
    decision: isClear ? 'READY FOR TC' : 'HOLD',
    reasons
  };
};

const getAllStudents = async (query = {}) => {
  const { department, gender, academicYear, search, page = 1, limit = 20 } = query;
  const filter = {};

  if (department) filter.department = department.trim();
  if (gender) filter.gender = gender.toUpperCase();
  if (academicYear) filter.academicYear = Number(academicYear);

  if (search) {
    const safeSearch = escapeRegex(search.trim());
    filter.$or = [
      { rollNumber: { $regex: safeSearch, $options: 'i' } },
      { name: { $regex: safeSearch, $options: 'i' } }
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const students = await StudentProfile.find(filter)
    .populate('user', 'username isActive createdAt')
    .sort({ rollNumber: 1 })
    .skip(skip)
    .limit(limitNum);

  const total = await StudentProfile.countDocuments(filter);

  return {
    students,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    }
  };
};

const clearStudentData = async (rollNumber, confirmationRollNumber, callingUser) => {
  if (!callingUser || (callingUser.role !== ROLES.LIBRARIAN && callingUser.role !== ROLES.ADMIN)) {
    throw new ApiError(403, 'Access denied: Student Data Clearance is strictly restricted to Librarians and Admins');
  }

  if (!rollNumber || !confirmationRollNumber) {
    throw new ApiError(400, 'Student Roll Number and Confirmation Roll Number are required');
  }

  const formattedRoll = rollNumber.trim().toUpperCase();
  const formattedConfirmRoll = confirmationRollNumber.trim().toUpperCase();

  if (formattedRoll !== formattedConfirmRoll) {
    throw new ApiError(400, `Confirmation Roll Number (${formattedConfirmRoll}) does not match target student Roll Number (${formattedRoll})`);
  }

  const student = await StudentProfile.findOne({ rollNumber: formattedRoll }).populate('user');
  if (!student) {
    throw new ApiError(404, `Student library account with Roll Number ${formattedRoll} not found or already cleared.`);
  }

  const LibrarianProfile = require('../models/librarianProfile.model');
  const BorrowTransaction = require('../models/borrowTransaction.model');
  const FineTransaction = require('../models/fineTransaction.model');
  const VisitLog = require('../models/visitLog.model');
  const AuditLog = require('../models/auditLog.model');

  if (callingUser.role === ROLES.LIBRARIAN) {
    const profile = await LibrarianProfile.findOne({ user: callingUser.id || callingUser._id });
    if (!profile || !profile.assignedLibrary) {
      throw new ApiError(403, 'Access denied: Mandatory librarian profile or assigned library missing');
    }
  }

  // Database Eligibility Re-check Immediately Before Execution
  const activeBorrowsCount = await BorrowTransaction.countDocuments({
    student: student._id,
    status: { $in: ['BORROWED', 'OVERDUE'] }
  });
  if (activeBorrowsCount > 0) {
    throw new ApiError(400, `Student cannot be cleared because ${activeBorrowsCount} unreturned borrowed book(s) remain`);
  }

  const pendingFines = await FineTransaction.find({ student: student._id, status: 'PENDING' });
  const pendingFineTotal = pendingFines.reduce((sum, f) => sum + (f.outstandingAmount !== undefined ? f.outstandingAmount : (f.amount || 0)), 0);
  if (pendingFineTotal > 0) {
    throw new ApiError(400, `Student cannot be cleared because outstanding fines (₹${pendingFineTotal}) remain unpaid`);
  }

  const activeVisitCount = await VisitLog.countDocuments({ student: student._id, checkoutTime: null });
  if (activeVisitCount > 0) {
    throw new ApiError(400, 'Student cannot be cleared because an active library visit is in progress');
  }

  const userId = student.user._id || student.user;

  return await runInTransaction(async (session) => {
    const opts = session ? { session } : {};

    // 1. Audit Log Entry BEFORE deletion to preserve user/role metadata
    await AuditLog.create(
      [
        {
          performedBy: callingUser.id || callingUser._id,
          username: callingUser.username || 'Staff',
          role: callingUser.role,
          action: 'STUDENT_DATA_CLEARED',
          domain: 'STUDENTS',
          details: {
            rollNumber: formattedRoll,
            studentName: student.name,
            department: student.department,
            decision: 'DATA_CLEARED'
          }
        }
      ],
      opts
    );

    // 2. Anonymize Borrow Transactions (preserve financial/inventory/historical records)
    await BorrowTransaction.updateMany({ student: student._id }, { $set: { student: null } }, opts);

    // 3. Anonymize Fine Transactions (preserve accounting audit records)
    await FineTransaction.updateMany({ student: student._id }, { $set: { student: null } }, opts);

    // 4. Anonymize Visit Logs (preserve entry/exit occupancy analytics)
    await VisitLog.updateMany({ student: student._id }, { $set: { student: null, rollNumber: 'ANONYMIZED' } }, opts);

    // 5. Delete recipient Notifications for this student user
    await Notification.deleteMany({ recipientUser: userId }, opts);

    // 6. Delete StudentProfile Document
    await StudentProfile.findByIdAndDelete(student._id, opts);

    // 7. Delete User Authentication Document
    await User.findByIdAndDelete(userId, opts);

    return {
      cleared: true,
      status: 'CLEARED',
      rollNumber: formattedRoll,
      studentName: student.name
    };
  });
};

const getStudentDetails = async (rollNumber, callingUser) => {
  if (!rollNumber) {
    throw new ApiError(400, 'Student Roll Number is required');
  }
  const formattedRoll = rollNumber.trim().toUpperCase();

  const student = await StudentProfile.findOne({ rollNumber: formattedRoll }).populate('user', 'username email role isActive createdAt');
  if (!student) {
    // If not a student, check if this identifier belongs to a Faculty member
    const FacultyProfile = require('../models/facultyProfile.model');
    const faculty = await FacultyProfile.findOne({ facultyId: formattedRoll });
    if (faculty) {
      const facultyService = require('./faculty.service');
      return await facultyService.getFacultyDetailsForStaff(formattedRoll, callingUser);
    }

    throw new ApiError(404, `Student library account with Roll Number ${formattedRoll} not found or already cleared.`);
  }

  const LibrarianProfile = require('../models/librarianProfile.model');
  const BorrowTransaction = require('../models/borrowTransaction.model');
  const FineTransaction = require('../models/fineTransaction.model');
  const VisitLog = require('../models/visitLog.model');
  const Notification = require('../models/notification.model');

  let assignedLib = null;
  if (callingUser && callingUser.role === ROLES.LIBRARIAN) {
    const profile = await LibrarianProfile.findOne({ user: callingUser.id || callingUser._id }).populate('assignedLibrary');
    if (!profile || !profile.assignedLibrary) {
      throw new ApiError(403, 'Access denied: Mandatory librarian profile or assigned library missing');
    }
    assignedLib = profile.assignedLibrary;

    // Gender access restriction for Women's Library
    if (student.gender === 'MALE' && (assignedLib.isWomenOnly || assignedLib.code === 'KIET_WOMEN')) {
      throw new ApiError(403, "Access denied: Male students are strictly prohibited from accessing KIET Women's Library records");
    }
  }

  const currentDate = new Date();

  // 1. Current Active Borrows
  const activeBorrows = await BorrowTransaction.find({
    student: student._id,
    status: { $in: ['BORROWED', 'OVERDUE'] }
  })
    .populate({
      path: 'bookCopy',
      populate: { path: 'book', select: 'title author isbn coverImage' }
    })
    .populate('library', 'name code')
    .sort({ issueDate: -1 });

  const formattedCurrentBorrows = activeBorrows.map((b) => {
    let overdueDays = 0;
    let currentFine = 0;
    if (currentDate > b.dueDate) {
      const diffTime = Math.max(0, currentDate - b.dueDate);
      overdueDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      currentFine = overdueDays * 1;
    }
    return {
      transactionId: b._id,
      bookTitle: b.bookCopy?.book?.title || 'Unknown Book',
      bookId: b.bookCopy?.book?._id || '',
      barcode: b.bookCopy?.barcode || '',
      issueDate: b.issueDate,
      dueDate: b.dueDate,
      status: overdueDays > 0 ? 'OVERDUE' : b.status,
      overdueDays,
      currentFine,
      libraryName: b.library?.name || 'Central Library'
    };
  });

  // 2. Complete Borrowing History
  const allBorrows = await BorrowTransaction.find({ student: student._id })
    .populate({
      path: 'bookCopy',
      populate: { path: 'book', select: 'title author isbn category' }
    })
    .populate('library', 'name code')
    .sort({ issueDate: -1 });

  const formattedBorrowHistory = allBorrows.map((b) => {
    let overdueDays = 0;
    if (b.returnDate && b.dueDate && b.returnDate > b.dueDate) {
      overdueDays = Math.floor(Math.max(0, b.returnDate - b.dueDate) / (1000 * 60 * 60 * 24));
    } else if (!b.returnDate && currentDate > b.dueDate) {
      overdueDays = Math.floor(Math.max(0, currentDate - b.dueDate) / (1000 * 60 * 60 * 24));
    }

    const overdueFine = b.overdueFine || 0;
    const conditionFine = b.conditionFine || 0;
    const totalFine = b.fineAmount !== undefined ? b.fineAmount : overdueFine + conditionFine;

    let fineStatus = 'N/A';
    if (totalFine > 0) {
      fineStatus = b.finePaid ? 'PAID' : 'PENDING';
    }

    return {
      transactionId: b._id,
      bookTitle: b.bookCopy?.book?.title || 'Unknown Book',
      bookId: b.bookCopy?.book?._id || '',
      barcode: b.bookCopy?.barcode || '',
      issueDate: b.issueDate,
      dueDate: b.dueDate,
      returnDate: b.returnDate || null,
      returnCondition: b.conditionOnReturn || 'GOOD',
      borrowStatus: b.status,
      overdueDays,
      overdueFine,
      conditionFine,
      totalFine,
      fineStatus,
      libraryName: b.library?.name || 'Central Library'
    };
  });

  // 3. Fine History & Payment History
  const fineTransactions = await FineTransaction.find({ student: student._id })
    .populate({
      path: 'borrowTransaction',
      populate: { path: 'bookCopy', populate: { path: 'book', select: 'title author' } }
    })
    .populate('collectedBy', 'username role')
    .sort({ createdAt: -1 });

  const formattedFines = [];
  const formattedPayments = [];
  let outstandingFineTotal = 0;

  fineTransactions.forEach((f) => {
    const orig = f.originalAmount !== undefined ? f.originalAmount : f.amount;
    const paid = f.paidAmount || 0;
    const out = f.outstandingAmount !== undefined ? f.outstandingAmount : Math.max(0, orig - paid);

    if (f.status === 'PENDING') {
      outstandingFineTotal += out;
    }

    const bookTitle = f.borrowTransaction?.bookCopy?.book?.title || 'Library Item';
    const bookId = f.borrowTransaction?.bookCopy?.book?._id || '';

    formattedFines.push({
      fineId: f._id,
      borrowTransactionId: f.borrowTransaction?._id,
      bookTitle,
      bookId,
      reason: f.reason || 'OVERDUE',
      originalAmount: orig,
      paidAmount: paid,
      outstandingAmount: out,
      status: f.status,
      createdAt: f.createdAt,
      lastPaymentDate: f.updatedAt || f.createdAt
    });

    if (Array.isArray(f.payments)) {
      f.payments.forEach((p, idx) => {
        formattedPayments.push({
          paymentId: p._id || `${f._id}-p${idx}`,
          fineId: f._id,
          bookTitle,
          amount: p.amount,
          paymentMethod: p.paymentMethod || 'CASH',
          previousOutstanding: p.previousOutstanding,
          remainingOutstanding: p.remainingOutstanding,
          createdAt: p.createdAt || f.updatedAt
        });
      });
    }
  });

  formattedPayments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // 4. Notifications
  const userId = student.user?._id || student.user;
  const notifications = await Notification.find({ recipientUser: userId }).sort({ createdAt: -1 });
  const formattedNotifications = notifications.map((n) => ({
    notificationId: n._id,
    type: n.type,
    title: n.title,
    message: n.message,
    isRead: n.isRead,
    createdAt: n.createdAt
  }));

  // 5. Library Visit History (Scoped for Librarian, Unrestricted for Admin)
  const visitFilter = { student: student._id };
  if (callingUser && callingUser.role === ROLES.LIBRARIAN && assignedLib) {
    visitFilter.library = assignedLib._id;
  }

  const visits = await VisitLog.find(visitFilter)
    .populate('library', 'name code')
    .sort({ checkInTime: -1 });

  const formattedVisits = visits.map((v) => ({
    visitId: v._id,
    libraryName: v.library?.name || 'Central Library',
    libraryCode: v.library?.code || '',
    checkInTime: v.checkInTime,
    checkOutTime: v.checkoutTime,
    visitStatus: v.checkoutTime ? 'COMPLETED' : 'INSIDE'
  }));

  // 6. TC Clearance Status
  const activeVisit = visits.find((v) => !v.checkoutTime);
  const activeBorrowsCount = formattedCurrentBorrows.length;
  const isEligibleForTc = activeBorrowsCount === 0 && outstandingFineTotal === 0 && !activeVisit;

  const tcClearance = {
    status: isEligibleForTc ? 'READY_FOR_TC' : 'HOLD',
    decision: isEligibleForTc ? 'READY FOR TC' : 'HOLD',
    outstandingFine: outstandingFineTotal,
    activeBooksCount: activeBorrowsCount,
    activeVisit: Boolean(activeVisit),
    reasons: []
  };

  if (activeBorrowsCount > 0) {
    tcClearance.reasons.push(`${activeBorrowsCount} borrowed book(s) not returned`);
  }
  if (outstandingFineTotal > 0) {
    tcClearance.reasons.push(`Outstanding fine of ₹${outstandingFineTotal} pending payment`);
  }
  if (activeVisit) {
    tcClearance.reasons.push('Student currently checked in to library (active visit in progress)');
  }

  return {
    student: {
      _id: student._id,
      rollNumber: student.rollNumber,
      name: student.name,
      gender: student.gender,
      department: student.department,
      academicYear: student.academicYear,
      section: student.section,
      email: student.email || student.user?.email || '',
      phone: student.phone || '',
      status: student.user?.isActive ? 'ACTIVE' : 'BLOCKED',
      registrationDate: student.createdAt || student.user?.createdAt
    },
    outstandingFine: outstandingFineTotal,
    currentBorrows: formattedCurrentBorrows,
    borrowHistory: formattedBorrowHistory,
    fines: formattedFines,
    payments: formattedPayments,
    notifications: formattedNotifications,
    visits: formattedVisits,
    tcClearance
  };
};


const bulkImportStudents = async (studentsArray, registeredByUserId) => {
  const results = {
    successful: [],
    failed: []
  };

  for (const studentData of studentsArray) {
    try {
      const student = await registerStudent(studentData, registeredByUserId);
      results.successful.push({ rollNumber: student.rollNumber, name: student.name });
    } catch (err) {
      results.failed.push({
        rollNumber: studentData.rollNumber || 'UNKNOWN',
        reason: err.message
      });
    }
  }

  return results;
};

module.exports = {
  registerStudent,
  getStudentByRollNumber,
  getTcClearance,
  getAllStudents,
  clearStudentData,
  getStudentDetails,
  bulkImportStudents
};
