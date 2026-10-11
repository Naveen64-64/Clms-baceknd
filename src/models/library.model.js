const mongoose = require('mongoose');

const librarySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Library name is required'],
      unique: true,
      trim: true
    },
    code: {
      type: String,
      required: [true, 'Library code is required'],
      unique: true,
      trim: true,
      uppercase: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    capacity: {
      type: Number,
      required: [true, 'Library capacity is required'],
      min: [1, 'Capacity must be at least 1'],
      default: 100
    },
    isWomenOnly: {
      type: Boolean,
      default: false
    },
    location: {
      type: String,
      trim: true
    },
    openingTime: {
      type: String,
      default: '09:00 AM'
    },
    closingTime: {
      type: String,
      default: '05:00 PM'
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'MAINTENANCE'],
      default: 'ACTIVE'
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Library', librarySchema);
