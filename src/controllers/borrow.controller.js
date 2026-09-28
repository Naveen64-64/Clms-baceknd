const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const borrowService = require('../services/borrow.service');
const { ROLES } = require('../config/constants');

const issueBook = asyncHandler(async (req, res) => {
  const transaction = await borrowService.issueBook(req.body, req.user);
  return res.status(201).json(new ApiResponse(201, transaction, 'Book issued successfully'));
});

const returnBook = asyncHandler(async (req, res) => {
  const result = await borrowService.returnBook(req.body, req.user);
  const message = result.isOverdue
    ? `Book returned. Overdue fine calculated: ₹${result.fineAmount}`
    : 'Book returned successfully with no fine';
  return res.status(200).json(new ApiResponse(200, result, message));
});

const getOverdueBorrowings = asyncHandler(async (req, res) => {
  const overdues = await borrowService.getOverdueBorrowings(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, overdues, 'Overdue borrowings fetched successfully'));
});

const getStudentHistory = asyncHandler(async (req, res) => {
  let studentId = req.params.studentId;

  if (req.user.role === ROLES.STUDENT) {
    studentId = req.user.studentProfile?._id;
  }

  const history = await borrowService.getBorrowHistory(studentId, req.user);
  return res.status(200).json(new ApiResponse(200, history, 'Student borrowing history fetched successfully'));
});

module.exports = {
  issueBook,
  returnBook,
  getOverdueBorrowings,
  getStudentHistory
};
