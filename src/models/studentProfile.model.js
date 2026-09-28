const mongoose = require('mongoose');
const { GENDERS, DEPOSIT_CONSTANTS, DEFAULT_SETTINGS } = require('../config/constants');

const studentProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    rollNumber: {
      type: String,
      required: [true, 'Roll Number is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    campusCode: {
      type: String,
      enum: ['B2', '6Q', 'JN'],
      required: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Student name is required'],
      trim: true
    },
    gender: {
      type: String,
      enum: Object.values(GENDERS),
      required: [true, 'Gender is required']
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true
    },
    academicYear: {
      type: Number,
      required: [true, 'Academic year is required'],
      min: 1,
      max: 5
    },
    section: {
      type: String,
      trim: true,
      default: 'A'
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      trim: true
    },
    securityDepositBalance: {
      type: Number,
      default: 0,
      min: 0
    },
    maxBooksAllowed: {
      type: Number,
      default: DEFAULT_SETTINGS.MAX_BOOKS_PER_STUDENT,
      min: 0
    },
    isEligibleForRefund: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('StudentProfile', studentProfileSchema);
