const mongoose = require('mongoose');

const borrowTransactionSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentProfile',
      index: true
    },
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FacultyProfile',
      index: true
    },
    masterBook: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      index: true
    },
    callNo: {
      type: String,
      trim: true,
      index: true
    },
    bookCopy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BookCopy',
      required: true
    },
    library: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Library',
      required: true,
      index: true
    },
    issueDate: {
      type: Date,
      required: true,
      default: Date.now
    },
    dueDate: {
      type: Date,
      required: true,
      index: true
    },
    returnDate: {
      type: Date
    },
    status: {
      type: String,
      enum: ['BORROWED', 'RETURNED', 'OVERDUE', 'LOST', 'DAMAGED'],
      default: 'BORROWED',
      index: true
    },
    conditionOnReturn: {
      type: String,
      enum: ['GOOD', 'DAMAGED', 'LOST'],
      default: 'GOOD'
    },
    fineAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    overdueFine: {
      type: Number,
      default: 0,
      min: 0
    },
    conditionFine: {
      type: Number,
      default: 0,
      min: 0
    },
    finePaid: {
      type: Boolean,
      default: false
    },
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    returnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

borrowTransactionSchema.index({ student: 1, status: 1 });
borrowTransactionSchema.index({ faculty: 1, status: 1 });
borrowTransactionSchema.index({ dueDate: 1, status: 1 });
borrowTransactionSchema.index({ library: 1, status: 1 });

// Database-level partial unique index preventing duplicate active borrows for the same copy (Part 13 Fix)
borrowTransactionSchema.index(
  { bookCopy: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['BORROWED', 'OVERDUE'] } } }
);

// Database-level partial unique index preventing duplicate active borrows for the SAME STUDENT + MASTER BOOK (Global Duplicate Issue Bug Fix)
borrowTransactionSchema.index(
  { student: 1, masterBook: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['BORROWED', 'OVERDUE'] } } }
);

// Database-level partial unique index preventing duplicate active borrows for the SAME FACULTY + MASTER BOOK
borrowTransactionSchema.index(
  { faculty: 1, masterBook: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['BORROWED', 'OVERDUE'] } } }
);

module.exports = mongoose.model('BorrowTransaction', borrowTransactionSchema);
