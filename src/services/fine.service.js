const BorrowTransaction = require('../models/borrowTransaction.model');
const FineTransaction = require('../models/fineTransaction.model');
const StudentProfile = require('../models/studentProfile.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const { ROLES } = require('../config/constants');
const { runInTransaction } = require('../utils/transaction');
const ApiError = require('../utils/apiError');
const { getMandatoryLibrarianProfile } = require('../utils/librarianScope');



const getStudentFinesByRollNumber = async (rollNumber, callingUser) => {
  if (!rollNumber) {
    throw new ApiError(400, 'Student Roll Number is required');
  }

  const formattedRoll = rollNumber.trim().toUpperCase();
  const student = await StudentProfile.findOne({ rollNumber: formattedRoll });
  if (!student) {
    throw new ApiError(404, `Student with Roll Number ${formattedRoll} not found`);
  }

  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);

  const filter = { student: student._id };
  if (librarianProfile) {
    const assignedLibId = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
    const libBorrows = await BorrowTransaction.find({ library: assignedLibId }).select('_id');
    filter.borrowTransaction = { $in: libBorrows.map((b) => b._id) };
  }

  const fines = await FineTransaction.find(filter)
    .populate('student', 'rollNumber name department academicYear section gender')
    .populate({
      path: 'borrowTransaction',
      populate: [
        { path: 'bookCopy', populate: { path: 'book', select: 'title author isbn' } },
        { path: 'library', select: 'name code' }
      ]
    })
    .populate('payments.paidBy', 'username role')
    .sort({ createdAt: -1 });

  const pendingFines = fines.filter((f) => f.status === 'PENDING');
  const totalOutstandingFine = pendingFines.reduce((sum, f) => {
    const out = f.outstandingAmount !== undefined ? f.outstandingAmount : (f.amount || 0);
    return sum + out;
  }, 0);

  return {
    student: {
      _id: student._id,
      rollNumber: student.rollNumber,
      name: student.name,
      department: student.department,
      academicYear: student.academicYear,
      section: student.section,
      gender: student.gender
    },
    totalOutstandingFine,
    pendingFinesCount: pendingFines.length,
    fines: fines.map((f) => {
      const bTx = f.borrowTransaction || {};
      const orig = f.originalAmount !== undefined ? f.originalAmount : f.amount;
      const paid = f.paidAmount || 0;
      const out = f.outstandingAmount !== undefined ? f.outstandingAmount : (f.status === 'PAID' ? 0 : Math.max(0, orig - paid));
      return {
        _id: f._id,
        fineTransactionId: f._id,
        borrowTransactionId: bTx._id,
        bookTitle: bTx.bookCopy?.book?.title || 'Library Book',
        bookId: bTx.bookCopy?.book?._id,
        barcode: bTx.bookCopy?.barcode,
        libraryName: bTx.library?.name,
        libraryCode: bTx.library?.code,
        issueDate: bTx.issueDate,
        dueDate: bTx.dueDate,
        returnDate: bTx.returnDate,
        condition: bTx.conditionOnReturn || 'GOOD',
        reason: f.reason,
        originalAmount: orig,
        paidAmount: paid,
        outstandingAmount: out,
        amount: orig,
        overdueFine: f.overdueFine || bTx.overdueFine || 0,
        conditionFine: f.conditionFine || bTx.conditionFine || 0,
        status: f.status,
        paymentMethod: f.paymentMethod,
        payments: f.payments || []
      };
    })
  };
};

const payFine = async (paymentData, callingUser) => {
  const collectedByUserId = callingUser.id || callingUser._id || callingUser;
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);
  const { transactionId, fineTransactionId, rollNumber, paymentMethod, amount } = paymentData;

  const paymentAmount = Number(amount);
  if (isNaN(paymentAmount) || paymentAmount <= 0) {
    throw new ApiError(400, 'Payment amount must be greater than zero');
  }

  let fineTx = null;

  if (fineTransactionId) {
    fineTx = await FineTransaction.findById(fineTransactionId);
  } else if (transactionId) {
    fineTx = await FineTransaction.findOne({ borrowTransaction: transactionId });
    if (!fineTx) {
      fineTx = await FineTransaction.findById(transactionId);
    }
  }

  if (!fineTx && rollNumber) {
    const formattedRoll = rollNumber.trim().toUpperCase();
    const student = await StudentProfile.findOne({ rollNumber: formattedRoll });
    if (!student) {
      throw new ApiError(404, `Student with Roll Number ${formattedRoll} not found`);
    }

    const filter = { student: student._id, status: 'PENDING' };
    if (librarianProfile) {
      const assignedLibId = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
      const libBorrows = await BorrowTransaction.find({ library: assignedLibId }).select('_id');
      filter.borrowTransaction = { $in: libBorrows.map((b) => b._id) };
    }

    fineTx = await FineTransaction.findOne(filter).sort({ createdAt: 1 });
  }

  if (!fineTx) {
    throw new ApiError(404, 'No pending fine transaction found');
  }

  if (fineTx.status !== 'PENDING') {
    throw new ApiError(400, 'Fine for this transaction has already been paid or waived');
  }

  const borrowTx = await BorrowTransaction.findById(fineTx.borrowTransaction).populate('student');
  if (!borrowTx) {
    throw new ApiError(404, 'Associated borrow transaction not found');
  }

  if (librarianProfile) {
    const assignedLibId = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
    if (assignedLibId.toString() !== borrowTx.library.toString()) {
      throw new ApiError(403, 'Access denied: Librarians are strictly restricted to processing fine payments for their assigned library');
    }
  }

  const originalAmt = fineTx.originalAmount !== undefined ? fineTx.originalAmount : fineTx.amount;
  const currentPaid = fineTx.paidAmount || 0;
  const currentOutstanding = fineTx.outstandingAmount !== undefined ? fineTx.outstandingAmount : Math.max(0, originalAmt - currentPaid);

  if (currentOutstanding <= 0) {
    throw new ApiError(400, 'No outstanding fine amount for this transaction');
  }

  if (paymentAmount > currentOutstanding) {
    throw new ApiError(400, `Payment amount (₹${paymentAmount}) cannot exceed the outstanding fine (₹${currentOutstanding})`);
  }

  const formattedPaymentMethod = ['CASH', 'ONLINE', 'WAIVED', 'UPI'].includes(paymentMethod) ? paymentMethod : 'CASH';

  return await runInTransaction(async (session) => {
    const opts = session ? { session } : {};

    const updatedFineTx = await FineTransaction.findOneAndUpdate(
      {
        _id: fineTx._id,
        status: 'PENDING',
        $or: [
          { outstandingAmount: { $gte: paymentAmount } },
          { outstandingAmount: { $exists: false }, amount: { $gte: paymentAmount } }
        ]
      },
      {
        $inc: { paidAmount: paymentAmount },
        $set: {
          originalAmount: originalAmt,
          outstandingAmount: currentOutstanding - paymentAmount,
          paymentMethod: formattedPaymentMethod,
          collectedBy: collectedByUserId
        },
        $push: {
          payments: {
            amount: paymentAmount,
            paymentMethod: formattedPaymentMethod,
            previousOutstanding: currentOutstanding,
            remainingOutstanding: currentOutstanding - paymentAmount,
            paidBy: collectedByUserId,
            createdAt: new Date()
          }
        }
      },
      { returnDocument: 'after', ...opts }
    );

    if (!updatedFineTx) {
      throw new ApiError(400, 'Payment failed: Fine has already been paid or remaining balance is less than payment amount');
    }

    const isFullyPaid = updatedFineTx.outstandingAmount === 0;
    if (isFullyPaid) {
      updatedFineTx.status = formattedPaymentMethod === 'WAIVED' ? 'WAIVED' : 'PAID';
      await updatedFineTx.save(opts);
    }

    await BorrowTransaction.findByIdAndUpdate(
      fineTx.borrowTransaction,
      {
        $set: {
          fineAmount: updatedFineTx.outstandingAmount,
          finePaid: isFullyPaid
        }
      },
      opts
    );

    const studentDoc = await StudentProfile.findById(updatedFineTx.student).session(session);

    return {
      fineTransactionId: updatedFineTx._id,
      borrowTransactionId: fineTx.borrowTransaction,
      rollNumber: studentDoc?.rollNumber || '',
      studentName: studentDoc?.name || '',
      amountPaid: paymentAmount,
      previousOutstanding: currentOutstanding,
      remainingAmount: updatedFineTx.outstandingAmount,
      paymentMethod: formattedPaymentMethod,
      status: updatedFineTx.status,
      isFullyCleared: isFullyPaid
    };
  });
};

const getFineHistory = async (query = {}, user) => {
  const librarianProfile = await getMandatoryLibrarianProfile(user);
  const { rollNumber, status } = query;
  const filter = {};

  if (status) filter.status = status.toUpperCase();

  if (user && user.role === ROLES.STUDENT) {
    filter.student = user.studentProfile?._id;
  } else if (librarianProfile) {
    const assignedLibId = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
    const libBorrows = await BorrowTransaction.find({ library: assignedLibId }).select('_id');
    filter.borrowTransaction = { $in: libBorrows.map((b) => b._id) };
    if (rollNumber) {
      const student = await StudentProfile.findOne({ rollNumber: rollNumber.trim().toUpperCase() });
      if (student) filter.student = student._id;
    }
  } else if (rollNumber) {
    const student = await StudentProfile.findOne({ rollNumber: rollNumber.trim().toUpperCase() });
    if (student) filter.student = student._id;
  }

  const fines = await FineTransaction.find(filter)
    .populate('student', 'rollNumber name department')
    .populate({
      path: 'borrowTransaction',
      populate: [
        { path: 'bookCopy', populate: { path: 'book', select: 'title author isbn' } },
        { path: 'library', select: 'name code' }
      ]
    })
    .populate('collectedBy', 'username role')
    .populate('payments.paidBy', 'username role')
    .sort({ createdAt: -1 });

  return fines.map((f) => {
    const orig = f.originalAmount !== undefined ? f.originalAmount : f.amount;
    const paid = f.paidAmount || 0;
    const out = f.outstandingAmount !== undefined ? f.outstandingAmount : (f.status === 'PAID' ? 0 : Math.max(0, orig - paid));

    return {
      _id: f._id,
      student: f.student,
      borrowTransaction: f.borrowTransaction,
      amount: orig,
      originalAmount: orig,
      paidAmount: paid,
      outstandingAmount: out,
      overdueFine: f.overdueFine,
      conditionFine: f.conditionFine,
      reason: f.reason,
      paymentMethod: f.paymentMethod,
      status: f.status,
      collectedBy: f.collectedBy,
      payments: f.payments || [],
      createdAt: f.createdAt,
      updatedAt: f.updatedAt
    };
  });
};

module.exports = {
  getStudentFinesByRollNumber,
  payFine,
  getFineHistory
};
