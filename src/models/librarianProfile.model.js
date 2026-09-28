const mongoose = require('mongoose');

const librarianProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    name: {
      type: String,
      required: [true, 'Librarian name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Librarian email is required'],
      unique: true,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      trim: true
    },
    assignedLibrary: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Library',
      required: [true, 'Assigned Library is required for every Librarian'],
      index: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('LibrarianProfile', librarianProfileSchema);
