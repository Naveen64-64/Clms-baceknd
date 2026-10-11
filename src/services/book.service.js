const mongoose = require('mongoose');
const Book = require('../models/book.model');
const BookCopy = require('../models/bookCopy.model');
const Library = require('../models/library.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const { BOOK_STATUS, GENDERS, ROLES } = require('../config/constants');
const ApiError = require('../utils/apiError');
const { getMandatoryLibrarianProfile } = require('../utils/librarianScope');

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const mapBranchQuery = (branchStr) => {
  if (!branchStr) return null;
  const u = String(branchStr).trim().toUpperCase();
  if (u === 'AIDS') return { $in: ['AIDS', 'AID'] };
  if (u === 'CSM') return { $in: ['CSM', 'AIML'] };
  if (u === 'CSD') return { $in: ['CSD', 'CDS'] };
  if (u === 'CSC') return { $in: ['CSC'] };
  if (u === 'CAI') return { $in: ['CAI'] };
  return u;
};
const createBook = async (bookData, callingUser = null) => {
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);

  const {
    callNo,
    isbn,
    title,
    author,
    category,
    department,
    branch,
    publisher,
    edition,
    publicationYear,
    pages,
    price,
    language,
    subject,
    accessionNumber,
    description,
    imageUrl,
    externalId,
    extraFields
  } = bookData;

  const formattedCallNo = (callNo || '').trim().toUpperCase();
  if (!formattedCallNo) {
    throw new ApiError(400, 'Call No is required');
  }

  const existing = await Book.findOne({ callNo: formattedCallNo });
  if (existing) {
    throw new ApiError(409, `Book with Call No ${formattedCallNo} already exists`);
  }

  return await Book.create({
    callNo: formattedCallNo,
    title: title.trim(),
    author: author.trim(),
    isbn: isbn ? isbn.trim().toUpperCase() : undefined,
    category: category.trim(),
    department: department ? department.trim() : undefined,
    branch: branch ? branch.trim().toUpperCase() : 'GENERAL',
    publisher: publisher ? publisher.trim() : 'Central Library',
    edition: edition ? edition.trim() : 'Standard',
    publicationYear: publicationYear ? Number(publicationYear) : undefined,
    pages: pages ? String(pages).trim() : undefined,
    price: price ? Number(price) : undefined,
    language: language ? language.trim() : 'English',
    subject: subject ? subject.trim() : undefined,
    accessionNumber: accessionNumber ? String(accessionNumber).trim() : undefined,
    description: description ? description.trim() : '',
    imageUrl: imageUrl ? imageUrl.trim() : '',
    externalId: externalId ? externalId.trim() : undefined,
    extraFields: extraFields || {}
  });
};

const updateBook = async (bookId, updateData, callingUser = null) => {
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);

  const book = await Book.findById(bookId);
  if (!book) throw new ApiError(404, 'Book master not found');

  // Section 6: Librarian may manage book master ONLY if represented in assigned library
  if (librarianProfile) {
    const hasCopyInLibrary = await BookCopy.exists({ book: book._id, library: librarianProfile.assignedLibrary });
    if (!hasCopyInLibrary) {
      throw new ApiError(403, 'Access denied: Librarians can only update master books represented in their assigned library');
    }
  }

  if (updateData.callNo) book.callNo = updateData.callNo.trim().toUpperCase();
  if (updateData.title) book.title = updateData.title.trim();
  if (updateData.author) book.author = updateData.author.trim();
  if (updateData.isbn !== undefined) book.isbn = updateData.isbn ? updateData.isbn.trim().toUpperCase() : undefined;
  if (updateData.category) book.category = updateData.category.trim();
  if (updateData.department !== undefined) book.department = updateData.department ? updateData.department.trim() : undefined;
  if (updateData.branch) book.branch = updateData.branch.trim().toUpperCase();
  if (updateData.publisher !== undefined) book.publisher = updateData.publisher.trim();
  if (updateData.edition !== undefined) book.edition = updateData.edition.trim();
  if (updateData.publicationYear !== undefined) book.publicationYear = updateData.publicationYear ? Number(updateData.publicationYear) : undefined;
  if (updateData.pages !== undefined) book.pages = updateData.pages ? String(updateData.pages).trim() : undefined;
  if (updateData.price !== undefined) book.price = updateData.price ? Number(updateData.price) : undefined;
  if (updateData.language !== undefined) book.language = updateData.language ? updateData.language.trim() : 'English';
  if (updateData.subject !== undefined) book.subject = updateData.subject ? updateData.subject.trim() : undefined;
  if (updateData.accessionNumber !== undefined) book.accessionNumber = updateData.accessionNumber ? String(updateData.accessionNumber).trim() : undefined;
  if (updateData.description !== undefined) book.description = updateData.description.trim();
  if (updateData.imageUrl !== undefined) book.imageUrl = updateData.imageUrl.trim();

  await book.save();
  return book;
};


const retireBookMaster = async (bookId, reason, callingUser) => {
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);

  const book = await Book.findById(bookId);
  if (!book) throw new ApiError(404, 'Book master not found');

  if (librarianProfile) {
    const hasCopyInLibrary = await BookCopy.exists({ book: book._id, library: librarianProfile.assignedLibrary });
    if (!hasCopyInLibrary) {
      throw new ApiError(403, 'Access denied: Librarians can only retire master books represented in their assigned library');
    }
  }

  // Prevent retirement if any copy is currently ISSUED
  const activeIssuedCopies = await BookCopy.countDocuments({ book: book._id, status: BOOK_STATUS.ISSUED });
  if (activeIssuedCopies > 0) {
    throw new ApiError(400, `Cannot retire book master: ${activeIssuedCopies} physical copy(ies) are currently ISSUED`);
  }

  book.isRetired = true;
  book.retirementReason = reason || 'Retired by administration';
  await book.save();

  // Also retire associated copies
  await BookCopy.updateMany(
    { book: book._id, isRetired: false },
    { isRetired: true, status: BOOK_STATUS.RETIRED, retiredReason: reason || 'Master book retired' }
  );

  return book;
};

const addBookCopy = async (copyData, librarianUserId) => {
  const { bookId, barcode, libraryId, rackLocation } = copyData;

  const librarianProfile = await getMandatoryLibrarianProfile({ role: ROLES.LIBRARIAN, id: librarianUserId });
  let targetLibraryId = libraryId;

  if (librarianProfile) {
    targetLibraryId = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
    if (libraryId && libraryId.toString() !== targetLibraryId.toString()) {
      throw new ApiError(403, 'Access denied: Librarians can only add copies to their assigned library');
    }
  }

  if (!targetLibraryId) {
    throw new ApiError(400, 'Library ID is required to add a book copy');
  }

  const book = await Book.findById(bookId);
  if (!book || book.isRetired) {
    throw new ApiError(404, 'Master book not found or is retired');
  }

  const library = await Library.findById(targetLibraryId);
  if (!library) throw new ApiError(404, 'Target library does not exist');

  const formattedBarcode = barcode.trim().toUpperCase();
  const existingCopy = await BookCopy.findOne({ barcode: formattedBarcode });
  if (existingCopy) {
    throw new ApiError(409, `Book copy with barcode ${formattedBarcode} already exists`);
  }

  return await BookCopy.create({
    book: book._id,
    library: library._id,
    barcode: formattedBarcode,
    rackLocation: rackLocation ? rackLocation.trim() : 'General Rack',
    status: BOOK_STATUS.AVAILABLE
  });
};

const getBookCopyById = async (copyId, callingUser = null) => {
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);

  const copy = await BookCopy.findById(copyId)
    .populate('book')
    .populate('library', 'name code location');

  if (!copy) throw new ApiError(404, 'Book copy not found');

  if (librarianProfile) {
    if (copy.library._id.toString() !== librarianProfile.assignedLibrary.toString()) {
      throw new ApiError(403, 'Access denied: You can only view copies in your assigned library');
    }
  }

  return copy;
};

const updateBookCopy = async (copyId, updateData, callingUser) => {
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);

  const copy = await BookCopy.findById(copyId);
  if (!copy) throw new ApiError(404, 'Book copy not found');

  if (librarianProfile) {
    if (copy.library.toString() !== librarianProfile.assignedLibrary.toString()) {
      throw new ApiError(403, 'Access denied: Librarians can only update copies in their assigned library');
    }
  }

  const { status, rackLocation, justification } = updateData;

  // Enforce Status Transition Constraints (Section 8)
  if (status && status !== copy.status) {
    const targetStatus = status.toUpperCase();

    if (copy.status === BOOK_STATUS.ISSUED && targetStatus === BOOK_STATUS.RETIRED) {
      throw new ApiError(400, 'Invalid transition: ISSUED copy cannot be RETIRED directly. Process return first.');
    }
    if (copy.status === BOOK_STATUS.RETIRED && targetStatus === BOOK_STATUS.AVAILABLE) {
      throw new ApiError(400, 'Invalid transition: RETIRED copy cannot be restored to AVAILABLE directly.');
    }
    if ((copy.status === 'LOST' || copy.status === 'DAMAGED') && targetStatus === BOOK_STATUS.AVAILABLE) {
      if (!justification) {
        throw new ApiError(400, 'Staff justification is required to restore LOST or DAMAGED copies to AVAILABLE');
      }
    }

    copy.status = targetStatus;
    if (targetStatus === BOOK_STATUS.RETIRED) {
      copy.isRetired = true;
    }
  }

  if (rackLocation) copy.rackLocation = rackLocation.trim();
  await copy.save();

  return copy;
};

const retireBookCopy = async (copyId, reason, librarianUserId) => {
  const librarianProfile = await getMandatoryLibrarianProfile({ role: ROLES.LIBRARIAN, id: librarianUserId });

  const copy = await BookCopy.findById(copyId);
  if (!copy) throw new ApiError(404, 'Book copy not found');

  if (copy.status === BOOK_STATUS.ISSUED) {
    throw new ApiError(400, 'Cannot retire an actively issued book copy. Process return or Lost/Damaged state first.');
  }

  if (librarianProfile) {
    if (librarianProfile.assignedLibrary.toString() !== copy.library.toString()) {
      throw new ApiError(403, 'Access denied: Librarians can only retire copies in their assigned library');
    }
  }

  copy.isRetired = true;
  copy.status = BOOK_STATUS.RETIRED;
  copy.retiredReason = reason || 'Retired by staff';
  await copy.save();

  return copy;
};

const searchBooks = async (query = {}, user = null) => {
  const { search, category, branch, department, author, page = 1, limit = 20, includeRetired = false, isNewArrival, availability } = query;

  let libraryId = null;
  if (query.libraryId) {
    libraryId = mongoose.Types.ObjectId.isValid(query.libraryId) ? new mongoose.Types.ObjectId(query.libraryId) : null;
  }

  const bookFilter = {};
  if (!includeRetired) bookFilter.isRetired = false;

  if (isNewArrival === 'true' || isNewArrival === true) {
    bookFilter.isNewArrival = true;
  }
  if (category) bookFilter.category = category.trim();
  if (department) bookFilter.department = department.trim();
  if (branch) {
    bookFilter.branch = mapBranchQuery(branch);
  }

  if (search) {
    const trimmed = search.trim();
    const safeSearch = escapeRegex(trimmed);
    const searchRegex = new RegExp(safeSearch, 'i');
    const searchConditions = [
      { title: searchRegex },
      { author: searchRegex },
      { isbn: searchRegex },
      { category: searchRegex },
      { department: searchRegex },
      { publisher: searchRegex },
      { callNo: searchRegex }
    ];
    if (mongoose.Types.ObjectId.isValid(trimmed)) {
      searchConditions.push({ _id: new mongoose.Types.ObjectId(trimmed) });
    }
    bookFilter.$or = searchConditions;
  }

  let resolvedTargetLibId = null;
  if (libraryId) {
    let lib = await Library.findOne({ code: libraryId });
    if (!lib && mongoose.Types.ObjectId.isValid(libraryId)) {
      lib = await Library.findById(libraryId);
    }
    resolvedTargetLibId = lib ? lib._id.toString() : libraryId.toString();
  }

  // Determine allowed library IDs based on student gender
  let allowedLibraryIds = null;
  if (user && user.role === ROLES.STUDENT) {
    const studentGender = user.studentProfile?.gender || user.gender;
    if (studentGender === GENDERS.MALE) {
      const maleAllowedLibs = await Library.find({ isWomenOnly: false, code: { $ne: 'KIET_WOMEN' } }).select('_id');
      allowedLibraryIds = maleAllowedLibs.map((l) => l._id.toString());
    }
  }

  if (availability === 'AVAILABLE' || availability === 'available' || availability === 'true') {
    const copyCond = { status: BOOK_STATUS.AVAILABLE, isRetired: false };
    if (resolvedTargetLibId) {
      copyCond.library = resolvedTargetLibId;
    } else if (allowedLibraryIds !== null) {
      copyCond.library = { $in: allowedLibraryIds };
    }
    const availableBookIds = await BookCopy.distinct('book', copyCond);
    bookFilter._id = { $in: availableBookIds };
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  let sortCriteria = { callNo: 1, title: 1, _id: 1 };
  if (query.sortBy === 'createdAt' || query.sortBy === 'newest') {
    sortCriteria = { createdAt: query.sortOrder === 'asc' ? 1 : -1, _id: -1 };
  } else if (query.sortBy === 'title') {
    sortCriteria = { title: query.sortOrder === 'desc' ? -1 : 1, _id: 1 };
  } else if (query.sortBy === 'callNo') {
    sortCriteria = { callNo: query.sortOrder === 'desc' ? -1 : 1, title: 1, _id: 1 };
  }

  const books = await Book.find(bookFilter).sort(sortCriteria).skip(skip).limit(limitNum);
  const totalBooksCount = await Book.countDocuments(bookFilter);

  const bookIds = books.map((b) => b._id);
  const globalCopyFilter = { book: { $in: bookIds }, isRetired: false };

  if (allowedLibraryIds !== null) {
    if (resolvedTargetLibId) {
      if (allowedLibraryIds.includes(resolvedTargetLibId)) {
        globalCopyFilter.library = resolvedTargetLibId;
      } else {
        globalCopyFilter.library = { $in: [] };
      }
    } else {
      globalCopyFilter.library = { $in: allowedLibraryIds };
    }
  } else if (resolvedTargetLibId) {
    globalCopyFilter.library = resolvedTargetLibId;
  }

  const allCopiesBulk = await BookCopy.find(globalCopyFilter).populate('library', 'name code location isWomenOnly');

  const copiesByBook = {};
  bookIds.forEach((id) => (copiesByBook[id.toString()] = []));
  allCopiesBulk.forEach((c) => {
    copiesByBook[c.book.toString()].push(c);
  });

  const isStaff = user && [ROLES.LIBRARIAN, ROLES.ADMIN].includes(user.role);

  const results = books.map((book) => {
    const allCopies = copiesByBook[book._id.toString()] || [];

    const totalCopies = allCopies.length;
    const availableCopies = allCopies.filter((c) => c.status === BOOK_STATUS.AVAILABLE).length;
    const issuedCopies = allCopies.filter((c) => c.status === BOOK_STATUS.ISSUED).length;
    const lostCopies = allCopies.filter((c) => c.status === 'LOST').length;
    const damagedCopies = allCopies.filter((c) => c.status === 'DAMAGED').length;

    const libraryDistribution = {};
    allCopies.forEach((c) => {
      const libCode = c.library?.code || 'UNKNOWN';
      if (!libraryDistribution[libCode]) {
        libraryDistribution[libCode] = {
          libraryName: c.library?.name,
          code: libCode,
          total: 0,
          available: 0,
          issued: 0
        };
      }
      libraryDistribution[libCode].total++;
      if (c.status === BOOK_STATUS.AVAILABLE) libraryDistribution[libCode].available++;
      if (c.status === BOOK_STATUS.ISSUED) libraryDistribution[libCode].issued++;
    });

    const bookObj = {
      id: book._id.toString(),
      _id: book._id,
      bookId: book._id.toString(),
      callNo: book.callNo,
      title: book.title,
      author: book.author,
      isbn: book.isbn || '',
      category: book.category,
      department: book.department || '',
      branch: book.branch,
      publisher: book.publisher || '',
      edition: book.edition || '',
      publicationYear: book.publicationYear,
      pages: book.pages || '',
      language: book.language || 'English',
      subject: book.subject || '',
      description: book.description || '',
      imageUrl: book.imageUrl || '',
      totalCopies,
      availableCopies,
      issuedCopies,
      lostCopies,
      damagedCopies,
      availability: availableCopies > 0 ? 'AVAILABLE' : totalCopies > 0 ? 'ISSUED' : 'UNAVAILABLE',
      libraryDistribution: Object.values(libraryDistribution)
    };

    if (isStaff) {
      bookObj.accessionNumber = book.accessionNumber || '';
      bookObj.price = book.price || 0;
      bookObj.extraFields = book.extraFields || {};
      bookObj.isRetired = book.isRetired;
      bookObj.retirementReason = book.retirementReason;
    }

    return bookObj;
  });

  const totalPages = Math.ceil(totalBooksCount / limitNum);

  return {
    books: results,
    pagination: {
      total: totalBooksCount,
      page: pageNum,
      limit: limitNum,
      totalPages,
      hasMore: pageNum < totalPages
    }
  };
};

const getBookDetails = async (bookId, user = null) => {
  let book = null;
  const cleanId = String(bookId || '').trim();
  if (mongoose.Types.ObjectId.isValid(cleanId)) {
    book = await Book.findById(cleanId);
  }
  if (!book) {
    book = await Book.findOne({ callNo: cleanId.toUpperCase() });
  }
  if (!book) throw new ApiError(404, 'Book not found');

  const copyFilter = { book: book._id, isRetired: false };

  if (user && user.role === ROLES.STUDENT) {
    const studentGender = user.studentProfile?.gender || user.gender;
    if (studentGender === GENDERS.MALE) {
      const maleAllowedLibs = await Library.find({ isWomenOnly: false, code: { $ne: 'KIET_WOMEN' } }).select('_id');
      copyFilter.library = { $in: maleAllowedLibs.map((l) => l._id) };
    }
  }

  const copies = await BookCopy.find(copyFilter).populate('library', 'name code location capacity isWomenOnly');

  const totalCopies = copies.length;
  const availableCopies = copies.filter((c) => c.status === BOOK_STATUS.AVAILABLE).length;
  const issuedCopies = copies.filter((c) => c.status === BOOK_STATUS.ISSUED).length;
  const damagedCopies = copies.filter((c) => c.status === 'DAMAGED').length;
  const lostCopies = copies.filter((c) => c.status === 'LOST').length;

  const isStaff = user && [ROLES.LIBRARIAN, ROLES.ADMIN].includes(user.role);
  let bookData = book.toObject();
  bookData.bookId = book._id.toString();
  bookData.id = book._id.toString();
  if (!isStaff) {
    delete bookData.price;
    delete bookData.extraFields;
    delete bookData.isRetired;
    delete bookData.retirementReason;
  }

  return {
    book: bookData,
    totalCopies,
    availableCopies,
    issuedCopies,
    damagedCopies,
    lostCopies,
    copies: copies.map((c) => ({
      id: c._id,
      barcode: c.barcode,
      copyNumber: c.copyNumber,
      status: c.status,
      rackLocation: c.rackLocation,
      library: c.library
    }))
  };
};

const getLibrarianBookInventory = async (query = {}, librarianUser) => {
  const librarianProfile = await getMandatoryLibrarianProfile(librarianUser.role ? librarianUser : { role: ROLES.LIBRARIAN, id: librarianUser });

  const rawAssignedLib = librarianProfile?.assignedLibrary?._id || librarianProfile?.assignedLibrary;
  const assignedLibId = rawAssignedLib ? rawAssignedLib.toString() : null;
  const { branch, category, department, search, status, page = 1, limit = 20 } = query;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  let libraryId = assignedLibId;
  if (query.libraryId && query.libraryId !== 'ALL') {
    let lib = await Library.findOne({ code: query.libraryId });
    if (!lib && mongoose.Types.ObjectId.isValid(query.libraryId)) {
      lib = await Library.findById(query.libraryId);
    }
    libraryId = lib ? lib._id.toString() : query.libraryId.toString();
  }

  // Check if assigned library has copies in Atlas
  let copyLibraryFilter = null;
  if (libraryId) {
    const libCopiesCount = await BookCopy.countDocuments({ library: libraryId });
    if (libCopiesCount > 0) {
      copyLibraryFilter = libraryId;
    } else {
      // Preserving centralized architecture: if assigned library has 0 copies, fallback to all institutional copies
      const totalGlobalCopies = await BookCopy.countDocuments({});
      if (totalGlobalCopies > 0) {
        copyLibraryFilter = null;
      } else {
        copyLibraryFilter = libraryId;
      }
    }
  }

  const bookFilter = { isRetired: false };
  let hasBookFilter = false;

  if (branch) {
    hasBookFilter = true;
    bookFilter.branch = mapBranchQuery(branch);
  }
  if (category) {
    hasBookFilter = true;
    bookFilter.category = category.trim();
  }
  if (department) {
    hasBookFilter = true;
    bookFilter.department = department.trim();
  }

  let matchingBookIds = null;
  if (search) {
    const trimmedSearch = search.trim();
    const reg = new RegExp(escapeRegex(trimmedSearch), 'i');
    const searchConditions = [
      { title: reg },
      { author: reg },
      { isbn: reg },
      { category: reg },
      { callNo: reg }
    ];
    if (mongoose.Types.ObjectId.isValid(trimmedSearch)) {
      searchConditions.push({ _id: new mongoose.Types.ObjectId(trimmedSearch) });
    }
    const searchBookIds = await Book.find({
      $or: searchConditions
    }).distinct('_id');

    const copyOrConditions = [{ barcode: reg }];
    if (mongoose.Types.ObjectId.isValid(trimmedSearch)) {
      copyOrConditions.push({ _id: new mongoose.Types.ObjectId(trimmedSearch) });
    }
    const copySearchCond = { $or: copyOrConditions };
    if (copyLibraryFilter) copySearchCond.library = copyLibraryFilter;
    const searchCopyBookIds = await BookCopy.find(copySearchCond).distinct('book');
    matchingBookIds = Array.from(new Set([...searchBookIds.map(String), ...searchCopyBookIds.map(String)]));
  }

  const copyFilter = {};
  if (copyLibraryFilter) copyFilter.library = copyLibraryFilter;

  if (status) {
    const uStatus = status.trim().toUpperCase();
    if (uStatus === 'RETIRED') {
      copyFilter.isRetired = true;
    } else {
      copyFilter.status = uStatus;
    }
  }

  if (hasBookFilter || matchingBookIds !== null) {
    if (hasBookFilter) {
      const filteredIds = await Book.find(bookFilter).distinct('_id');
      if (matchingBookIds !== null) {
        const idSet = new Set(filteredIds.map(String));
        matchingBookIds = matchingBookIds.filter((id) => idSet.has(id));
      } else {
        matchingBookIds = filteredIds.map(String);
      }
    }
    copyFilter.book = { $in: matchingBookIds };
  }

  const statsMatch = {};
  if (copyLibraryFilter) statsMatch.library = new mongoose.Types.ObjectId(copyLibraryFilter);

  const statsAgg = await BookCopy.aggregate([
    { $match: statsMatch },
    {
      $group: {
        _id: null,
        totalCopies: { $sum: 1 },
        available: { $sum: { $cond: [{ $eq: ['$status', 'AVAILABLE'] }, 1, 0] } },
        issued: { $sum: { $cond: [{ $eq: ['$status', 'ISSUED'] }, 1, 0] } },
        damaged: { $sum: { $cond: [{ $eq: ['$status', 'DAMAGED'] }, 1, 0] } },
        lost: { $sum: { $cond: [{ $eq: ['$status', 'LOST'] }, 1, 0] } },
        retired: { $sum: { $cond: ['$isRetired', 1, 0] } }
      }
    }
  ]);

  const stats = statsAgg[0] || {
    totalCopies: 0,
    available: 0,
    issued: 0,
    damaged: 0,
    lost: 0,
    retired: 0
  };

  const totalCopiesCount = await BookCopy.countDocuments(copyFilter);
  const copies = await BookCopy.find(copyFilter)
    .populate('book')
    .populate('library', 'name code location')
    .sort({ createdAt: -1, _id: 1 })
    .skip(skip)
    .limit(limitNum);

  const branchAgg = await Book.aggregate([
    { $match: { isRetired: false } },
    { $group: { _id: '$branch', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 8 }
  ]);
  const branchBreakdown = branchAgg.map((b) => ({ branch: b._id || 'GENERAL', count: b.count }));
  const totalPages = Math.ceil(totalCopiesCount / limitNum);

  return {
    inventoryStats: stats,
    branchBreakdown,
    copies,
    pagination: {
      total: totalCopiesCount,
      page: pageNum,
      limit: limitNum,
      totalPages,
      hasMore: pageNum < totalPages
    }
  };
};


const getAdminBookInventory = async (query = {}, callingUser = null) => {
  if (callingUser && callingUser.role !== ROLES.ADMIN) {
    throw new ApiError(403, 'Access denied: Admin inventory endpoint is strictly restricted to ADMIN role');
  }

  const { branch, category, department, libraryId, status, search, page = 1, limit = 20 } = query;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const copyFilter = {};
  if (libraryId) {
    let lib = await Library.findOne({ code: libraryId });
    if (!lib && mongoose.Types.ObjectId.isValid(libraryId)) {
      lib = await Library.findById(libraryId);
    }
    copyFilter.library = lib ? lib._id : libraryId;
  }
  if (status) copyFilter.status = status.toUpperCase();

  const bookFilter = {};
  let hasBookFilter = false;
  if (branch) {
    hasBookFilter = true;
    bookFilter.branch = mapBranchQuery(branch);
  }
  if (category) {
    hasBookFilter = true;
    bookFilter.category = category.trim();
  }
  if (department) {
    hasBookFilter = true;
    bookFilter.department = department.trim();
  }

  let matchingBookIds = null;
  if (search) {
    const trimmedSearch = search.trim();
    const reg = new RegExp(escapeRegex(trimmedSearch), 'i');
    const searchConditions = [
      { title: reg },
      { author: reg },
      { isbn: reg },
      { callNo: reg }
    ];
    if (mongoose.Types.ObjectId.isValid(trimmedSearch)) {
      searchConditions.push({ _id: new mongoose.Types.ObjectId(trimmedSearch) });
    }
    const searchBookIds = await Book.find({
      $or: searchConditions
    }).distinct('_id');

    const copyOrConditions = [{ barcode: reg }];
    if (mongoose.Types.ObjectId.isValid(trimmedSearch)) {
      copyOrConditions.push({ _id: new mongoose.Types.ObjectId(trimmedSearch) });
    }
    const copySearchFilter = { $or: copyOrConditions };
    if (copyFilter.library) copySearchFilter.library = copyFilter.library;
    const searchCopyBookIds = await BookCopy.find(copySearchFilter).distinct('book');
    matchingBookIds = Array.from(new Set([...searchBookIds.map(String), ...searchCopyBookIds.map(String)]));
  }

  if (hasBookFilter || matchingBookIds !== null) {
    if (hasBookFilter) {
      const filteredIds = await Book.find(bookFilter).distinct('_id');
      if (matchingBookIds !== null) {
        const idSet = new Set(filteredIds.map(String));
        matchingBookIds = matchingBookIds.filter((id) => idSet.has(id));
      } else {
        matchingBookIds = filteredIds.map(String);
      }
    }
    copyFilter.book = { $in: matchingBookIds };
  }

  const statsMatch = {};
  if (copyFilter.library) statsMatch.library = copyFilter.library;

  const statsAgg = await BookCopy.aggregate([
    { $match: statsMatch },
    {
      $group: {
        _id: null,
        totalCopies: { $sum: 1 },
        available: { $sum: { $cond: [{ $eq: ['$status', 'AVAILABLE'] }, 1, 0] } },
        issued: { $sum: { $cond: [{ $eq: ['$status', 'ISSUED'] }, 1, 0] } },
        damaged: { $sum: { $cond: [{ $eq: ['$status', 'DAMAGED'] }, 1, 0] } },
        lost: { $sum: { $cond: [{ $eq: ['$status', 'LOST'] }, 1, 0] } },
        retired: { $sum: { $cond: ['$isRetired', 1, 0] } }
      }
    }
  ]);

  const stats = statsAgg[0] || {
    totalCopies: 0,
    available: 0,
    issued: 0,
    damaged: 0,
    lost: 0,
    retired: 0
  };

  const totalCopiesCount = await BookCopy.countDocuments(copyFilter);
  const copies = await BookCopy.find(copyFilter)
    .populate('book')
    .populate('library', 'name code location')
    .sort({ createdAt: -1, _id: 1 })
    .skip(skip)
    .limit(limitNum);

  const totalPages = Math.ceil(totalCopiesCount / limitNum);

  return {
    inventoryStats: stats,
    copies,
    pagination: {
      total: totalCopiesCount,
      page: pageNum,
      limit: limitNum,
      totalPages,
      hasMore: pageNum < totalPages
    }
  };
};

const getCategories = async () => {
  const categories = await Book.distinct('category', { isRetired: false });
  return categories.filter(Boolean).sort();
};

const getFilterOptions = async () => {
  const [categories, departments, branches] = await Promise.all([
    Book.distinct('category', { isRetired: false }),
    Book.distinct('department', { isRetired: false }),
    Book.distinct('branch', { isRetired: false })
  ]);
  return {
    categories: categories.filter(Boolean).sort(),
    departments: departments.filter(Boolean).sort(),
    branches: branches.filter(Boolean).sort()
  };
};


// Bulk Import Service for Demo Dataset (Section 9)
const importBooksDataset = async (dataset, callingUser = null) => {
  const books = dataset.books || [];
  let booksCreated = 0;
  let booksSkipped = 0;
  let copiesCreated = 0;
  let duplicates = 0;
  const errors = [];

  let librarianAssignedLibId = null;
  if (callingUser && callingUser.role === ROLES.LIBRARIAN) {
    const libProfile = await getMandatoryLibrarianProfile(callingUser);
    librarianAssignedLibId = libProfile.assignedLibrary._id || libProfile.assignedLibrary;
  }

  const libraries = await Library.find({ status: { $ne: 'INACTIVE' }, code: { $in: ['KIET_MAIN', 'KIET_2', 'KIET_WOMEN'] } }).sort({ code: 1 });
  if (libraries.length === 0) {
    throw new ApiError(400, 'Cannot import books: No libraries found in database. Seed libraries first.');
  }

  const kietMain = libraries.find((l) => l.code === 'KIET_MAIN') || libraries[0];
  const kiet2 = libraries.find((l) => l.code === 'KIET_2') || libraries[1] || kietMain;
  const kietWomen = libraries.find((l) => l.code === 'KIET_WOMEN') || libraries[2] || kietMain;

  for (const item of books) {
    try {
      const formattedIsbn = item.isbn.trim().toUpperCase();
      let bookMaster = await Book.findOne({ isbn: formattedIsbn });

      if (!bookMaster) {
        bookMaster = await Book.create({
          externalId: item.externalId,
          title: item.title.trim(),
          author: item.author.trim(),
          isbn: formattedIsbn,
          category: item.category.trim(),
          branch: item.branch.trim().toUpperCase(),
          publisher: item.publisher || 'KIET Academic Press',
          edition: item.edition || '2025 Edition',
          description: item.description || '',
          imageUrl: item.imageUrl || ''
        });
        booksCreated++;
      } else {
        booksSkipped++;
      }

      const targetLibs = librarianAssignedLibId
        ? libraries.filter((l) => l._id.toString() === librarianAssignedLibId.toString())
        : libraries;

      for (const targetLib of targetLibs) {
        let libPrefix = 'KM';
        if (targetLib.code === 'KIET_2') libPrefix = 'K2';
        else if (targetLib.code === 'KIET_WOMEN') libPrefix = 'KW';
        else if (targetLib.code) libPrefix = targetLib.code.replace('KIET_', 'K');

        const cleanExtId = item.externalId.replace('DEMO-', '');

        for (let i = 1; i <= 10; i++) {
          const indexStr = String(i).padStart(2, '0');
          const barcode = `${libPrefix}-${item.branch}-${cleanExtId}-${indexStr}`;

          const existingCopy = await BookCopy.findOne({ barcode });
          if (!existingCopy) {
            await BookCopy.create({
              book: bookMaster._id,
              library: targetLib._id,
              barcode,
              rackLocation: item.rack || `${item.branch}-RACK-1`,
              status: BOOK_STATUS.AVAILABLE
            });
            copiesCreated++;
          } else {
            duplicates++;
          }
        }
      }
    } catch (err) {
      errors.push({ externalId: item.externalId, title: item.title, error: err.message });
    }
  }

  return {
    total: books.length,
    booksCreated,
    booksSkipped,
    copiesCreated,
    duplicates,
    errors
  };
};

module.exports = {
  createBook,
  updateBook,
  retireBookMaster,
  addBookCopy,
  getBookCopyById,
  updateBookCopy,
  retireBookCopy,
  searchBooks,
  getBookDetails,
  getCategories,
  getFilterOptions,
  getLibrarianBookInventory,
  getAdminBookInventory,
  importBooksDataset
};
