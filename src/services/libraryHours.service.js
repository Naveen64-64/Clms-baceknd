const VisitLog = require('../models/visitLog.model');
const Library = require('../models/library.model');
const occupancyEvents = require('./occupancyEmitter');

const LIBRARY_TIMEZONE = 'Asia/Kolkata';
const LIBRARY_OPEN_TIME = '09:00';
const LIBRARY_CLOSE_TIME = '17:00';
const LIBRARY_OPEN_HOUR = 9;
const LIBRARY_OPEN_MINUTE = 0;
const LIBRARY_CLOSE_HOUR = 17;
const LIBRARY_CLOSE_MINUTE = 0;

/**
 * Extracts date parts in Asia/Kolkata timezone with 100% precision.
 * @param {Date|string|number} date
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number, dateString: string, timeString: string }}
 */
const getKolkataDateParts = (date = new Date()) => {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : (date || new Date());
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: LIBRARY_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(d);
  const partMap = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }
  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10);
  const day = parseInt(partMap.day, 10);
  let hour = parseInt(partMap.hour, 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(partMap.minute, 10);
  const second = parseInt(partMap.second, 10);

  const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeString = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateString,
    timeString
  };
};

/**
 * Returns a Date object representing exactly 17:00:00.000 Asia/Kolkata on the date of the given timestamp.
 * @param {Date|string|number} date
 * @returns {Date}
 */
const getClosingTimeForDate = (date) => {
  const parts = getKolkataDateParts(date);
  const isoWithOffset = `${parts.dateString}T17:00:00.000+05:30`;
  return new Date(isoWithOffset);
};

/**
 * Returns a Date object representing exactly 09:00:00.000 Asia/Kolkata on the date of the given timestamp.
 * @param {Date|string|number} date
 * @returns {Date}
 */
const getOpeningTimeForDate = (date) => {
  const parts = getKolkataDateParts(date);
  const isoWithOffset = `${parts.dateString}T09:00:00.000+05:30`;
  return new Date(isoWithOffset);
};

/**
 * Evaluates whether CLMS libraries are strictly OPEN or CLOSED at the specified time.
 * Operating hours: 09:00:00 AM <= time < 05:00:00 PM (Asia/Kolkata).
 * @param {Date} [date=new Date()]
 * @returns {{ isOpen: boolean, code: 'OPEN'|'BEFORE_HOURS'|'AFTER_HOURS', message: string, openTime: string, closeTime: string, timezone: string, currentTime: string }}
 */
const isLibraryOpen = (date = new Date()) => {
  const parts = getKolkataDateParts(date);
  const currentTotalSeconds = parts.hour * 3600 + parts.minute * 60 + parts.second;
  const openTotalSeconds = LIBRARY_OPEN_HOUR * 3600 + LIBRARY_OPEN_MINUTE * 60; // 09:00:00 = 32400
  const closeTotalSeconds = LIBRARY_CLOSE_HOUR * 3600 + LIBRARY_CLOSE_MINUTE * 60; // 17:00:00 = 61200

  if (currentTotalSeconds < openTotalSeconds) {
    return {
      isOpen: false,
      code: 'BEFORE_HOURS',
      message: 'Library is closed. Entry is allowed from 9:00 AM.',
      openTime: '09:00 AM',
      closeTime: '05:00 PM',
      timezone: LIBRARY_TIMEZONE,
      currentTime: parts.timeString
    };
  }

  if (currentTotalSeconds >= closeTotalSeconds) {
    return {
      isOpen: false,
      code: 'AFTER_HOURS',
      message: 'Library is closed. Entry is allowed until 5:00 PM.',
      openTime: '09:00 AM',
      closeTime: '05:00 PM',
      timezone: LIBRARY_TIMEZONE,
      currentTime: parts.timeString
    };
  }

  return {
    isOpen: true,
    code: 'OPEN',
    message: 'Library is currently open.',
    openTime: '09:00 AM',
    closeTime: '05:00 PM',
    timezone: LIBRARY_TIMEZONE,
    currentTime: parts.timeString
  };
};

/**
 * Checks whether an active visit record is stale and should have been closed.
 * A visit is stale if checkoutTime is null AND the current time in Asia/Kolkata is at or past
 * the 05:00 PM closing time of the checkIn day.
 * @param {Object} visit
 * @param {Date} [currentDate=new Date()]
 * @returns {boolean}
 */
const isVisitStale = (visit, currentDate = new Date()) => {
  if (!visit || visit.checkoutTime) return false;
  const closingTime = getClosingTimeForDate(visit.checkInTime);
  return currentDate >= closingTime;
};

/**
 * Defensive Stale Visit Resolver.
 * Finds all active VisitLog records (checkoutTime: null) that belong to a previous operating window
 * or were open past 05:00 PM, and automatically updates checkoutTime to the respective 5:00 PM closing time.
 * @param {Date} [currentDate=new Date()]
 * @returns {Promise<{ closedCount: number, affectedLibraries: string[] }>}
 */
const closeStaleActiveVisits = async (currentDate = new Date()) => {
  try {
    const activeVisits = await VisitLog.find({ checkoutTime: null }).populate('library');
    if (!activeVisits || activeVisits.length === 0) {
      return { closedCount: 0, affectedLibraries: [] };
    }

    const staleVisits = activeVisits.filter((v) => isVisitStale(v, currentDate));
    if (staleVisits.length === 0) {
      return { closedCount: 0, affectedLibraries: [] };
    }

    const affectedLibraryIds = new Set();
    const bulkOps = staleVisits.map((v) => {
      const closingTime = getClosingTimeForDate(v.checkInTime);
      // Ensure checkoutTime is at least checkInTime
      const finalCheckoutTime = v.checkInTime > closingTime ? v.checkInTime : closingTime;

      if (v.library?._id) {
        affectedLibraryIds.add(v.library._id.toString());
      } else if (v.library) {
        affectedLibraryIds.add(v.library.toString());
      }

      return {
        updateOne: {
          filter: { _id: v._id, checkoutTime: null },
          update: { $set: { checkoutTime: finalCheckoutTime } }
        }
      };
    });

    const result = await VisitLog.bulkWrite(bulkOps);
    const closedCount = result.modifiedCount || staleVisits.length;

    console.log(`[LibraryHours] Stale active visits auto-closed: ${closedCount} visit(s) closed.`);

    // Recalculate occupancy and emit SSE updates for affected libraries
    for (const libId of affectedLibraryIds) {
      try {
        const lib = await Library.findById(libId);
        if (lib) {
          const activeCount = await VisitLog.countDocuments({ library: lib._id, checkoutTime: null });
          const availableSeats = Math.max(0, lib.capacity - activeCount);
          occupancyEvents.emit('occupancyUpdated', {
            libraryId: lib._id,
            libraryCode: lib.code,
            currentOccupancy: activeCount,
            availableSeats
          });
        }
      } catch (err) {
        console.error(`[LibraryHours] Error emitting occupancy update for library ${libId}:`, err.message);
      }
    }

    return { closedCount, affectedLibraries: Array.from(affectedLibraryIds) };
  } catch (err) {
    console.error('[LibraryHours] Error in closeStaleActiveVisits:', err.message || err);
    return { closedCount: 0, affectedLibraries: [] };
  }
};

/**
 * Scheduled 05:00 PM Daily Automatic Closing Job.
 * Finds all active visits across all libraries (KIET_MAIN, KIET_2, KIET_WOMEN)
 * for both STUDENT and FACULTY, and marks them as OUT with the 5:00 PM closing timestamp.
 * @param {Date} [closingDate=new Date()]
 * @returns {Promise<{ closedCount: number, affectedLibraries: string[] }>}
 */
const autoCloseAllActiveVisits = async (closingDate = new Date()) => {
  console.log(`[LibraryHours] Executing 05:00 PM automatic library closing for all active visits...`);
  const activeVisits = await VisitLog.find({ checkoutTime: null }).populate('library');
  if (!activeVisits || activeVisits.length === 0) {
    console.log(`[LibraryHours] No active visits to close at 05:00 PM.`);
    return { closedCount: 0, affectedLibraries: [] };
  }

  const affectedLibraryIds = new Set();
  const bulkOps = activeVisits.map((v) => {
    const closingTime = getClosingTimeForDate(v.checkInTime || closingDate);
    const finalCheckoutTime = v.checkInTime > closingTime ? v.checkInTime : closingTime;

    if (v.library?._id) {
      affectedLibraryIds.add(v.library._id.toString());
    } else if (v.library) {
      affectedLibraryIds.add(v.library.toString());
    }

    return {
      updateOne: {
        filter: { _id: v._id, checkoutTime: null },
        update: { $set: { checkoutTime: finalCheckoutTime } }
      }
    };
  });

  const result = await VisitLog.bulkWrite(bulkOps);
  const closedCount = result.modifiedCount || activeVisits.length;
  console.log(`[LibraryHours] 05:00 PM Auto-closing complete: ${closedCount} active visit(s) marked OUT.`);

  // Recalculate occupancy and emit SSE updates across all libraries
  const libraries = await Library.find({ status: { $ne: 'INACTIVE' } });
  for (const lib of libraries) {
    const activeCount = await VisitLog.countDocuments({ library: lib._id, checkoutTime: null });
    const availableSeats = Math.max(0, lib.capacity - activeCount);
    occupancyEvents.emit('occupancyUpdated', {
      libraryId: lib._id,
      libraryCode: lib.code,
      currentOccupancy: activeCount,
      availableSeats
    });
  }

  return { closedCount, affectedLibraries: Array.from(affectedLibraryIds) };
};

module.exports = {
  LIBRARY_TIMEZONE,
  LIBRARY_OPEN_TIME,
  LIBRARY_CLOSE_TIME,
  LIBRARY_OPEN_HOUR,
  LIBRARY_OPEN_MINUTE,
  LIBRARY_CLOSE_HOUR,
  LIBRARY_CLOSE_MINUTE,
  getKolkataDateParts,
  getClosingTimeForDate,
  getOpeningTimeForDate,
  isLibraryOpen,
  isVisitStale,
  closeStaleActiveVisits,
  autoCloseAllActiveVisits
};
