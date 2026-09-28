const mongoose = require('mongoose');

const bookCopySchema = new mongoose.Schema(
  {
    book: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      required: true,
      index: true
    },
    copyNumber: {
      type: Number,
      required: true,
      min: 1
    },
    library: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Library',
      required: true,
      index: true
    },
    barcode: {
      type: String,
      required: [true, 'Barcode / Accession tag is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    status: {
      type: String,
      enum: ['AVAILABLE', 'ISSUED', 'LOST', 'DAMAGED', 'RETIRED'],
      default: 'AVAILABLE',
      index: true
    },
    rackLocation: {
      type: String,
      trim: true,
      default: 'General Rack'
    },
    isRetired: {
      type: Boolean,
      default: false,
      index: true
    },
    retiredReason: {
      type: String,
      trim: true
    }
  },
  {
    timestamps: true
  }
);

bookCopySchema.index({ book: 1, copyNumber: 1 }, { unique: true });
bookCopySchema.index({ book: 1, status: 1 });
bookCopySchema.index({ book: 1, library: 1, status: 1, isRetired: 1 });
bookCopySchema.index({ library: 1, status: 1 });

module.exports = mongoose.model('BookCopy', bookCopySchema);

