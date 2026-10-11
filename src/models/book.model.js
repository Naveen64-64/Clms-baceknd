const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema(
  {
    callNo: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    author: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    isbn: {
      type: String,
      trim: true,
      uppercase: true,
      index: true
    },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    department: {
      type: String,
      trim: true,
      index: true
    },
    branch: {
      type: String,
      trim: true,
      default: 'GENERAL',
      index: true
    },
    publisher: {
      type: String,
      trim: true,
      default: 'Central Library'
    },
    edition: {
      type: String,
      trim: true,
      default: 'Standard'
    },
    publicationYear: {
      type: Number
    },
    pages: {
      type: String,
      trim: true
    },
    price: {
      type: Number
    },
    language: {
      type: String,
      default: 'English',
      trim: true
    },
    volume: {
      type: String,
      trim: true
    },
    subject: {
      type: String,
      trim: true
    },
    accessionNumber: {
      type: String,
      trim: true,
      index: true
    },
    description: {
      type: String,
      default: ''
    },
    imageUrl: {
      type: String,
      trim: true
    },
    externalId: {
      type: String,
      trim: true,
      index: true
    },
    extraFields: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    isNewArrival: {
      type: Boolean,
      default: false,
      index: true
    },
    isRetired: {
      type: Boolean,
      default: false,
      index: true
    },
    retirementReason: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

bookSchema.index({ title: 'text', author: 'text', callNo: 'text', category: 'text', department: 'text' });

module.exports = mongoose.model('Book', bookSchema);

