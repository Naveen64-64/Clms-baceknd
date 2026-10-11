const mongoose = require('mongoose');

const fineTransactionSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentProfile',
      index: true
    },
    borrowTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BorrowTransaction',
      required: true
    },
    amount: {
      type: Number,
      required: true,
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
    originalAmount: {
      type: Number,
      min: 0
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    outstandingAmount: {
      type: Number,
      min: 0
    },
    payments: [
      {
        amount: { type: Number, required: true, min: 0 },
        paymentMethod: { type: String, enum: ['CASH', 'ONLINE', 'WAIVED', 'UPI'], default: 'CASH' },
        previousOutstanding: { type: Number, required: true, min: 0 },
        remainingOutstanding: { type: Number, required: true, min: 0 },
        paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        createdAt: { type: Date, default: Date.now }
      }
    ],
    reason: {
      type: String,
      enum: ['OVERDUE', 'DAMAGE', 'LOSS', 'OVERDUE_AND_DAMAGE', 'OVERDUE_AND_LOSS'],
      default: 'OVERDUE'
    },
    paymentMethod: {
      type: String,
      enum: ['CASH', 'ONLINE', 'WAIVED', 'UPI'],
      default: 'CASH'
    },
    status: {
      type: String,
      enum: ['PAID', 'PENDING', 'WAIVED'],
      default: 'PENDING',
      index: true
    },
    collectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

fineTransactionSchema.pre('save', function () {
  if (this.originalAmount === undefined || this.originalAmount === null) {
    this.originalAmount = this.amount;
  }
  if (this.outstandingAmount === undefined || this.outstandingAmount === null) {
    if (this.status === 'PAID' || this.status === 'WAIVED') {
      this.outstandingAmount = 0;
      this.paidAmount = this.originalAmount;
    } else {
      this.outstandingAmount = Math.max(0, this.originalAmount - (this.paidAmount || 0));
    }
  }
});

fineTransactionSchema.index({ borrowTransaction: 1 }, { unique: true });
fineTransactionSchema.index({ student: 1, status: 1 });

module.exports = mongoose.model('FineTransaction', fineTransactionSchema);
