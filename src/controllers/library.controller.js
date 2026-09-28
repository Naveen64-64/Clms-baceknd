const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const libraryService = require('../services/library.service');

const occupancyEvents = require('../services/occupancyEmitter');

const getAllLibrariesStatus = asyncHandler(async (req, res) => {
  const libraries = await libraryService.getAllLibrariesStatus();
  return res.status(200).json(new ApiResponse(200, libraries, 'Libraries availability fetched successfully'));
});

const getLibrarySeatStatus = asyncHandler(async (req, res) => {
  const { libraryId } = req.params;
  const status = await libraryService.getLibrarySeatStatus(libraryId);
  return res.status(200).json(new ApiResponse(200, status, 'Library seat availability fetched successfully'));
});

const streamOccupancyUpdates = (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date() })}\n\n`);

  const handleUpdate = (data) => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'OCCUPANCY_UPDATE', ...data })}\n\n`);
    } catch (e) {
      // client disconnected
    }
  };

  occupancyEvents.on('occupancyUpdated', handleUpdate);

  req.on('close', () => {
    occupancyEvents.removeListener('occupancyUpdated', handleUpdate);
  });
};

const createLibrary = asyncHandler(async (req, res) => {
  const library = await libraryService.createLibrary(req.body);
  return res.status(201).json(new ApiResponse(201, library, 'Library created successfully'));
});

const updateLibrary = asyncHandler(async (req, res) => {
  const { libraryId } = req.params;
  const library = await libraryService.updateLibrary(libraryId, req.body);
  return res.status(200).json(new ApiResponse(200, library, 'Library details updated successfully'));
});

module.exports = {
  getAllLibrariesStatus,
  getLibrarySeatStatus,
  streamOccupancyUpdates,
  createLibrary,
  updateLibrary
};
