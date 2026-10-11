const User = require('../models/user.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const Library = require('../models/library.model');
const AdminSetting = require('../models/adminSetting.model');
const { ROLES, DEFAULT_SETTINGS } = require('../config/constants');
const { hashPassword } = require('../utils/password');
const { runInTransaction } = require('../utils/transaction');
const ApiError = require('../utils/apiError');

const createLibrarian = async (librarianData) => {
  const { name, email, phone, password, assignedLibraryId } = librarianData;

  const formattedEmail = email.trim().toLowerCase();
  const library = await Library.findById(assignedLibraryId);
  if (!library) {
    throw new ApiError(404, 'Assigned library does not exist');
  }

  const existingUser = await User.findOne({ username: formattedEmail });
  if (existingUser) {
    throw new ApiError(400, `User with email ${formattedEmail} already exists`);
  }

  const hashedPassword = await hashPassword(password);

  return await runInTransaction(async (session) => {
    const opts = session ? { session } : {};

    const [newUser] = await User.create(
      [
        {
          username: formattedEmail,
          password: hashedPassword,
          role: ROLES.LIBRARIAN,
          isActive: true
        }
      ],
      opts
    );

    const [newLibrarianProfile] = await LibrarianProfile.create(
      [
        {
          user: newUser._id,
          name,
          email: formattedEmail,
          phone: phone || '',
          assignedLibrary: library._id
        }
      ],
      opts
    );

    return {
      id: newLibrarianProfile._id,
      name: newLibrarianProfile.name,
      email: newLibrarianProfile.email,
      phone: newLibrarianProfile.phone,
      assignedLibrary: {
        id: library._id,
        name: library.name,
        code: library.code
      }
    };
  });
};

const getAllLibrarians = async () => {
  return await LibrarianProfile.find()
    .populate('assignedLibrary', 'name code location capacity status')
    .populate('user', 'username isActive createdAt');
};

const getLibrarianById = async (librarianId) => {
  const librarian = await LibrarianProfile.findById(librarianId)
    .populate('assignedLibrary', 'name code location capacity status')
    .populate('user', 'username isActive createdAt');
  if (!librarian) throw new ApiError(404, 'Librarian profile not found');
  return librarian;
};

const updateLibrarian = async (librarianId, updateData) => {
  const librarian = await LibrarianProfile.findById(librarianId);
  if (!librarian) throw new ApiError(404, 'Librarian profile not found');

  const { name, phone, assignedLibraryId } = updateData;

  if (assignedLibraryId) {
    const library = await Library.findById(assignedLibraryId);
    if (!library) throw new ApiError(404, 'New assigned library not found');
    librarian.assignedLibrary = library._id;
  }

  if (name) librarian.name = name;
  if (phone !== undefined) librarian.phone = phone;

  await librarian.save();
  return await getLibrarianById(librarianId);
};

const toggleLibrarianStatus = async (librarianId, isActive) => {
  const librarian = await LibrarianProfile.findById(librarianId);
  if (!librarian) throw new ApiError(404, 'Librarian profile not found');

  const user = await User.findById(librarian.user);
  if (!user) throw new ApiError(404, 'Librarian user account not found');

  user.isActive = Boolean(isActive);
  await user.save();

  return {
    librarianId: librarian._id,
    username: user.username,
    isActive: user.isActive
  };
};

const resetLibrarianPassword = async (librarianId, newPassword) => {
  const librarian = await LibrarianProfile.findById(librarianId);
  if (!librarian) throw new ApiError(404, 'Librarian profile not found');

  const user = await User.findById(librarian.user);
  if (!user) throw new ApiError(404, 'Librarian user account not found');

  user.password = await hashPassword(newPassword);
  user.refreshToken = null; // Revoke tokens
  await user.save();

  return {
    librarianId: librarian._id,
    username: user.username,
    message: 'Password reset successfully'
  };
};

const getAdminSettings = async () => {
  let settings = await AdminSetting.findOne();
  if (!settings) {
    settings = await AdminSetting.create({});
  }

  const fineRate = settings.fineRatePerOverdueDay ?? settings.finePerDay ?? DEFAULT_SETTINGS.FINE_PER_DAY;
  const maxBorrow = settings.defaultMaxBorrowLimit ?? settings.maxBooksPerStudent ?? DEFAULT_SETTINGS.MAX_BOOKS_PER_STUDENT;
  const loanDays = settings.standardLoanDurationDays ?? settings.defaultLoanDays ?? DEFAULT_SETTINGS.DEFAULT_LOAN_DAYS;
  const deposit = settings.initialSecurityDeposit ?? DEFAULT_SETTINGS.INITIAL_DEPOSIT_AMOUNT;

  return {
    _id: settings._id,
    fineRatePerOverdueDay: fineRate,
    finePerDay: fineRate,
    fineRatePerDay: fineRate,
    defaultMaxBorrowLimit: maxBorrow,
    maxBooksPerStudent: maxBorrow,
    maxBorrowLimit: maxBorrow,
    standardLoanDurationDays: loanDays,
    defaultLoanDays: loanDays,
    loanDurationDays: loanDays,
    initialSecurityDeposit: deposit,
    updatedBy: settings.updatedBy,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt
  };
};

const updateAdminSettings = async (settingsData, updatedByUserId) => {
  let settings = await AdminSetting.findOne();
  if (!settings) {
    settings = new AdminSetting();
  }

  const maxBorrow = settingsData.defaultMaxBorrowLimit ?? settingsData.maxBorrowLimit ?? settingsData.maxBooksPerStudent;
  if (maxBorrow !== undefined) {
    const parsed = Number(maxBorrow);
    if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1) {
      throw new ApiError(400, 'defaultMaxBorrowLimit must be an integer of at least 1');
    }
    settings.maxBooksPerStudent = parsed;
    settings.defaultMaxBorrowLimit = parsed;
  }

  const loanDays = settingsData.standardLoanDurationDays ?? settingsData.loanDurationDays ?? settingsData.defaultLoanDays;
  if (loanDays !== undefined) {
    const parsed = Number(loanDays);
    if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1) {
      throw new ApiError(400, 'standardLoanDurationDays must be an integer of at least 1');
    }
    settings.defaultLoanDays = parsed;
    settings.standardLoanDurationDays = parsed;
  }

  const fineRate = settingsData.fineRatePerOverdueDay ?? settingsData.fineRatePerDay ?? settingsData.finePerDay;
  if (fineRate !== undefined) {
    const parsed = Number(fineRate);
    if (isNaN(parsed) || parsed < 0) {
      throw new ApiError(400, 'fineRatePerOverdueDay must be a non-negative number');
    }
    settings.finePerDay = parsed;
    settings.fineRatePerOverdueDay = parsed;
  }

  if (settingsData.initialSecurityDeposit !== undefined) {
    const parsed = Number(settingsData.initialSecurityDeposit);
    if (isNaN(parsed) || parsed < 0) {
      throw new ApiError(400, 'initialSecurityDeposit cannot be negative');
    }
    settings.initialSecurityDeposit = parsed;
  }

  settings.updatedBy = updatedByUserId;
  await settings.save();
  return await getAdminSettings();
};

module.exports = {
  createLibrarian,
  getAllLibrarians,
  getLibrarianById,
  updateLibrarian,
  toggleLibrarianStatus,
  resetLibrarianPassword,
  getAdminSettings,
  updateAdminSettings
};
