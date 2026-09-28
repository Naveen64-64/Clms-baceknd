const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../../.env') });

const Library = require('../models/library.model');
const BookCopy = require('../models/bookCopy.model');
const VisitLog = require('../models/visitLog.model');
const BorrowTransaction = require('../models/borrowTransaction.model');
const LibrarianProfile = require('../models/librarianProfile.model');

async function normalizeLibraries() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kiet_library_db';
    await mongoose.connect(mongoUri);
    console.log('[Normalize Libraries] Connected to MongoDB:', mongoUri);

    const db = mongoose.connection.db;

    // 1. Ensure KIET_MAIN, KIET_2, KIET_WOMEN exist with capacity = 50 and status = ACTIVE
    const requiredLibraries = [
      {
        code: 'KIET_MAIN',
        name: 'KIET Library',
        capacity: 50,
        isWomenOnly: false,
        location: 'Main Campus Building A',
        openingTime: '09:00 AM',
        closingTime: '05:00 PM',
        status: 'ACTIVE'
      },
      {
        code: 'KIET_2',
        name: 'KIET 2 Library',
        capacity: 50,
        isWomenOnly: false,
        location: 'Academic Block B',
        openingTime: '09:00 AM',
        closingTime: '05:00 PM',
        status: 'ACTIVE'
      },
      {
        code: 'KIET_WOMEN',
        name: "KIET Women's Library",
        capacity: 50,
        isWomenOnly: true,
        location: 'Girls Hostel Complex',
        openingTime: '09:00 AM',
        closingTime: '05:00 PM',
        status: 'ACTIVE'
      }
    ];

    const libMap = {};

    for (const target of requiredLibraries) {
      let lib = await Library.findOne({ code: target.code });
      if (!lib) {
        lib = await Library.create(target);
        console.log(`[Normalize Libraries] Created missing library: ${lib.name} (${lib.code}) with capacity 50`);
      } else {
        lib.name = target.name;
        lib.capacity = 50;
        lib.status = 'ACTIVE';
        lib.isWomenOnly = target.isWomenOnly;
        lib.openingTime = target.openingTime;
        lib.closingTime = target.closingTime;
        await lib.save();
        console.log(`[Normalize Libraries] Updated library: ${lib.name} (${lib.code}) timing: ${lib.openingTime} - ${lib.closingTime}`);
      }
      libMap[target.code] = lib;
    }

    const kietMainLib = libMap['KIET_MAIN'];

    // 2. Find any MINI_LIB or non-standard libraries
    const obsoleteLibraries = await Library.find({
      code: { $nin: ['KIET_MAIN', 'KIET_2', 'KIET_WOMEN'] }
    });

    console.log(`[Normalize Libraries] Found ${obsoleteLibraries.length} obsolete library record(s).`);

    for (const obsLib of obsoleteLibraries) {
      console.log(`\n[Cleaning Obsolete Library] Code: ${obsLib.code}, Name: ${obsLib.name}, ID: ${obsLib._id}`);

      // 2a. Reassign BookCopies to KIET_MAIN
      const copiesReassigned = await BookCopy.updateMany(
        { library: obsLib._id },
        { $set: { library: kietMainLib._id } }
      );
      console.log(`  - Reassigned ${copiesReassigned.modifiedCount} BookCopies to KIET_MAIN (${kietMainLib._id})`);

      // 2b. Clean up test VisitLogs
      const visitsDeleted = await VisitLog.deleteMany({ library: obsLib._id });
      console.log(`  - Deleted ${visitsDeleted.deletedCount} VisitLogs associated with obsolete library`);

      // 2c. Check LibrarianProfiles & reassign or delete
      const librariansReassigned = await LibrarianProfile.updateMany(
        { assignedLibrary: obsLib._id },
        { $set: { assignedLibrary: kietMainLib._id } }
      );
      if (librariansReassigned.modifiedCount > 0) {
        console.log(`  - Reassigned ${librariansReassigned.modifiedCount} LibrarianProfiles to KIET_MAIN`);
      }

      // 2d. Remove obsolete library from DB
      await Library.findByIdAndDelete(obsLib._id);
      console.log(`  - Deleted obsolete library document (${obsLib.code})`);
    }

    // 3. Verify final DB state
    const finalLibraries = await Library.find({}).sort({ code: 1 });
    console.log('\n========================================================================');
    console.log('   FINAL MONGODB LIBRARY CONFIGURATION SUMMARY                          ');
    console.log('========================================================================');
    console.log(`  Total Active Operational Libraries: ${finalLibraries.length}`);
    finalLibraries.forEach((l) => {
      console.log(`  - Code: ${l.code} | Name: ${l.name} | Capacity: ${l.capacity} | Status: ${l.status}`);
    });
    console.log('========================================================================');

    if (finalLibraries.length !== 3) {
      throw new Error(`Expected exactly 3 operational libraries, but found ${finalLibraries.length}`);
    }

    for (const l of finalLibraries) {
      if (l.capacity !== 50) {
        throw new Error(`Library ${l.code} capacity is ${l.capacity}, expected 50`);
      }
    }

    console.log('\n[Normalize Libraries] Migration completed successfully and verified!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('[Normalize Libraries Error]:', error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

normalizeLibraries();
