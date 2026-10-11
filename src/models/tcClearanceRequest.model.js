const mongoose = require('mongoose');

const tcClearanceRequestSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentProfile',
      required: true,
      index: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    rollNumber: {
      type: String,
      required: [true, 'Roll number is required'],
      uppercase: true,
      trim: true,
      index: true
    },
    studentName: {
      type: String,
      required: [true, 'Student name is required'],
      trim: true
    },
    assignedLibrary: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Library',
      required: [true, 'Assigned library is required'],
      index: true
    },
    assignedLibraryName: {
      type: String,
      required: true,
      trim: true
    },
    department: {
      type: String,
      trim: true
    },
    academicYear: {
      type: Number
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    fathersName: {
      type: String,
      trim: true,
      default: ''
    },
    reason: {
      type: String,
      required: [true, 'Reason for TC / No Due clearance is required'],
      trim: true
    },
    enclosures: {
      idCard: { type: Boolean, default: true },
      libraryCard: { type: Boolean, default: true },
      photocopyPC: { type: Boolean, default: false }
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true
    },
    requestDate: {
      type: Date,
      default: Date.now
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    reviewedByName: {
      type: String,
      default: ''
    },
    reviewedAt: {
      type: Date,
      default: null
    },
    approvedAt: {
      type: Date,
      default: null
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true
    }
  },
  {
    timestamps: true
  }
);

// Index for multi-field queries: assignedLibrary + status
tcClearanceRequestSchema.index({ assignedLibrary: 1, status: 1 });
tcClearanceRequestSchema.index({ student: 1, status: 1 });

module.exports = mongoose.model('TCClearanceRequest', tcClearanceRequestSchema);
