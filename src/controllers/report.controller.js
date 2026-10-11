const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const VisitLog = require('../models/visitLog.model');
const Library = require('../models/library.model');
const { getMandatoryLibrarianProfile } = require('../utils/librarianScope');
const { ROLES } = require('../config/constants');

const getEmptyHours = asyncHandler(async (req, res) => {
  const { libraryId, date } = req.query;
  const librarianProfile = await getMandatoryLibrarianProfile(req.user);
  
  let targetLibId = libraryId;
  if (librarianProfile) {
    targetLibId = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
  }
  
  if (!targetLibId) {
    return res.status(400).json(new ApiResponse(400, null, 'Library ID is required'));
  }
  
  const targetDate = date ? new Date(date) : new Date();
  targetDate.setHours(0, 0, 0, 0);
  const nextDate = new Date(targetDate);
  nextDate.setDate(targetDate.getDate() + 1);
  
  const visits = await VisitLog.find({
    library: targetLibId,
    checkInTime: { $gte: targetDate, $lt: nextDate }
  }).sort({ checkInTime: 1 });
  
  // A simplistic empty hours calculation: 
  // Finding gaps between checkout and next checkin (for the library as a whole).
  let emptyPeriods = [];
  let currentMaxCheckout = targetDate;
  
  for (const visit of visits) {
    if (visit.checkInTime > currentMaxCheckout) {
      emptyPeriods.push({
        start: currentMaxCheckout,
        end: visit.checkInTime,
        durationMinutes: Math.round((visit.checkInTime - currentMaxCheckout) / 60000)
      });
    }
    const end = visit.checkoutTime || new Date();
    if (end > currentMaxCheckout) {
      currentMaxCheckout = end;
    }
  }
  
  const libraryEnd = new Date(targetDate);
  libraryEnd.setHours(20, 0, 0, 0); // Assuming 8 PM close
  if (currentMaxCheckout < libraryEnd) {
    emptyPeriods.push({
      start: currentMaxCheckout,
      end: libraryEnd,
      durationMinutes: Math.round((libraryEnd - currentMaxCheckout) / 60000)
    });
  }
  
  // Filter out tiny gaps (< 15 mins)
  emptyPeriods = emptyPeriods.filter(p => p.durationMinutes >= 15);
  
  return res.status(200).json(new ApiResponse(200, { date: targetDate, emptyPeriods }, 'Empty hours fetched'));
});

const reportService = require('../services/report.service');

const getDashboardSummary = asyncHandler(async (req, res) => {
  const result = await reportService.getDashboardSummary(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Dashboard summary report retrieved successfully'));
});

const getLibraryComparison = asyncHandler(async (req, res) => {
  const result = await reportService.getLibraryComparison(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Library comparison report retrieved successfully'));
});

const getBookAnalytics = asyncHandler(async (req, res) => {
  const result = await reportService.getBookAnalytics(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Book inventory analytics report retrieved successfully'));
});

const getMostBorrowedReport = asyncHandler(async (req, res) => {
  const result = await reportService.getMostBorrowedReport(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Most borrowed books report retrieved successfully'));
});

const getBorrowingAnalytics = asyncHandler(async (req, res) => {
  const result = await reportService.getBorrowingAnalytics(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Borrowing trends analytics report retrieved successfully'));
});

const getReturnsAnalytics = asyncHandler(async (req, res) => {
  const result = await reportService.getReturnsAnalytics(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Returns analytics report retrieved successfully'));
});

const getOverdueAnalytics = asyncHandler(async (req, res) => {
  const result = await reportService.getOverdueAnalytics(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Overdue analytics report retrieved successfully'));
});

const getVisitorAnalytics = asyncHandler(async (req, res) => {
  const result = await reportService.getVisitorAnalytics(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Visitor analytics report retrieved successfully'));
});

const getSeatUtilizationReport = asyncHandler(async (req, res) => {
  const result = await reportService.getSeatUtilizationReport(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Seat utilization report retrieved successfully'));
});

const getFinancialAnalytics = asyncHandler(async (req, res) => {
  const result = await reportService.getFinancialAnalytics(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Financial analytics report retrieved successfully'));
});

const getStudentActivityAnalytics = asyncHandler(async (req, res) => {
  const result = await reportService.getStudentActivityAnalytics(req.query, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Student activity analytics report retrieved successfully'));
});

module.exports = {
  getDashboardSummary,
  getLibraryComparison,
  getBookAnalytics,
  getMostBorrowedReport,
  getBorrowingAnalytics,
  getReturnsAnalytics,
  getOverdueAnalytics,
  getVisitorAnalytics,
  getSeatUtilizationReport,
  getFinancialAnalytics,
  getStudentActivityAnalytics,
  getEmptyHours
};
