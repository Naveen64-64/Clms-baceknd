const mongoose = require('mongoose');
const { DEFAULT_SETTINGS } = require('../config/constants');

const adminSettingSchema = new mongoose.Schema(
  {
    maxBooksPerStudent: {
      type: Number,
      default: DEFAULT_SETTINGS.MAX_BOOKS_PER_STUDENT,
      min: 1
    },
    defaultMaxBorrowLimit: {
      type: Number,
      default: DEFAULT_SETTINGS.MAX_BOOKS_PER_STUDENT,
      min: 1
    },
    defaultLoanDays: {
      type: Number,
      default: DEFAULT_SETTINGS.DEFAULT_LOAN_DAYS,
      min: 1
    },
    standardLoanDurationDays: {
      type: Number,
      default: DEFAULT_SETTINGS.DEFAULT_LOAN_DAYS,
      min: 1
    },
    finePerDay: {
      type: Number,
      default: DEFAULT_SETTINGS.FINE_PER_DAY,
      min: 0
    },
    fineRatePerOverdueDay: {
      type: Number,
      default: DEFAULT_SETTINGS.FINE_PER_DAY,
      min: 0
    },
    initialSecurityDeposit: {
      type: Number,
      default: DEFAULT_SETTINGS.INITIAL_DEPOSIT_AMOUNT,
      min: 0
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

adminSettingSchema.pre('save', function () {
  if (this.fineRatePerOverdueDay !== undefined) {
    this.finePerDay = this.fineRatePerOverdueDay;
  } else if (this.finePerDay !== undefined) {
    this.fineRatePerOverdueDay = this.finePerDay;
  }

  if (this.defaultMaxBorrowLimit !== undefined) {
    this.maxBooksPerStudent = this.defaultMaxBorrowLimit;
  } else if (this.maxBooksPerStudent !== undefined) {
    this.defaultMaxBorrowLimit = this.maxBooksPerStudent;
  }

  if (this.standardLoanDurationDays !== undefined) {
    this.defaultLoanDays = this.standardLoanDurationDays;
  } else if (this.defaultLoanDays !== undefined) {
    this.standardLoanDurationDays = this.defaultLoanDays;
  }
});

module.exports = mongoose.model('AdminSetting', adminSettingSchema);
