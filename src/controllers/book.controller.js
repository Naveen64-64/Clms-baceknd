const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const bookService = require('../services/book.service');

const createBook = asyncHandler(async (req, res) => {
  const book = await bookService.createBook(req.body, req.user);
  return res.status(201).json(new ApiResponse(201, book, 'Master book created successfully'));
});

const updateBook = asyncHandler(async (req, res) => {
  const { bookId } = req.params;
  const book = await bookService.updateBook(bookId, req.body, req.user);
  return res.status(200).json(new ApiResponse(200, book, 'Master book updated successfully'));
});

const retireBookMaster = asyncHandler(async (req, res) => {
  const { bookId } = req.params;
  const { reason } = req.body;
  const book = await bookService.retireBookMaster(bookId, reason, req.user);
  return res.status(200).json(new ApiResponse(200, book, 'Master book retired successfully'));
});

const addBookCopy = asyncHandler(async (req, res) => {
  const copy = await bookService.addBookCopy(req.body, req.user.id);
  return res.status(201).json(new ApiResponse(201, copy, 'Book copy registered successfully'));
});

const getBookCopyById = asyncHandler(async (req, res) => {
  const { copyId } = req.params;
  const copy = await bookService.getBookCopyById(copyId, req.user);
  return res.status(200).json(new ApiResponse(200, copy, 'Book copy retrieved successfully'));
});

const updateBookCopy = asyncHandler(async (req, res) => {
  const { copyId } = req.params;
  const copy = await bookService.updateBookCopy(copyId, req.body, req.user);
  return res.status(200).json(new ApiResponse(200, copy, 'Book copy updated successfully'));
});

const searchBooks = asyncHandler(async (req, res) => {
  const result = await bookService.searchBooks(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Books catalog searched successfully'));
});

const getNewArrivals = asyncHandler(async (req, res) => {
  let result = await bookService.searchBooks({ ...req.query, isNewArrival: true, sortBy: 'createdAt', sortOrder: 'desc' }, req.user);
  if (!result || !result.books || result.books.length === 0) {
    result = await bookService.searchBooks({ ...req.query, sortBy: 'createdAt', sortOrder: 'desc', limit: req.query.limit || 12 }, req.user);
  }
  return res.status(200).json(new ApiResponse(200, result, 'New arrivals retrieved successfully'));
});

const getBookDetails = asyncHandler(async (req, res) => {
  const { bookId } = req.params;
  const result = await bookService.getBookDetails(bookId, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Book details retrieved successfully'));
});

const retireBookCopy = asyncHandler(async (req, res) => {
  const { copyId } = req.params;
  const { reason } = req.body;
  const copy = await bookService.retireBookCopy(copyId, reason, req.user.id);
  return res.status(200).json(new ApiResponse(200, copy, 'Book copy retired successfully'));
});

const getLibrarianInventory = asyncHandler(async (req, res) => {
  const result = await bookService.getLibrarianBookInventory(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Librarian library book inventory retrieved successfully'));
});

const getAdminInventory = asyncHandler(async (req, res) => {
  const result = await bookService.getAdminBookInventory(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Admin system-wide book inventory retrieved successfully'));
});

const importBooks = asyncHandler(async (req, res) => {
  const dataset = req.body.books ? req.body : require('../data/college_library_branch_books_demo.json');
  const summary = await bookService.importBooksDataset(dataset, req.user);
  return res.status(200).json(new ApiResponse(200, summary, 'Book dataset imported successfully'));
});

const getCategories = asyncHandler(async (req, res) => {
  const categories = await bookService.getCategories();
  return res.status(200).json(new ApiResponse(200, categories, 'Categories fetched successfully'));
});

const getFilterOptions = asyncHandler(async (req, res) => {
  const options = await bookService.getFilterOptions();
  return res.status(200).json(new ApiResponse(200, options, 'Filter options fetched successfully'));
});

module.exports = {
  createBook,
  updateBook,
  retireBookMaster,
  addBookCopy,
  getBookCopyById,
  updateBookCopy,
  searchBooks,
  getNewArrivals,
  getBookDetails,
  getCategories,
  getFilterOptions,
  retireBookCopy,
  getLibrarianInventory,
  getAdminInventory,
  importBooks
};
