const mongoose = require('mongoose');

const visitLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentProfile'
    },
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FacultyProfile'
    },
    userType: {
      type: String,
      enum: ['STUDENT', 'FACULTY'],
      default: 'STUDENT',
      index: true
    },
    userId: {
      type: String,
      uppercase: true,
      trim: true,
      index: true
    },
    rollNumber: {
      type: String,
      uppercase: true,
      trim: true,
      index: true
    },
    library: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Library',
      required: true,
      index: true
    },
    checkInTime: {
      type: Date,
      required: true,
      default: Date.now
    },
    checkoutTime: {
      type: Date,
      default: null,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes for real-time calculation and concurrency protection
visitLogSchema.index({ library: 1, checkoutTime: 1 });
visitLogSchema.index({ rollNumber: 1, checkoutTime: 1 });
visitLogSchema.index({ userId: 1, checkoutTime: 1 });

module.exports = mongoose.model('VisitLog', visitLogSchema);
