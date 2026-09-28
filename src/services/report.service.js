const mongoose = require('mongoose');
const Library = require('../models/library.model');
const Book = require('../models/book.model');
const BookCopy = require('../models/bookCopy.model');
const StudentProfile = require('../models/studentProfile.model');
const BorrowTransaction = require('../models/borrowTransaction.model');
const VisitLog = require('../models/visitLog.model');
const FineTransaction = require('../models/fineTransaction.model');
const { BORROW_STATUS, BOOK_STATUS, ROLES } = require('../config/constants');

const LibrarianProfile = require('../models/librarianProfile.model');
const ApiError = require('../utils/apiError');
const libraryHoursService = require('./libraryHours.service');

// Resolve Librarian library scope to enforce strict isolation over client parameters (Section 3, 4, 29)
const resolveLibraryScope = async (requestedLibraryId, user) => {
  if (user && user.role === ROLES.LIBRARIAN) {
    const userId = user.id || user._id || user;
    const profile = await LibrarianProfile.findOne({ user: userId });
    if (!profile || !profile.assignedLibrary) {
      throw new ApiError(403, 'Access denied: Mandatory librarian profile or assigned library missing');
    }
    return (profile.assignedLibrary._id || profile.assignedLibrary).toString();
  }
  if (!requestedLibraryId) return null;
  let lib = await Library.findOne({ code: requestedLibraryId });
  if (!lib && mongoose.Types.ObjectId.isValid(requestedLibraryId)) {
    lib = await Library.findById(requestedLibraryId);
  }
  return lib ? lib._id.toString() : requestedLibraryId;
};

// Date range builder helper
const buildDateFilter = (query, dateField = 'createdAt') => {
  const filter = {};
  const { startDate, endDate, month, year } = query;

  if (startDate || endDate) {
    filter[dateField] = {};
    if (startDate) filter[dateField].$gte = new Date(startDate);
    if (endDate) filter[dateField].$lte = new Date(endDate);
  } else if (month || year) {
    const currentYear = year ? parseInt(year, 10) : new Date().getFullYear();
    if (month) {
      const monthIdx = parseInt(month, 10) - 1;
      const start = new Date(currentYear, monthIdx, 1);
      const end = new Date(currentYear, monthIdx + 1, 0, 23, 59, 59);
      filter[dateField] = { $gte: start, $lte: end };
    } else {
      const start = new Date(currentYear, 0, 1);
      const end = new Date(currentYear, 11, 31, 23, 59, 59);
      filter[dateField] = { $gte: start, $lte: end };
    }
  }

  return filter;
};

// 1. Dashboard Summary Report
const getDashboardSummary = async (query = {}, user) => {
  const targetLibraryId = await resolveLibraryScope(query.libraryId, user);

  const libFilter = targetLibraryId ? { _id: targetLibraryId, status: { $ne: 'INACTIVE' } } : { status: { $ne: 'INACTIVE' } };
  const copyFilter = targetLibraryId ? { library: targetLibraryId } : {};
  const borrowFilter = targetLibraryId ? { library: targetLibraryId } : {};
  const visitFilter = targetLibraryId ? { library: targetLibraryId } : {};

  const totalLibraries = await Library.countDocuments(libFilter);
  const totalBooks = await Book.countDocuments({ isRetired: false });
  const totalCopies = await BookCopy.countDocuments({ ...copyFilter, isRetired: false });
  const totalStudents = await StudentProfile.countDocuments();

  const totalIssued = await BorrowTransaction.countDocuments({
    ...borrowFilter,
    status: BORROW_STATUS.BORROWED
  });

  const totalOverdue = await BorrowTransaction.countDocuments({
    ...borrowFilter,
    status: BORROW_STATUS.OVERDUE
  });

  // 1. Resolve any stale active visits from previous days/closing windows
  await libraryHoursService.closeStaleActiveVisits();

  // 2. Enforce operating hours for active occupancy
  const { isOpen } = libraryHoursService.isLibraryOpen();
  let activeVisits = 0;
  if (isOpen) {
    activeVisits = await VisitLog.countDocuments({
      ...visitFilter,
      checkoutTime: null
    });
  }

  const libraries = await Library.find(libFilter);
  const totalCapacity = libraries.reduce((sum, lib) => sum + lib.capacity, 0);
  const availableSeats = Math.max(0, totalCapacity - activeVisits);

  let fineMatch = {};
  if (targetLibraryId) {
    const libBorrows = await BorrowTransaction.find({ library: targetLibraryId }).select('_id');
    fineMatch.borrowTransaction = { $in: libBorrows.map((b) => b._id) };
  }

  const fineStats = await FineTransaction.aggregate([
    { $match: fineMatch },
    {
      $group: {
        _id: null,
        totalFinesCollected: { $sum: '$amount' }
      }
    }
  ]);

  return {
    summary: {
      totalLibraries,
      totalBooks,
      totalCopies,
      totalStudents,
      totalIssued,
      totalOverdue,
      activeVisits,
      totalCapacity,
      availableSeats,
      seatUtilizationPercentage: totalCapacity > 0 ? parseFloat(((activeVisits / totalCapacity) * 100).toFixed(1)) : 0,
      totalDepositBalance: 0,
      eligibleRefundsCount: 0,
      totalFinesCollected: fineStats[0]?.totalFinesCollected || 0
    }
  };
};

// 2. Library Comparison Report
const getLibraryComparison = async (query = {}, user) => {
  const targetLibraryId = await resolveLibraryScope(query.libraryId, user);
  const filter = targetLibraryId ? { _id: targetLibraryId, status: { $ne: 'INACTIVE' } } : { status: { $ne: 'INACTIVE' } };

  await libraryHoursService.closeStaleActiveVisits();
  const { isOpen } = libraryHoursService.isLibraryOpen();

  const libraries = await Library.find(filter).sort({ code: 1 });

  const report = await Promise.all(
    libraries.map(async (lib) => {
      const activeVisits = isOpen
        ? await VisitLog.countDocuments({ library: lib._id, checkoutTime: null })
        : 0;
      const totalCopies = await BookCopy.countDocuments({ library: lib._id, isRetired: false });
      const availableCopies = await BookCopy.countDocuments({ library: lib._id, status: BOOK_STATUS.AVAILABLE, isRetired: false });
      const totalIssued = await BorrowTransaction.countDocuments({ library: lib._id, status: BORROW_STATUS.BORROWED });
      const totalOverdue = await BorrowTransaction.countDocuments({ library: lib._id, status: BORROW_STATUS.OVERDUE });

      return {
        id: lib._id,
        name: lib.name,
        code: lib.code,
        capacity: lib.capacity,
        currentOccupancy: activeVisits,
        availableSeats: Math.max(0, lib.capacity - activeVisits),
        utilizationPercentage: lib.capacity > 0 ? parseFloat(((activeVisits / lib.capacity) * 100).toFixed(1)) : 0,
        totalCopies,
        availableCopies,
        issuedCopies: totalIssued,
        overdueCopies: totalOverdue
      };
    })
  );

  return {
    libraries: report,
    labels: report.map((r) => r.code),
    datasets: [
      { label: 'Total Copies', data: report.map((r) => r.totalCopies) },
      { label: 'Available Copies', data: report.map((r) => r.availableCopies) },
      { label: 'Active Occupancy', data: report.map((r) => r.currentOccupancy) }
    ]
  };
};

// 3. Book Inventory Analytics Report
const getBookAnalytics = async (query = {}, user) => {
  const targetLibraryId = await resolveLibraryScope(query.libraryId, user);
  const copyFilter = targetLibraryId ? { library: targetLibraryId } : {};

  if (query.branch) {
    const uBranch = query.branch.toUpperCase();
    const branchMatch = uBranch === 'CSM' ? { $in: ['CSM', 'AIML'] } : uBranch;
    const matchingBooks = await Book.find({ branch: branchMatch, isRetired: false }).select('_id');
    copyFilter.book = { $in: matchingBooks.map((b) => b._id) };
  }

  const totalBooks = await Book.countDocuments({ isRetired: false });
  const retiredBooks = await Book.countDocuments({ isRetired: true });
  const totalCopies = await BookCopy.countDocuments({ ...copyFilter, isRetired: false });
  const availableCopies = await BookCopy.countDocuments({ ...copyFilter, status: BOOK_STATUS.AVAILABLE, isRetired: false });
  const issuedCopies = await BookCopy.countDocuments({ ...copyFilter, status: BOOK_STATUS.ISSUED, isRetired: false });
  const lostCopies = await BookCopy.countDocuments({ ...copyFilter, status: 'LOST' });
  const damagedCopies = await BookCopy.countDocuments({ ...copyFilter, status: 'DAMAGED' });
  const retiredCopies = await BookCopy.countDocuments({ ...copyFilter, isRetired: true });

  const rawBranchBreakdown = await Book.aggregate([
    { $match: { isRetired: false } },
    { $group: { _id: '$branch', bookCount: { $sum: 1 } } }
  ]);

  const countsMap = {};
  rawBranchBreakdown.forEach((b) => {
    if (b._id) countsMap[b._id] = b.bookCount;
  });

  const finalBranches = ['AIDS', 'CSM', 'CSD', 'CSC', 'CAI'];
  const formattedBranchBreakdown = finalBranches.map((branchCode) => {
    let count = countsMap[branchCode] || 0;
    if (branchCode === 'CSM') {
      count += countsMap['AIML'] || 0;
    }
    return { branch: branchCode, count };
  });

  return {
    inventoryStats: {
      totalBooks,
      retiredBooks,
      totalCopies,
      availableCopies,
      issuedCopies,
      lostCopies,
      damagedCopies,
      retiredCopies
    },
    branchBreakdown: formattedBranchBreakdown,
    rechartsData: [
      { name: 'Available', value: availableCopies },
      { name: 'Issued', value: issuedCopies },
      { name: 'Damaged', value: damagedCopies },
      { name: 'Lost', value: lostCopies },
      { name: 'Retired', value: retiredCopies }
    ]
  };
};

// 4. Most Borrowed Books Report
const getMostBorrowedReport = async (query = {}, user) => {
  const targetLibraryId = await resolveLibraryScope(query.libraryId, user);
  const dateFilter = buildDateFilter(query, 'issueDate');

  const matchFilter = {
    ...dateFilter,
    ...(targetLibraryId ? { library: targetLibraryId } : {})
  };

  const mostBorrowed = await BorrowTransaction.aggregate([
    { $match: matchFilter },
    {
      $lookup: {
        from: 'bookcopies',
        localField: 'bookCopy',
        foreignField: '_id',
        as: 'copyDetails'
      }
    },
    { $unwind: '$copyDetails' },
    {
      $lookup: {
        from: 'books',
        localField: 'copyDetails.book',
        foreignField: '_id',
        as: 'bookMaster'
      }
    },
    { $unwind: '$bookMaster' },
    {
      $group: {
        _id: '$bookMaster._id',
        title: { $first: '$bookMaster.title' },
        author: { $first: '$bookMaster.author' },
        isbn: { $first: '$bookMaster.isbn' },
        branch: {
          $first: {
            $cond: [{ $eq: ['$bookMaster.branch', 'AIML'] }, 'CSM', '$bookMaster.branch']
          }
        },
        category: { $first: '$bookMaster.category' },
        borrowCount: { $sum: 1 }
      }
    },
    { $sort: { borrowCount: -1 } },
    { $limit: 10 }
  ]);

  return {
    items: mostBorrowed,
    rechartsData: mostBorrowed.map((b) => ({
      title: b.title.length > 20 ? b.title.substring(0, 20) + '...' : b.title,
      borrowCount: b.borrowCount
    }))
  };
};

// 5. Borrowing Trends Analytics Report
const getBorrowingAnalytics = async (query = {}, user) => {
  const targetLibraryId = await resolveLibraryScope(query.libraryId, user);
  const matchFilter = targetLibraryId ? { library: targetLibraryId } : {};

  const days = query.days ? parseInt(query.days, 10) : 14;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const dailyIssues = await BorrowTransaction.aggregate([
    { $match: { ...matchFilter, issueDate: { $gte: startDate } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$issueDate' } },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  return {
    trends: dailyIssues.map((d) => ({ date: d._id, issues: d.count })),
    labels: dailyIssues.map((d) => d._id),
    datasets: [{ label: 'Daily Issues', data: dailyIssues.map((d) => d.count) }]
  };
};

// 6. Returns Analytics Report
const getReturnsAnalytics = async (query = {}, user) => {
  const targetLibraryId = await resolveLibraryScope(query.libraryId, user);
  const dateFilter = buildDateFilter(query, 'returnDate');

  const matchFilter = {
    status: BORROW_STATUS.RETURNED,
    ...dateFilter,
    ...(targetLibraryId ? { library: targetLibraryId } : {})
  };

  const conditionBreakdown = await BorrowTransaction.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$conditionOnReturn',
        count: { $sum: 1 }
      }
    }
  ]);

  const totalReturns = conditionBreakdown.reduce((sum, c) => sum + c.count, 0);

  return {
    totalReturns,
    breakdown: conditionBreakdown.map((c) => ({ condition: c._id || 'GOOD', count: c.count })),
    rechartsData: conditionBreakdown.map((c) => ({ name: c._id || 'GOOD', value: c.count }))
  };
};

// 7. Overdue Analytics Report
const getOverdueAnalytics = async (query = {}, user) => {
  const targetLibraryId = await resolveLibraryScope(query.libraryId, user);
  const currentDate = new Date();

  const matchFilter = {
    status: { $in: [BORROW_STATUS.BORROWED, BORROW_STATUS.OVERDUE] },
    dueDate: { $lt: currentDate },
    ...(targetLibraryId ? { library: targetLibraryId } : {})
  };

  const overdues = await BorrowTransaction.find(matchFilter)
    .populate('student', 'rollNumber name department')
    .populate({ path: 'bookCopy', populate: { path: 'book', select: 'title' } })
    .populate('library', 'name code');

  const totalOverdueCount = overdues.length;

  return {
    totalOverdueCount,
    overdues: overdues.map((tx) => {
      const diffTime = Math.abs(currentDate - tx.dueDate);
      const overdueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return {
        transactionId: tx._id,
        rollNumber: tx.student?.rollNumber,
        studentName: tx.student?.name,
        bookTitle: tx.bookCopy?.book?.title,
        libraryCode: tx.library?.code,
        dueDate: tx.dueDate,
        overdueDays
      };
    })
  };
};

// 8. Visitor Analytics Report
const getVisitorAnalytics = async (query = {}, user) => {
  const targetLibraryId = await resolveLibraryScope(query.libraryId, user);

  // --- Build $match filter ------------------------------------------------
  // resolveLibraryScope returns a string; VisitLog.library is an ObjectId.
  // We must convert to ObjectId so the aggregation $match works correctly.
  const matchFilter = {};
  if (targetLibraryId) {
    matchFilter.library = new mongoose.Types.ObjectId(targetLibraryId);
  }

  // --- Date window --------------------------------------------------------
  const days = query.days ? parseInt(query.days, 10) : 30;

  // Build start-of-window in IST.  We want the IST calendar date `days` ago
  // at 00:00:00 IST, converted to UTC for the DB query.
  const now = new Date();
  // Start = today IST midnight minus (days-1) more days, so we include today
  // as the last day (gives `days` total days including today).
  // Simpler: go back `days` days from now (UTC) – since IST is UTC+5:30 this
  // is always safe as the window is generous by ≥5.5 hours.
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - (days - 1));
  // Set to 00:00:00 UTC so we definitely capture IST-early-morning visits
  startDate.setUTCHours(0, 0, 0, 0);

  // --- Aggregate: group visit sessions by IST local date ------------------
  // Each VisitLog doc = one visit session (one IN). Count docs, not IN/OUT
  // actions.  A user who is still inside (checkoutTime null) still counts.
  const rawBuckets = await VisitLog.aggregate([
    {
      $match: {
        ...matchFilter,
        checkInTime: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$checkInTime',
            timezone: 'Asia/Kolkata'  // group by IST calendar date
          }
        },
        visitorCount: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  // --- Zero-fill every calendar day in the window -------------------------
  // Build a map from the aggregation result
  const bucketMap = {};
  for (const b of rawBuckets) {
    bucketMap[b._id] = b.visitorCount;
  }

  // Generate the IST date string for each day in [startDate, today]
  const dailyVisitors = [];
  const cursor = new Date(startDate);
  const todayIST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' }); // 'YYYY-MM-DD'

  while (true) {
    // Get the IST date string for `cursor` (cursor is a UTC midnight boundary)
    const dateStr = cursor.toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
    dailyVisitors.push({
      date: dateStr,
      visitors: bucketMap[dateStr] || 0
    });
    if (dateStr >= todayIST) break;
    cursor.setDate(cursor.getDate() + 1);
    if (dailyVisitors.length > 400) break; // safety guard
  }

  return {
    dailyVisitors,
    rechartsData: dailyVisitors,
    rangeGenerated: true  // tells the frontend a proper range was built
  };
};


// 9. Seat Utilization Report
const getSeatUtilizationReport = async (query = {}, user) => {
  const targetLibraryId = await resolveLibraryScope(query.libraryId, user);
  const filter = targetLibraryId ? { _id: targetLibraryId, status: { $ne: 'INACTIVE' } } : { status: { $ne: 'INACTIVE' } };

  await libraryHoursService.closeStaleActiveVisits();
  const { isOpen } = libraryHoursService.isLibraryOpen();

  const libraries = await Library.find(filter).sort({ code: 1 });

  const utilizationData = await Promise.all(
    libraries.map(async (lib) => {
      const activeVisits = isOpen
        ? await VisitLog.countDocuments({ library: lib._id, checkoutTime: null })
        : 0;
      const availableSeats = Math.max(0, lib.capacity - activeVisits);
      const occupancyPercentage = lib.capacity > 0 ? parseFloat(((activeVisits / lib.capacity) * 100).toFixed(1)) : 0;

      return {
        libraryId: lib._id,
        libraryName: lib.name,
        code: lib.code,
        capacity: lib.capacity,
        activeVisits,
        availableSeats,
        occupancyPercentage,
        isFull: activeVisits >= lib.capacity
      };
    })
  );

  return {
    utilization: utilizationData,
    rechartsData: utilizationData.map((u) => ({
      library: u.code,
      occupied: u.activeVisits,
      available: u.availableSeats
    }))
  };
};

const getFinancialAnalytics = async (query = {}, user) => {
  const targetLibraryId = await resolveLibraryScope(query.libraryId, user);
  const dateFilter = buildDateFilter(query, 'createdAt');

  const fineMatchBase = { ...dateFilter };
  if (targetLibraryId) {
    const libBorrows = await BorrowTransaction.find({ library: targetLibraryId }).select('_id');
    fineMatchBase.borrowTransaction = { $in: libBorrows.map((b) => b._id) };
  }

  const paidFineMatch = { ...fineMatchBase, status: 'PAID' };
  const pendingFineMatch = { ...fineMatchBase, status: 'PENDING' };

  const allFines = await FineTransaction.find(fineMatchBase);

  let overdueFinesCollected = 0;
  let damageFinesCollected = 0;
  let lossFinesCollected = 0;
  let totalFinesCollected = 0;
  let totalPendingFines = 0;

  for (const f of allFines) {
    const paid = f.paidAmount || (f.status === 'PAID' ? (f.originalAmount || f.amount) : 0);
    const pending = f.status === 'PENDING' ? (f.outstandingAmount !== undefined ? f.outstandingAmount : f.amount) : 0;

    totalFinesCollected += paid;
    totalPendingFines += pending;

    if (paid > 0) {
      overdueFinesCollected += (f.overdueFine || 0);
      if (f.reason === 'DAMAGE' || f.reason === 'OVERDUE_AND_DAMAGE') {
        damageFinesCollected += (f.conditionFine || 50);
      } else if (f.reason === 'LOSS' || f.reason === 'OVERDUE_AND_LOSS') {
        lossFinesCollected += (f.conditionFine || 100);
      } else if (f.conditionFine > 0) {
        if (f.conditionFine === 50) damageFinesCollected += 50;
        else if (f.conditionFine === 100) lossFinesCollected += 100;
      }
    }
  }

  const fineTotals = await FineTransaction.aggregate([
    { $match: paidFineMatch },
    {
      $group: {
        _id: '$paymentMethod',
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);

  return {
    financialSummary: {
      totalFinesCollected,
      overdueFinesCollected,
      damageFinesCollected,
      lossFinesCollected,
      totalPendingFines,
      fineMethodsBreakdown: fineTotals.map((f) => ({ method: f._id, amount: f.totalAmount, count: f.count })),
      depositTransactionsBreakdown: []
    },
    rechartsData: [
      { name: 'Overdue Fines', amount: overdueFinesCollected },
      { name: 'Damage Fines', amount: damageFinesCollected },
      { name: 'Loss Fines', amount: lossFinesCollected },
      { name: 'Pending Fines', amount: totalPendingFines }
    ]
  };
};

// 11. Student Activity Analytics Report (Section 31: Isolation Enforced)
const getStudentActivityAnalytics = async (query = {}, user) => {
  const targetLibraryId = await resolveLibraryScope(query.libraryId, user);
  const matchFilter = targetLibraryId ? { library: targetLibraryId } : {};

  const topBorrowers = await BorrowTransaction.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$student',
        borrowCount: { $sum: 1 }
      }
    },
    { $sort: { borrowCount: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'studentprofiles',
        localField: '_id',
        foreignField: '_id',
        as: 'student'
      }
    },
    { $unwind: '$student' },
    {
      $project: {
        rollNumber: '$student.rollNumber',
        name: '$student.name',
        department: '$student.department',
        academicYear: '$student.academicYear',
        borrowCount: 1
      }
    }
  ]);

  return {
    topBorrowers,
    rechartsData: topBorrowers.map((s) => ({
      rollNumber: s.rollNumber,
      borrowCount: s.borrowCount
    }))
  };
};

module.exports = {
  getDashboardSummary,
  getLibraryComparison,
  getBookAnalytics,
  getMostBorrowedReport,
  getBorrowingAnalytics,
  getReturnsAnalytics,
  getOverdueAnalytics,
  getVisitorAnalytics,
  getSeatUtilizationReport,
  getFinancialAnalytics,
  getStudentActivityAnalytics
};
