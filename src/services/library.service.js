const mongoose = require('mongoose');
const Library = require('../models/library.model');
const VisitLog = require('../models/visitLog.model');
const ApiError = require('../utils/apiError');
const libraryHoursService = require('./libraryHours.service');

const getLibrarySeatStatus = async (libraryId) => {
  let library = await Library.findOne({ code: libraryId });
  if (!library && mongoose.Types.ObjectId.isValid(libraryId)) {
    library = await Library.findById(libraryId);
  }

  if (!library) {
    throw new ApiError(400, 'Invalid library');
  }

  // 1. Resolve any stale active visits from previous days/sessions
  await libraryHoursService.closeStaleActiveVisits();

  // 2. Check operating hours
  const operatingStatus = libraryHoursService.isLibraryOpen();
  const isOpen = operatingStatus.isOpen;

  let activeVisits = 0;
  if (isOpen) {
    activeVisits = await VisitLog.countDocuments({
      library: library._id,
      checkoutTime: null
    });
  }

  const availableSeats = Math.max(0, library.capacity - activeVisits);

  return {
    library: {
      id: library._id,
      name: library.name,
      code: library.code,
      capacity: library.capacity,
      description: library.description,
      isWomenOnly: library.isWomenOnly,
      location: library.location,
      openingTime: library.openingTime || '09:00 AM',
      closingTime: library.closingTime || '05:00 PM',
      status: library.status
    },
    capacity: library.capacity,
    activeVisits,
    availableSeats,
    isFull: availableSeats === 0,
    isOpen,
    operatingHours: '09:00 AM - 05:00 PM',
    statusMessage: operatingStatus.message
  };
};

const getAllLibrariesStatus = async () => {
  // 1. Resolve any stale active visits
  await libraryHoursService.closeStaleActiveVisits();

  // 2. Check operating hours
  const operatingStatus = libraryHoursService.isLibraryOpen();
  const isOpen = operatingStatus.isOpen;

  const libraries = await Library.find({ status: { $ne: 'INACTIVE' }, code: { $in: ['KIET_MAIN', 'KIET_2', 'KIET_WOMEN'] } }).sort({ code: 1 });
  const results = await Promise.all(
    libraries.map(async (lib) => {
      let activeVisits = 0;
      if (isOpen) {
        activeVisits = await VisitLog.countDocuments({
          library: lib._id,
          checkoutTime: null
        });
      }
      return {
        id: lib._id,
        name: lib.name,
        code: lib.code,
        capacity: lib.capacity,
        description: lib.description,
        isWomenOnly: lib.isWomenOnly,
        location: lib.location,
        openingTime: lib.openingTime || '09:00 AM',
        closingTime: lib.closingTime || '05:00 PM',
        status: lib.status,
        activeVisits,
        availableSeats: Math.max(0, lib.capacity - activeVisits),
        isFull: activeVisits >= lib.capacity,
        isOpen,
        operatingHours: '09:00 AM - 05:00 PM',
        statusMessage: operatingStatus.message
      };
    })
  );
  return results;
};


const createLibrary = async (libraryData) => {
  const { name, code, capacity, isWomenOnly, location, description, openingTime, closingTime } = libraryData;

  if (capacity !== undefined && capacity < 1) {
    throw new ApiError(400, 'Library capacity must be at least 1');
  }

  const existing = await Library.findOne({ $or: [{ name }, { code }] });
  if (existing) {
    throw new ApiError(400, 'Library with this name or code already exists');
  }
  return await Library.create({ name, code, capacity, isWomenOnly, location, description, openingTime, closingTime });
};

const updateLibrary = async (libraryId, updateData) => {
  const library = await Library.findById(libraryId);
  if (!library) throw new ApiError(404, 'Library not found');

  if (updateData.capacity !== undefined && updateData.capacity < 1) {
    throw new ApiError(400, 'Capacity cannot be less than 1');
  }

  if (updateData.name) library.name = updateData.name;
  if (updateData.description !== undefined) library.description = updateData.description;
  if (updateData.capacity !== undefined) library.capacity = updateData.capacity;
  if (updateData.location !== undefined) library.location = updateData.location;
  if (updateData.openingTime !== undefined) library.openingTime = updateData.openingTime;
  if (updateData.closingTime !== undefined) library.closingTime = updateData.closingTime;
  if (updateData.status !== undefined) library.status = updateData.status;

  await library.save();
  return library;
};

module.exports = {
  getLibrarySeatStatus,
  getAllLibrariesStatus,
  createLibrary,
  updateLibrary
};
