const User = require('../models/user.model');
const FacultyProfile = require('../models/facultyProfile.model');
const BorrowTransaction = require('../models/borrowTransaction.model');
const FineTransaction = require('../models/fineTransaction.model');
const { ROLES } = require('../config/constants');
const { hashPassword } = require('../utils/password');
const ApiError = require('../utils/apiError');
const { runInTransaction } = require('../utils/transaction');

const registerFaculty = async (payload) => {
  const { facultyId, name, fullName, email, phone, password, rollNumber, gender, academicYear, section } = payload;
  const resolvedName = (fullName || name || '').trim();

  // Reject malformed mixed payloads containing student fields
  if (rollNumber || gender || academicYear || section) {
    throw new ApiError(400, 'Invalid payload: Faculty registration cannot contain student-specific fields (gender, academic year, section, roll number)');
  }

  if (!facultyId || !resolvedName || !email || !phone || !password) {
    throw new ApiError(400, 'Faculty ID, Full Name, Email, Phone, and Password are required');
  }

  const cleanFacultyId = facultyId.trim().toUpperCase();
  const cleanEmail = email.trim().toLowerCase();
  const cleanPhone = phone.trim();

  // Check unique constraints (409 Conflict)
  const existingUser = await User.findOne({ username: cleanFacultyId.toLowerCase() });
  if (existingUser) {
    throw new ApiError(409, `Faculty ID '${cleanFacultyId}' is already registered`);
  }

  const existingProfileByFacultyId = await FacultyProfile.findOne({ facultyId: cleanFacultyId });
  if (existingProfileByFacultyId) {
    throw new ApiError(409, `Faculty ID '${cleanFacultyId}' is already registered`);
  }

  const existingProfileByEmail = await FacultyProfile.findOne({ email: cleanEmail });
  if (existingProfileByEmail) {
    throw new ApiError(409, `Email '${cleanEmail}' is already registered`);
  }

  const existingUserByEmail = await User.findOne({ username: cleanEmail });
  if (existingUserByEmail) {
    throw new ApiError(409, `Email '${cleanEmail}' is already registered`);
  }

  const hashedPassword = await hashPassword(password);

  return await runInTransaction(async (session) => {
    const opts = session ? { session } : {};
    let newUser = null;

    try {
      const users = await User.create(
        [
          {
            username: cleanFacultyId.toLowerCase(),
            password: hashedPassword,
            role: ROLES.FACULTY,
            isActive: true
          }
        ],
        opts
      );
      newUser = users[0];

      const profiles = await FacultyProfile.create(
        [
          {
            user: newUser._id,
            facultyId: cleanFacultyId,
            name: resolvedName,
            department: 'FACULTY',
            email: cleanEmail,
            phone: cleanPhone
          }
        ],
        opts
      );
      const facultyProfile = profiles[0];

      return {
        id: newUser._id,
        facultyId: facultyProfile.facultyId,
        name: facultyProfile.name,
        fullName: facultyProfile.name,
        email: facultyProfile.email,
        phone: facultyProfile.phone,
        role: ROLES.FACULTY,
        isActive: newUser.isActive,
        createdAt: facultyProfile.createdAt
      };
    } catch (err) {
      if (!session && newUser?._id) {
        await User.findByIdAndDelete(newUser._id).catch(() => {});
      }
      throw err;
    }
  });
};

const getFacultyProfile = async (userId) => {
  const user = await User.findById(userId);
  if (!user || user.role !== ROLES.FACULTY) {
    throw new ApiError(44, 'Faculty account not found');
  }

  const profile = await FacultyProfile.findOne({ user: userId });
  if (!profile) {
    throw new ApiError(404, 'Faculty profile not found');
  }

  // Calculate active loans, overdue count, borrowing count, total pending fines
  const activeLoans = await BorrowTransaction.countDocuments({
    faculty: profile._id,
    status: { $in: ['BORROWED', 'OVERDUE'] }
  });

  const overdueCount = await BorrowTransaction.countDocuments({
    faculty: profile._id,
    status: 'OVERDUE'
  });

  const totalBorrowings = await BorrowTransaction.countDocuments({
    faculty: profile._id
  });

  const pendingFinesRes = await BorrowTransaction.aggregate([
    { $match: { faculty: profile._id, finePaid: false, fineAmount: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: '$fineAmount' } } }
  ]);
  const pendingFines = pendingFinesRes.length > 0 ? pendingFinesRes[0].total : 0;

  return {
    id: user._id,
    facultyId: profile.facultyId,
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    role: ROLES.FACULTY,
    isActive: user.isActive,
    stats: {
      activeLoans,
      overdueCount,
      totalBorrowings,
      pendingFines
    },
    createdAt: profile.createdAt
  };
};

const getFacultyBorrowings = async (userId) => {
  const profile = await FacultyProfile.findOne({ user: userId });
  if (!profile) {
    throw new ApiError(404, 'Faculty profile not found');
  }

  const borrowings = await BorrowTransaction.find({ faculty: profile._id })
    .populate('masterBook', 'title author isbn category branch coverImage')
    .populate('bookCopy', 'copyNumber barcode status')
    .populate('library', 'name code')
    .sort({ createdAt: -1 });

  return borrowings;
};

const getFacultyFines = async (userId) => {
  const profile = await FacultyProfile.findOne({ user: userId });
  if (!profile) {
    throw new ApiError(404, 'Faculty profile not found');
  }

  const fines = await BorrowTransaction.find({
    faculty: profile._id,
    fineAmount: { $gt: 0 }
  })
    .populate('masterBook', 'title author isbn')
    .populate('library', 'name code')
    .sort({ createdAt: -1 });

  return fines;
};

const getFacultyDetailsForStaff = async (facultyId, callingUser) => {
  if (!facultyId) {
    throw new ApiError(400, 'Faculty ID is required');
  }

  const cleanFacultyId = facultyId.trim().toUpperCase();
  const profile = await FacultyProfile.findOne({ facultyId: cleanFacultyId }).populate('user', 'username email role isActive createdAt');
  if (!profile) {
    throw new ApiError(404, `Faculty member with ID ${cleanFacultyId} not found`);
  }

  const activeBorrows = await BorrowTransaction.find({
    faculty: profile._id,
    status: { $in: ['BORROWED', 'OVERDUE'] }
  })
    .populate({
      path: 'bookCopy',
      populate: { path: 'book', select: 'title author isbn coverImage' }
    })
    .populate('library', 'name code')
    .sort({ issueDate: -1 });

  const currentDate = new Date();
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

  const allBorrows = await BorrowTransaction.find({ faculty: profile._id })
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

    const totalFine = b.fineAmount || 0;
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
      totalFine,
      fineStatus: totalFine > 0 ? (b.finePaid ? 'PAID' : 'PENDING') : 'N/A',
      libraryName: b.library?.name || 'Central Library'
    };
  });

  const fines = await BorrowTransaction.find({
    faculty: profile._id,
    fineAmount: { $gt: 0 }
  })
    .populate({
      path: 'bookCopy',
      populate: { path: 'book', select: 'title author' }
    })
    .sort({ createdAt: -1 });

  const formattedFines = fines.map((f) => ({
    fineId: f._id,
    bookTitle: f.bookCopy?.book?.title || 'Library Book',
    amount: f.fineAmount,
    status: f.finePaid ? 'PAID' : 'PENDING',
    createdAt: f.createdAt
  }));

  const pendingFinesTotal = fines.filter(f => !f.finePaid).reduce((sum, f) => sum + f.fineAmount, 0);

  const userId = profile.user?._id || profile.user;
  const Notification = require('../models/notification.model');
  const VisitLog = require('../models/visitLog.model');

  const notifications = await Notification.find({ recipientUser: userId }).sort({ createdAt: -1 });

  const visits = await VisitLog.find({
    $or: [{ faculty: profile._id }, { userId: profile.facultyId }, { user: userId }]
  })
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

  return {
    userType: 'FACULTY',
    faculty: {
      _id: profile._id,
      facultyId: profile.facultyId,
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      status: profile.user?.isActive ? 'ACTIVE' : 'INACTIVE',
      registrationDate: profile.createdAt
    },
    outstandingFine: pendingFinesTotal,
    currentBorrows: formattedCurrentBorrows,
    borrowHistory: formattedBorrowHistory,
    fines: formattedFines,
    notifications: notifications.map(n => ({
      notificationId: n._id,
      type: n.type,
      title: n.title,
      message: n.message,
      createdAt: n.createdAt
    })),
    visits: formattedVisits
  };
};

module.exports = {
  registerFaculty,
  getFacultyProfile,
  getFacultyBorrowings,
  getFacultyFines,
  getFacultyDetailsForStaff
};
