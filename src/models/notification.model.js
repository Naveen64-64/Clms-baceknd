const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipientUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: [
        'REGISTRATION',
        'DUE_SOON',
        'DUE_TODAY',
        'OVERDUE',
        'FINE_GENERATED',
        'BOOK_ISSUED',
        'BOOK_RETURNED',
        'BOOK_AVAILABLE',
        'ANNOUNCEMENT'
      ],
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    relatedEntity: {
      type: mongoose.Schema.Types.Mixed
    }
  },
  {
    timestamps: true
  }
);

notificationSchema.index({ recipientUser: 1, isRead: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
