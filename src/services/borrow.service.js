const mongoose = require('mongoose');
const StudentProfile = require('../models/studentProfile.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const Book = require('../models/book.model');
const BookCopy = require('../models/bookCopy.model');
const BorrowTransaction = require('../models/borrowTransaction.model');
const FineTransaction = require('../models/fineTransaction.model');
const AdminSetting = require('../models/adminSetting.model');
const AuditLog = require('../models/auditLog.model');
const notificationService = require('./notification.service');
const { ROLES, GENDERS, BORROW_STATUS, BOOK_STATUS } = require('../config/constants');
const { runInTransaction } = require('../utils/transaction');
const ApiError = require('../utils/apiError');
const { getMandatoryLibrarianProfile } = require('../utils/librarianScope');

const getAdminSettings = async () => {
  let settings = await AdminSetting.findOne();
  if (!settings) {
    settings = await AdminSetting.create({});
  }
  return settings;
};



const FacultyProfile = require('../models/facultyProfile.model');

const issueBook = async (issueData, callingUser) => {
  const librarianUserId = callingUser.id || callingUser._id || callingUser;
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);

  const rawIdentifier = issueData.userIdentifier || issueData.rollNumber || issueData.facultyId;

  // 1. Validate Identifier
  if (!rawIdentifier) {
    throw new ApiError(400, 'Student Roll Number or Faculty ID is required');
  }
  const cleanId = rawIdentifier.trim().toUpperCase();

  let student = await StudentProfile.findOne({ rollNumber: cleanId });
  let faculty = null;

  if (!student) {
    faculty = await FacultyProfile.findOne({ facultyId: cleanId });
  }

  if (!student && !faculty) {
    throw new ApiError(404, `User with Roll Number or Faculty ID '${cleanId}' not found`);
  }

  const { bookId, barcode, callNo } = issueData;

  // Determine assigned library ID from librarian's profile
  let assignedLibId = librarianProfile?.assignedLibrary?._id || librarianProfile?.assignedLibrary;

  let copy = null;

  if (bookId) {
    const cleanBookId = String(bookId).trim();
    let book = null;
    if (mongoose.Types.ObjectId.isValid(cleanBookId)) {
      book = await Book.findById(cleanBookId);
    }
    if (!book) {
      book = await Book.findOne({ callNo: cleanBookId.toUpperCase(), isRetired: false });
    }
    if (!book || book.isRetired) {
      throw new ApiError(404, 'Book with Book ID not found or is retired');
    }

    const copyFilter = {
      book: book._id,
      status: BOOK_STATUS.AVAILABLE,
      isRetired: false
    };

    if (assignedLibId) {
      copyFilter.library = assignedLibId;
    }

    copy = await BookCopy.findOne(copyFilter).populate('library');
    if (!copy) {
      throw new ApiError(400, 'No available copies of this book in your assigned library.');
    }
  } else if (callNo) {
    const formattedCallNo = callNo.trim().toUpperCase();
    const book = await Book.findOne({ callNo: formattedCallNo, isRetired: false });
    if (!book) {
      throw new ApiError(404, `Book with Call No '${callNo}' not found or is retired`);
    }

    const copyFilter = {
      book: book._id,
      status: BOOK_STATUS.AVAILABLE,
      isRetired: false
    };

    if (assignedLibId) {
      copyFilter.library = assignedLibId;
    }

    copy = await BookCopy.findOne(copyFilter).populate('library');
    if (!copy) {
      throw new ApiError(400, `No available copies of Call No '${callNo}' in your assigned library.`);
    }
  } else if (barcode) {
    copy = await BookCopy.findOne({ barcode: barcode.trim().toUpperCase(), isRetired: false }).populate('library');
    if (!copy) {
      throw new ApiError(404, `Book copy with barcode ${barcode} not found or is retired`);
    }

    if (librarianProfile) {
      const copyLibId = copy.library._id || copy.library;
      if (assignedLibId.toString() !== copyLibId.toString()) {
        throw new ApiError(403, `Access denied: Librarians are strictly restricted to issuing books from their assigned library`);
      }
    }
  } else {
    throw new ApiError(400, 'Book ID is required');
  }

  // Verify Copy Status
  if (copy.status !== BOOK_STATUS.AVAILABLE) {
    throw new ApiError(400, `Book is not available for issue`);
  }

  // Gender Access Control Policy (Students only; Faculty have no gender restrictions)
  if (student) {
    if (student.gender === GENDERS.MALE && (copy.library.isWomenOnly || copy.library.code === 'KIET_WOMEN')) {
      throw new ApiError(403, "Access denied: Male students cannot borrow books from KIET Women's Library");
    }
  }

  // Master Book ID
  const masterBookId = copy.book._id || copy.book;
  const masterCopyIds = await BookCopy.find({ book: masterBookId }).distinct('_id');

  // GLOBAL DUPLICATE ISSUE CHECK: One Borrower + One Master Book ID = At Most ONE Active Borrow
  let existingActiveLoan = null;
  if (student) {
    existingActiveLoan = await BorrowTransaction.findOne({
      student: student._id,
      status: { $in: [BORROW_STATUS.BORROWED, BORROW_STATUS.OVERDUE] },
      $or: [
        { masterBook: masterBookId },
        { bookCopy: { $in: masterCopyIds } }
      ]
    });
  } else if (faculty) {
    existingActiveLoan = await BorrowTransaction.findOne({
      faculty: faculty._id,
      status: { $in: [BORROW_STATUS.BORROWED, BORROW_STATUS.OVERDUE] },
      $or: [
        { masterBook: masterBookId },
        { bookCopy: { $in: masterCopyIds } }
      ]
    });
  }

  if (existingActiveLoan) {
    throw new ApiError(409, `This ${student ? 'student' : 'faculty member'} already has this book on active loan.`);
  }

  // Max Borrowing Limit Check
  const settings = await getAdminSettings();
  if (student) {
    const maxAllowed = settings.defaultMaxBorrowLimit || settings.maxBooksPerStudent || 3;
    const activeBorrowingsCount = await BorrowTransaction.countDocuments({
      student: student._id,
      status: { $in: [BORROW_STATUS.BORROWED, BORROW_STATUS.OVERDUE] }
    });
    if (activeBorrowingsCount >= maxAllowed) {
      throw new ApiError(400, `Borrowing limit reached: Student has already borrowed ${activeBorrowingsCount}/${maxAllowed} books`);
    }
  }

  // Calculate Due Date (Configured Loan Duration Days)
  const issueDate = new Date();
  const loanDays = settings.standardLoanDurationDays || settings.defaultLoanDays || 14;
  const dueDate = new Date(issueDate.getTime() + loanDays * 24 * 60 * 60 * 1000);

  try {
    return await runInTransaction(async (session) => {
      const opts = session ? { session } : {};

      const updatedCopy = await BookCopy.findOneAndUpdate(
        { _id: copy._id, status: BOOK_STATUS.AVAILABLE, isRetired: false },
        { $set: { status: BOOK_STATUS.ISSUED } },
        { returnDocument: 'after', ...opts }
      );

      if (!updatedCopy) {
        throw new ApiError(400, `No available copies of this book in your assigned library.`);
      }

      const masterBookDoc = await Book.findById(masterBookId).select('callNo');

      const txPayload = {
        masterBook: masterBookId,
        callNo: masterBookDoc?.callNo || '',
        bookCopy: copy._id,
        library: copy.library._id,
        issueDate,
        dueDate,
        status: BORROW_STATUS.BORROWED,
        issuedBy: librarianUserId
      };

      if (student) {
        txPayload.student = student._id;
      } else if (faculty) {
        txPayload.faculty = faculty._id;
      }

      const [transaction] = await BorrowTransaction.create([txPayload], opts);

      const createdTx = await BorrowTransaction.findById(transaction._id)
        .session(session)
        .populate('student', 'rollNumber name department')
        .populate('faculty', 'facultyId name email phone')
        .populate({
          path: 'bookCopy',
          populate: { path: 'book', select: 'title author isbn' }
        })
        .populate('library', 'name code');

      // Create Notification for Borrower
      const recipientUserId = student ? student.user : faculty ? faculty.user : null;
      if (recipientUserId) {
        await notificationService.createNotification(
          recipientUserId,
          'BOOK_ISSUED',
          'Book Issued',
          `Book "${createdTx.bookCopy?.book?.title}" has been issued to you. Due date: ${dueDate.toDateString()}`,
          { transactionId: transaction._id }
        );
      }

      const copyFilter = { book: copy.book, library: copy.library._id || copy.library, isRetired: false };
      const allCopies = await BookCopy.find(copyFilter).session(session);
      const totalCopies = allCopies.length;
      const availableCopies = allCopies.filter((c) => c.status === BOOK_STATUS.AVAILABLE).length;
      const issuedCopies = allCopies.filter((c) => c.status === BOOK_STATUS.ISSUED).length;
      const lostCopies = allCopies.filter((c) => c.status === 'LOST').length;
      const damagedCopies = allCopies.filter((c) => c.status === 'DAMAGED').length;

      const resultObj = createdTx.toObject();
      resultObj.action = 'ISSUED';
      resultObj.bookId = copy.book;
      resultObj.totalCopies = totalCopies;
      resultObj.availableCopies = availableCopies;
      resultObj.issuedCopies = issuedCopies;
      resultObj.lostCopies = lostCopies;
      resultObj.damagedCopies = damagedCopies;

      return resultObj;
    });
  } catch (err) {
    if (err.code === 11000 || (err.message && String(err.message).includes('11000'))) {
      throw new ApiError(409, `This ${student ? 'student' : 'faculty member'} already has this book on active loan.`);
    }
    throw err;
  }
};

const getConditionFine = (condition) => {
  if (!condition) {
    throw new ApiError(400, 'Return condition is required');
  }
  const formatted = String(condition).trim().toUpperCase();
  switch (formatted) {
    case 'GOOD':
      return 0;
    case 'DAMAGED':
      return 50;
    case 'LOST':
      return 100;
    default:
      throw new ApiError(400, 'Invalid return condition: condition must be one of GOOD, DAMAGED, LOST');
  }
};

const returnBook = async (returnData, callingUser) => {
  const librarianUserId = callingUser.id || callingUser._id || callingUser;
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);
  const { rollNumber, facultyId, userIdentifier, bookId, barcode, transactionId, condition, callNo } = returnData;

  if (!condition) {
    throw new ApiError(400, 'Return condition is required and must be one of GOOD, DAMAGED, LOST');
  }

  const formattedCondition = String(condition).trim().toUpperCase();
  const conditionFine = getConditionFine(formattedCondition);

  let transaction = null;

  if (transactionId) {
    transaction = await BorrowTransaction.findById(transactionId).populate('bookCopy');
  } else if (userIdentifier || rollNumber || facultyId) {
    const cleanId = (userIdentifier || rollNumber || facultyId).trim().toUpperCase();
    const student = await StudentProfile.findOne({ rollNumber: cleanId });
    const faculty = !student ? await FacultyProfile.findOne({ facultyId: cleanId }) : null;

    if (!student && !faculty) throw new ApiError(404, `User with ID '${cleanId}' not found`);

    let book = null;
    if (bookId) {
      const cleanBookId = String(bookId).trim();
      if (mongoose.Types.ObjectId.isValid(cleanBookId)) {
        book = await Book.findById(cleanBookId);
      }
      if (!book) {
        book = await Book.findOne({ callNo: cleanBookId.toUpperCase() });
      }
    } else if (callNo) {
      book = await Book.findOne({ callNo: callNo.trim().toUpperCase() });
    }

    let copyIds = [];
    if (book) {
      const copyFilter = { book: book._id };
      if (librarianProfile) {
        copyFilter.library = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
      }
      const matchingCopies = await BookCopy.find(copyFilter).select('_id');
      copyIds = matchingCopies.map((c) => c._id);
    }

    const txFilter = {
      status: { $in: [BORROW_STATUS.BORROWED, BORROW_STATUS.OVERDUE] }
    };

    if (student) txFilter.student = student._id;
    if (faculty) txFilter.faculty = faculty._id;

    if (book) {
      txFilter.$or = [
        { masterBook: book._id },
        ...(copyIds.length > 0 ? [{ bookCopy: { $in: copyIds } }] : [])
      ];
    } else if (copyIds.length > 0) {
      txFilter.bookCopy = { $in: copyIds };
    }

    if (librarianProfile) {
      txFilter.library = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
    }

    transaction = await BorrowTransaction.findOne(txFilter).populate('bookCopy');
  } else if (barcode) {
    const copy = await BookCopy.findOne({ barcode: barcode.trim().toUpperCase() });
    if (!copy) throw new ApiError(404, `Book copy with barcode ${barcode} not found`);

    transaction = await BorrowTransaction.findOne({
      bookCopy: copy._id,
      status: { $in: [BORROW_STATUS.BORROWED, BORROW_STATUS.OVERDUE] }
    }).populate('bookCopy');
  }

  if (!transaction) {
    throw new ApiError(404, 'No active borrowing record found for this user and book.');
  }

  // Service-level Librarian Scope Check
  if (librarianProfile) {
    const assignedLibId = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
    const copyLibId = transaction.bookCopy.library._id || transaction.bookCopy.library;
    if (assignedLibId.toString() !== copyLibId.toString()) {
      throw new ApiError(403, `Access denied: Librarians are strictly restricted to processing returns for their assigned library`);
    }
  }

  const settings = await getAdminSettings();
  const returnDate = new Date();

  // Calculate Overdue Days & Overdue Fine using configured fineRatePerOverdueDay
  const fineRate = settings.fineRatePerOverdueDay ?? settings.finePerDay ?? 1;
  let overdueDays = 0;
  let overdueFine = 0;
  if (returnDate > transaction.dueDate) {
    const diffTime = Math.max(0, returnDate - transaction.dueDate);
    overdueDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    overdueFine = overdueDays * fineRate;
  }

  const totalFine = overdueFine + conditionFine;

  // Fine Reason Classification
  let reason = 'OVERDUE';
  if (overdueFine > 0 && conditionFine === 50) reason = 'OVERDUE_AND_DAMAGE';
  else if (overdueFine > 0 && conditionFine === 100) reason = 'OVERDUE_AND_LOSS';
  else if (conditionFine === 50) reason = 'DAMAGE';
  else if (conditionFine === 100) reason = 'LOSS';
  else reason = 'OVERDUE';

  return await runInTransaction(async (session) => {
    const opts = session ? { session } : {};

    const updatedTransaction = await BorrowTransaction.findOneAndUpdate(
      {
        _id: transaction._id,
        status: { $in: [BORROW_STATUS.BORROWED, BORROW_STATUS.OVERDUE] }
      },
      {
        $set: {
          returnDate,
          overdueFine,
          conditionFine,
          fineAmount: totalFine,
          conditionOnReturn: formattedCondition,
          status: BORROW_STATUS.RETURNED,
          returnedBy: librarianUserId
        }
      },
      { returnDocument: 'after', ...opts }
    );

    if (!updatedTransaction) {
      throw new ApiError(400, 'Book has already been returned.');
    }

    let targetCopyStatus = BOOK_STATUS.AVAILABLE;
    if (formattedCondition === 'DAMAGED') targetCopyStatus = 'DAMAGED';
    if (formattedCondition === 'LOST') targetCopyStatus = 'LOST';

    const copyId = transaction.bookCopy?._id || transaction.bookCopy;

    const updatedCopy = await BookCopy.findOneAndUpdate(
      { _id: copyId },
      { $set: { status: targetCopyStatus } },
      { returnDocument: 'after', ...opts }
    );

    let fineTxRecord = null;
    if (totalFine > 0) {
      const existingFine = await FineTransaction.findOne({ borrowTransaction: transaction._id }).session(session);
      if (existingFine) {
        if (existingFine.status === 'PENDING') {
          existingFine.amount = totalFine;
          existingFine.overdueFine = overdueFine;
          existingFine.conditionFine = conditionFine;
          existingFine.reason = reason;
          await existingFine.save(opts);
        }
        fineTxRecord = existingFine;
      } else {
        const [fineTx] = await FineTransaction.create(
          [
            {
              student: transaction.student,
              borrowTransaction: transaction._id,
              amount: totalFine,
              overdueFine,
              conditionFine,
              reason,
              paymentMethod: 'CASH',
              status: 'PENDING',
              collectedBy: librarianUserId
            }
          ],
          opts
        );
        fineTxRecord = fineTx;
      }

      const studentProfile = transaction.student ? await StudentProfile.findById(transaction.student).session(session) : null;
      const facultyProfile = transaction.faculty ? await FacultyProfile.findById(transaction.faculty).session(session) : null;

      const recipientUser = studentProfile?.user || facultyProfile?.user;
      if (recipientUser) {
        let notifMessage = '';
        if (formattedCondition === 'DAMAGED' && overdueFine > 0) {
          notifMessage = `Book returned ${overdueDays} day(s) late and marked as DAMAGED. Total outstanding fine: ₹${totalFine}.`;
        } else if (formattedCondition === 'DAMAGED') {
          notifMessage = `Book returned as DAMAGED. A ₹50 damage fine has been added to your library account.`;
        } else if (formattedCondition === 'LOST' && overdueFine > 0) {
          notifMessage = `Book returned ${overdueDays} day(s) late and marked as LOST. Total outstanding fine: ₹${totalFine}.`;
        } else if (formattedCondition === 'LOST') {
          notifMessage = `Book marked as LOST. A ₹100 loss fine has been added to your library account.`;
        } else {
          notifMessage = `Book returned ${overdueDays} day(s) late. Total outstanding fine: ₹${totalFine}.`;
        }

        await notificationService.createNotification(
          recipientUser,
          'FINE_GENERATED',
          'Library Fine Generated',
          notifMessage,
          { transactionId: transaction._id, totalFine, overdueFine, conditionFine, condition: formattedCondition }
        );
      }
    }

    const studentDoc = transaction.student ? await StudentProfile.findById(transaction.student).session(session) : null;
    const facultyDoc = transaction.faculty ? await FacultyProfile.findById(transaction.faculty).session(session) : null;
    const bookCopyDoc = await BookCopy.findById(copyId).populate('book').session(session);

    const targetBookId = bookCopyDoc?.book?._id || bookCopyDoc?.book;
    const targetLibId = transaction.library?._id || transaction.library;

    const copyFilter = { book: targetBookId, library: targetLibId, isRetired: false };
    const allCopies = await BookCopy.find(copyFilter).session(session);

    const totalCopies = allCopies.length;
    const availableCopies = allCopies.filter((c) => c.status === BOOK_STATUS.AVAILABLE).length;
    const issuedCopies = allCopies.filter((c) => c.status === BOOK_STATUS.ISSUED).length;
    const lostCopies = allCopies.filter((c) => c.status === 'LOST').length;
    const damagedCopies = allCopies.filter((c) => c.status === 'DAMAGED').length;

    // Audit log entry
    await AuditLog.create(
      [
        {
          performedBy: librarianUserId,
          username: callingUser?.username || 'Librarian',
          role: callingUser?.role || 'LIBRARIAN',
          action: 'BOOK_RETURNED',
          domain: 'BORROW',
          details: {
            identifier: studentDoc?.rollNumber || facultyDoc?.facultyId,
            borrowerType: studentDoc ? 'STUDENT' : 'FACULTY',
            bookTitle: bookCopyDoc?.book?.title,
            condition: formattedCondition,
            overdueFine,
            conditionFine,
            totalFine
          }
        }
      ],
      opts
    );

    return {
      action: 'RETURNED',
      transactionId: updatedTransaction._id,
      rollNumber: studentDoc?.rollNumber || facultyDoc?.facultyId || '',
      userIdentifier: studentDoc?.rollNumber || facultyDoc?.facultyId || '',
      borrowerName: studentDoc?.name || facultyDoc?.name || '',
      studentName: studentDoc?.name || facultyDoc?.name || '',
      borrowerType: studentDoc ? 'STUDENT' : 'FACULTY',
      bookId: targetBookId || '',
      bookTitle: bookCopyDoc?.book?.title || '',
      barcode: bookCopyDoc?.barcode || '',
      condition: formattedCondition,
      conditionOnReturn: formattedCondition,
      overdueDays,
      overdueFine,
      conditionFine,
      totalFine,
      fineAmount: totalFine,
      fineStatus: totalFine > 0 ? (fineTxRecord?.status || 'PENDING') : 'NONE',
      isOverdue: overdueDays > 0,
      returnDate: updatedTransaction.returnDate,
      dueDate: updatedTransaction.dueDate,
      finePaid: updatedTransaction.finePaid,
      fineTransaction: fineTxRecord,
      totalCopies,
      availableCopies,
      issuedCopies,
      lostCopies,
      damagedCopies
    };
  });
};

const getOverdueBorrowings = async (query = {}, callingUser = null) => {
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);
  const settings = await getAdminSettings();
  const currentDate = new Date();

  const filter = {
    status: { $in: [BORROW_STATUS.BORROWED, BORROW_STATUS.OVERDUE] },
    dueDate: { $lt: currentDate }
  };

  if (librarianProfile) {
    filter.library = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
  } else if (query.libraryId) {
    let lib = await Library.findOne({ code: query.libraryId });
    if (!lib && mongoose.Types.ObjectId.isValid(query.libraryId)) {
      lib = await Library.findById(query.libraryId);
    }
    filter.library = lib ? lib._id : query.libraryId;
  }

  const overdueTransactions = await BorrowTransaction.find(filter)
    .populate('student', 'rollNumber name department gender')
    .populate({
      path: 'bookCopy',
      populate: { path: 'book', select: 'title author isbn' }
    })
    .populate('library', 'name code');

  const fineRate = settings.fineRatePerOverdueDay ?? settings.finePerDay ?? 1;

  return overdueTransactions.map((tx) => {
    const diffTime = Math.abs(currentDate - tx.dueDate);
    const overdueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const calculatedFine = overdueDays * fineRate;

    return {
      transactionId: tx._id,
      student: tx.student,
      book: tx.bookCopy?.book,
      barcode: tx.bookCopy?.barcode,
      library: tx.library,
      issueDate: tx.issueDate,
      dueDate: tx.dueDate,
      overdueDays,
      fineAmount: calculatedFine
    };
  });
};

const getBorrowHistory = async (targetStudentId, callingUser = null) => {
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);
  const filter = {};

  if (callingUser && callingUser.role === ROLES.STUDENT) {
    filter.student = callingUser.studentProfile?._id;
  } else if (librarianProfile) {
    filter.library = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
    if (targetStudentId) filter.student = targetStudentId;
  } else if (targetStudentId) {
    filter.student = targetStudentId;
  }

  return await BorrowTransaction.find(filter)
    .populate('student', 'rollNumber name department')
    .populate({
      path: 'bookCopy',
      populate: { path: 'book', select: 'title author isbn category' }
    })
    .populate('library', 'name code')
    .sort({ issueDate: -1 });
};

module.exports = {
  issueBook,
  returnBook,
  getOverdueBorrowings,
  getBorrowHistory
};
