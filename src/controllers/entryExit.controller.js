const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const entryExitService = require('../services/entryExit.service');

const toggleEntryExit = asyncHandler(async (req, res) => {
<<<<<<< HEAD
  const { rollNumber, userId, userIdentifier, libraryId, action, candidates } = req.body;
  const targetIdentifier = userIdentifier || userId || rollNumber;
  const targetLibraryId = libraryId || req.params.libraryId;

  const result = await entryExitService.processGateEntryExit(targetIdentifier, targetLibraryId, req.user, action, candidates);
=======
  const { rollNumber, userId, userIdentifier, libraryId, action } = req.body;
  const targetIdentifier = userIdentifier || userId || rollNumber;
  const targetLibraryId = libraryId || req.params.libraryId;

  const result = await entryExitService.processGateEntryExit(targetIdentifier, targetLibraryId, req.user, action);
>>>>>>> 896b1feddeb4731643c43df589ca8ef7b6d8eaa2
  const identifierText = result.userId || result.rollNumber;
  const message = result.action === 'IN' ? `Check-IN successful for ${identifierText}` : `Check-OUT successful for ${identifierText}`;
  return res.status(200).json(new ApiResponse(200, result, message));
});

const getActiveVisits = asyncHandler(async (req, res) => {
  const libraryId = req.params.libraryId || req.query.libraryId;
  const visits = await entryExitService.getActiveVisitsForLibrary(libraryId, req.user);
  return res.status(200).json(new ApiResponse(200, visits, 'Active library visits retrieved successfully'));
});

const getRecentVisits = asyncHandler(async (req, res) => {
  const libraryId = req.params.libraryId || req.query.libraryId;
<<<<<<< HEAD
  const limit = parseInt(req.query.limit, 10) || 20;
  const visits = await entryExitService.getRecentVisitsForLibrary(libraryId, limit);
=======
  const visits = await entryExitService.getRecentVisitsForLibrary(libraryId, 10);
>>>>>>> 896b1feddeb4731643c43df589ca8ef7b6d8eaa2
  return res.status(200).json(new ApiResponse(200, visits, 'Recent library visits retrieved successfully'));
});

module.exports = {
  toggleEntryExit,
  getActiveVisits,
  getRecentVisits
};
