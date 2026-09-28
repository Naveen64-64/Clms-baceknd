const mongoose = require('mongoose');
const User = require('../models/user.model');
const StudentProfile = require('../models/studentProfile.model');
const FacultyProfile = require('../models/facultyProfile.model');
const Library = require('../models/library.model');
const VisitLog = require('../models/visitLog.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const { GENDERS, ROLES } = require('../config/constants');
const { runInTransaction } = require('../utils/transaction');
const ApiError = require('../utils/apiError');
const occupancyEvents = require('./occupancyEmitter');
const { getMandatoryLibrarianProfile } = require('../utils/librarianScope');
const libraryHoursService = require('./libraryHours.service');



const findUserByLibraryIdentifier = async (identifier) => {
  if (!identifier) return null;
  const cleanId = identifier.trim().toUpperCase();

  // 1. Try StudentProfile by rollNumber
  const student = await StudentProfile.findOne({ rollNumber: cleanId }).populate('user');
  if (student) {
    return {
      userType: 'STUDENT',
      user: student.user,
      studentProfile: student,
      facultyProfile: null,
      id: student.rollNumber,
      name: student.name,
      gender: student.gender,
      isActive: student.user ? student.user.isActive !== false : true
    };
  }

  // 2. Try FacultyProfile by facultyId
  const faculty = await FacultyProfile.findOne({ facultyId: cleanId }).populate('user');
  if (faculty) {
    return {
      userType: 'FACULTY',
      user: faculty.user,
      studentProfile: null,
      facultyProfile: faculty,
      id: faculty.facultyId,
      name: faculty.name,
      gender: null,
      isActive: faculty.user ? faculty.user.isActive !== false : true
    };
  }

  // 3. Fallback: Try User model by username (case-insensitive)
  const userRecord = await User.findOne({ username: cleanId.toLowerCase() });
  if (userRecord) {
    if (userRecord.role === ROLES.STUDENT) {
      const sProf = await StudentProfile.findOne({ user: userRecord._id }).populate('user');
      if (sProf) {
        return {
          userType: 'STUDENT',
          user: userRecord,
          studentProfile: sProf,
          facultyProfile: null,
          id: sProf.rollNumber,
          name: sProf.name,
          gender: sProf.gender,
          isActive: userRecord.isActive !== false
        };
      }
    } else if (userRecord.role === ROLES.FACULTY) {
      const fProf = await FacultyProfile.findOne({ user: userRecord._id }).populate('user');
      if (fProf) {
        return {
          userType: 'FACULTY',
          user: userRecord,
          studentProfile: null,
          facultyProfile: fProf,
          id: fProf.facultyId,
          name: fProf.name,
          gender: null,
          isActive: userRecord.isActive !== false
        };
      }
    }
  }

  return null;
};

const activeGateRequests = new Set();

const processGateEntryExit = async (identifier, libraryId, callingUser = null, requestedAction = null) => {
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);
  let effectiveLibraryId = libraryId;

  if (librarianProfile) {
    effectiveLibraryId = librarianProfile.assignedLibrary._id || librarianProfile.assignedLibrary;
    if (libraryId && libraryId.toString() !== effectiveLibraryId.toString()) {
      throw new ApiError(403, 'Access denied: Librarians are strictly restricted to performing gate operations for their assigned library');
    }
  }

  if (!effectiveLibraryId) {
    throw new ApiError(400, 'Target library ID or code is required');
  }

  if (!identifier) {
    throw new ApiError(400, 'User ID (Roll Number or Faculty ID) is required');
  }

  const cleanId = identifier.trim().toUpperCase();
  const requestKey = `user_${cleanId}`;

  // Enforce Library Operating Hours (09:00 AM - 05:00 PM Asia/Kolkata)
  const operatingStatus = libraryHoursService.isLibraryOpen();
  if (!operatingStatus.isOpen) {
    throw new ApiError(403, operatingStatus.message, [], '', operatingStatus.code, {
      operatingHours: '09:00 AM - 05:00 PM',
      timezone: 'Asia/Kolkata',
      currentTime: operatingStatus.currentTime
    });
  }

  if (activeGateRequests.has(requestKey)) {
    throw new ApiError(409, 'Please try again. The visit status was updated by another request.');
  }

  activeGateRequests.add(requestKey);

  try {
    // Defensively resolve any stale active visits before processing scan
    await libraryHoursService.closeStaleActiveVisits();

    // 1. Resolve Borrower (Student or Faculty) from DB
    const borrower = await findUserByLibraryIdentifier(cleanId);
    if (!borrower) {
      throw new ApiError(404, 'USER NOT FOUND: No registered student or faculty member was found for this User ID.');
    }

    if (borrower.isActive === false) {
      throw new ApiError(400, 'User account is inactive');
    }

    // 2. Validate Library existence (by Code first, then ObjectId)
    let library = await Library.findOne({ code: effectiveLibraryId });
    if (!library && mongoose.Types.ObjectId.isValid(effectiveLibraryId)) {
      library = await Library.findById(effectiveLibraryId);
    }
    if (!library) {
      throw new ApiError(400, 'Invalid library');
    }

    // 3. Enforce Gender Restrictions ONLY for Student users (Faculty can access ALL libraries)
    if (borrower.userType === 'STUDENT' && borrower.gender === GENDERS.MALE && (library.isWomenOnly || library.code === 'KIET_WOMEN' || library.name.includes("Women"))) {
      throw new ApiError(403, "Male students are not allowed to enter KIET Women's Library");
    }

    const result = await runInTransaction(async (session) => {
      const opts = session ? { session } : {};

      // 4. Check active visit status across ALL libraries for this user
      const queryConditions = [];
      if (borrower.user?._id) queryConditions.push({ user: borrower.user._id });
      if (borrower.studentProfile?._id) queryConditions.push({ student: borrower.studentProfile._id });
      if (borrower.facultyProfile?._id) queryConditions.push({ faculty: borrower.facultyProfile._id });
      queryConditions.push({ userId: borrower.id });
      queryConditions.push({ rollNumber: borrower.id });

      const activeVisit = await VisitLog.findOne({
        $or: queryConditions,
        checkoutTime: null
      }).populate('library').session(session);

      if (activeVisit) {
        const activeLib = activeVisit.library;
        const isSameLibrary = activeLib && (activeLib._id.toString() === library._id.toString() || activeLib.code === library.code);

        if (isSameLibrary) {
          // User is currently in THIS library -> process OUT or handle duplicate IN
          if (requestedAction === 'IN') {
            throw new ApiError(
              409,
              `User is already checked in to ${library.name}.`,
              [],
              '',
              'ALREADY_CHECKED_IN',
              { activeLibraryId: library.code, activeLibraryName: library.name }
            );
          }
          // Process OUT checkout
          activeVisit.checkoutTime = new Date();
          await activeVisit.save(opts);

          const activeVisitsCount = await VisitLog.countDocuments({
            library: library._id,
            checkoutTime: null
          }).session(session);

          const now = new Date();
          return {
            action: 'OUT',
            status: 'OUT',
            user: {
              id: borrower.id,
              name: borrower.name,
              role: borrower.userType
            },
            library: {
              code: library.code,
              name: library.name
            },
            occupancy: {
              current: activeVisitsCount,
              capacity: library.capacity,
              available: Math.max(0, library.capacity - activeVisitsCount)
            },
            userType: borrower.userType,
            userId: borrower.id,
            rollNumber: borrower.id,
            name: borrower.name,
            userName: borrower.name,
            studentName: borrower.name,
            libraryId: library.code,
            libraryCode: library.code,
            libraryName: library.name,
            checkInTime: activeVisit.checkInTime,
            checkoutTime: activeVisit.checkoutTime,
            currentOccupancy: activeVisitsCount,
            capacity: library.capacity,
            availableSeats: Math.max(0, library.capacity - activeVisitsCount),
            timestamp: now
          };
        } else {
          // User is currently in a DIFFERENT library!
          const activeLibName = activeLib?.name || 'another library';
          const activeLibCode = activeLib?.code || 'KIET_MAIN';

          if (requestedAction === 'OUT') {
            throw new ApiError(
              409,
              `User is currently inside ${activeLibName}, not ${library.name}.`,
              [],
              '',
              'WRONG_LIBRARY_CHECKOUT',
              { activeLibraryId: activeLibCode, activeLibraryName: activeLibName }
            );
          }

          throw new ApiError(
            409,
            `User is already inside ${activeLibName}. Check out from ${activeLibName} before entering ${library.name}.`,
            [],
            '',
            'ALREADY_INSIDE_OTHER_LIBRARY',
            { activeLibraryId: activeLibCode, activeLibraryName: activeLibName }
          );
        }
      } else {
        // No active visit exists anywhere
        if (requestedAction === 'OUT') {
          throw new ApiError(400, `User does not have an active visit in ${library.name}.`);
        }

        const currentActiveVisits = await VisitLog.countDocuments({
          library: library._id,
          checkoutTime: null
        }).session(session);

        if (currentActiveVisits >= library.capacity) {
          throw new ApiError(409, 'Library is currently at full capacity');
        }

        try {
          const [newVisit] = await VisitLog.create(
            [
              {
                user: borrower.user?._id || null,
                student: borrower.studentProfile?._id || null,
                faculty: borrower.facultyProfile?._id || null,
                userType: borrower.userType,
                userId: borrower.id,
                rollNumber: borrower.id,
                library: library._id,
                checkInTime: new Date(),
                checkoutTime: null
              }
            ],
            opts
          );

          const updatedActiveVisits = currentActiveVisits + 1;
          const now = new Date();

          return {
            action: 'IN',
            status: 'IN',
            user: {
              id: borrower.id,
              name: borrower.name,
              role: borrower.userType
            },
            library: {
              code: library.code,
              name: library.name
            },
            occupancy: {
              current: updatedActiveVisits,
              capacity: library.capacity,
              available: Math.max(0, library.capacity - updatedActiveVisits)
            },
            userType: borrower.userType,
            userId: borrower.id,
            rollNumber: borrower.id,
            name: borrower.name,
            userName: borrower.name,
            studentName: borrower.name,
            libraryId: library.code,
            libraryCode: library.code,
            libraryName: library.name,
            checkInTime: newVisit.checkInTime,
            checkoutTime: null,
            currentOccupancy: updatedActiveVisits,
            capacity: library.capacity,
            availableSeats: Math.max(0, library.capacity - updatedActiveVisits),
            timestamp: now
          };
        } catch (err) {
          if (err.code === 11000) {
            const existing = await VisitLog.findOne({
              $or: queryConditions,
              checkoutTime: null
            }).populate('library').session(session);
            const activeLibName = existing?.library?.name || 'another library';
            const activeLibCode = existing?.library?.code || '';
            throw new ApiError(
              409,
              `User is already inside ${activeLibName}. Check out from ${activeLibName} before entering ${library.name}.`,
              [],
              '',
              'ALREADY_INSIDE_OTHER_LIBRARY',
              { activeLibraryId: activeLibCode, activeLibraryName: activeLibName }
            );
          }
          throw err;
        }
      }
    });

    // Emit live occupancy update event for SSE clients
    occupancyEvents.emit('occupancyUpdated', {
      libraryId: result.libraryId,
      libraryCode: result.libraryCode,
      currentOccupancy: result.currentOccupancy,
      availableSeats: result.availableSeats
    });

    return result;
  } finally {
    activeGateRequests.delete(requestKey);
  }
};

const getActiveVisitsForLibrary = async (targetLibraryId, callingUser = null) => {
  const librarianProfile = await getMandatoryLibrarianProfile(callingUser);
  let libId = targetLibraryId;

  if (librarianProfile) {
    libId = librarianProfile.assignedLibrary?._id || librarianProfile.assignedLibrary;
  }

  if (!libId && callingUser?.assignedLibraryId) {
    libId = callingUser.assignedLibraryId;
  }

  if (!libId) {
    throw new ApiError(400, 'Library ID is required to fetch active visits');
  }

  let lib = null;
  if (mongoose.Types.ObjectId.isValid(libId)) {
    lib = await Library.findById(libId);
  }
  if (!lib) {
    lib = await Library.findOne({ code: libId });
  }

  const queryLibId = lib ? lib._id : libId;
  const capacity = lib?.capacity || 50;

  // 1. Resolve and close any stale active visits from previous days/closing windows
  await libraryHoursService.closeStaleActiveVisits();

  // 2. Check if library is currently open (09:00 AM - 05:00 PM Asia/Kolkata)
  const operatingStatus = libraryHoursService.isLibraryOpen();
  if (!operatingStatus.isOpen) {
    return {
      libraryId: lib ? lib._id : queryLibId,
      libraryCode: lib ? lib.code : '',
      libraryName: lib ? lib.name : 'Assigned Library',
      capacity,
      activeCount: 0,
      availableSeats: capacity,
      studentsCount: 0,
      facultyCount: 0,
      visitors: [],
      isOpen: false,
      statusMessage: operatingStatus.message,
      operatingHours: '09:00 AM - 05:00 PM'
    };
  }

  // 3. Library is open: Fetch only active visits (defensively excluding any stale records)
  const rawVisits = await VisitLog.find({ library: queryLibId, checkoutTime: null })
    .populate('user', 'username role')
    .populate('student', 'rollNumber name gender department academicYear email')
    .populate('faculty', 'facultyId name email phone department')
    .populate('library', 'name code capacity')
    .sort({ checkInTime: -1 });

  const validVisits = rawVisits.filter((v) => !libraryHoursService.isVisitStale(v));

  const visitors = validVisits.map((v) => {
    const isFaculty = v.userType === 'FACULTY' || Boolean(v.faculty);
    const identifier = v.userId || v.rollNumber || (isFaculty ? v.faculty?.facultyId : v.student?.rollNumber) || 'N/A';
    const fullName = (isFaculty ? v.faculty?.name : v.student?.name) || v.user?.username || 'Library Visitor';
    const userType = isFaculty ? 'FACULTY' : 'STUDENT';
    const department = (isFaculty ? v.faculty?.department : v.student?.department) || '';
    const academicYear = isFaculty ? null : (v.student?.academicYear || null);
    const email = (isFaculty ? v.faculty?.email : v.student?.email) || v.user?.username || '';
    const checkInTime = v.checkInTime;

    return {
      _id: v._id,
      userId: identifier,
      rollNumber: isFaculty ? undefined : identifier,
      facultyId: isFaculty ? identifier : undefined,
      fullName,
      name: fullName,
      userType,
      department,
      academicYear,
      gender: isFaculty ? null : (v.student?.gender || null),
      email,
      library: v.library?._id || queryLibId,
      libraryId: lib ? lib._id : queryLibId,
      libraryName: lib?.name || v.library?.name || 'Assigned Library',
      libraryCode: lib?.code || v.library?.code || '',
      checkInTime,
      entryTime: checkInTime,
      checkoutTime: null,
      status: 'IN',
      student: v.student,
      faculty: v.faculty,
      user: v.user
    };
  });

  const activeCount = visitors.length;
  const availableSeats = Math.max(0, capacity - activeCount);
  const studentsCount = visitors.filter((v) => v.userType === 'STUDENT').length;
  const facultyCount = visitors.filter((v) => v.userType === 'FACULTY').length;

  return {
    libraryId: lib ? lib._id : queryLibId,
    libraryCode: lib ? lib.code : '',
    libraryName: lib ? lib.name : 'Assigned Library',
    capacity,
    activeCount,
    availableSeats,
    studentsCount,
    facultyCount,
    visitors,
    isOpen: true,
    statusMessage: operatingStatus.message,
    operatingHours: '09:00 AM - 05:00 PM'
  };
};


const getRecentVisitsForLibrary = async (targetLibraryId, limit = 10) => {
  let lib = null;
  if (mongoose.Types.ObjectId.isValid(targetLibraryId)) {
    lib = await Library.findById(targetLibraryId);
  }
  if (!lib) {
    lib = await Library.findOne({ code: targetLibraryId });
  }
  if (!lib) {
    throw new ApiError(404, 'Library not found');
  }

  // Fetch recent VisitLog records — fetch enough so we can expand IN+OUT rows up to limit*2
  const visits = await VisitLog.find({ library: lib._id })
    .populate('user', 'username role')
    .populate('student', 'rollNumber name gender department')
    .populate('faculty', 'facultyId name email phone')
    .sort({ updatedAt: -1, checkInTime: -1 })
    .limit(limit * 2);

  // Expand each visit into separate IN and OUT event rows
  const events = [];
  for (const v of visits) {
    const uType = v.userType || (v.faculty ? 'FACULTY' : 'STUDENT');
    const uId = v.userId || v.rollNumber || (v.faculty ? v.faculty.facultyId : v.student ? v.student.rollNumber : '');
    const uName = v.faculty?.name || v.student?.name || 'User';

    const base = {
      userId: uId,
      rollNumber: uId,
      userName: uName,
      studentName: uName,
      userType: uType,
      role: uType,
      user: { id: uId, name: uName, role: uType },
      checkInTime: v.checkInTime,
      checkoutTime: v.checkoutTime
    };

    // Always emit the IN event
    events.push({
      ...base,
      id: `${v._id}_IN`,
      action: 'IN',
      timestamp: v.checkInTime
    });

    // Emit the OUT event only if the visit has been checked out
    if (v.checkoutTime) {
      events.push({
        ...base,
        id: `${v._id}_OUT`,
        action: 'OUT',
        timestamp: v.checkoutTime
      });
    }
  }

  // Sort all events newest first and cap at limit*2 rows
  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return events.slice(0, limit * 2);
};


module.exports = {
  findUserByLibraryIdentifier,
  processGateEntryExit,
  getActiveVisitsForLibrary,
  getRecentVisitsForLibrary
};
