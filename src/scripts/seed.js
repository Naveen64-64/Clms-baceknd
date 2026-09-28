const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const Library = require('../models/library.model');
const User = require('../models/user.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const AdminSetting = require('../models/adminSetting.model');
const { ROLES, LIBRARIES, DEFAULT_SETTINGS } = require('../config/constants');
const { hashPassword } = require('../utils/password');

const seedDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kiet_library_db';
    await mongoose.connect(mongoUri);
    console.log('[Seed] Connected to MongoDB:', mongoUri);

    // 1. Seed Libraries (3 required libraries with stable codes)
    const librariesToSeed = [
      {
        name: LIBRARIES.KIET_MAIN,
        code: 'KIET_MAIN',
        description: 'Central Library of KIET Group of Institutions',
        capacity: 50,
        isWomenOnly: false,
        location: 'Main Campus Building A',
        openingTime: '09:00 AM',
        closingTime: '05:00 PM',
        status: 'ACTIVE'
      },
      {
        name: LIBRARIES.KIET_2,
        code: 'KIET_2',
        description: 'Secondary Library for Engineering & Science',
        capacity: 50,
        isWomenOnly: false,
        location: 'Academic Block B',
        openingTime: '09:00 AM',
        closingTime: '05:00 PM',
        status: 'ACTIVE'
      },
      {
        name: LIBRARIES.KIET_WOMEN,
        code: 'KIET_WOMEN',
        description: "Exclusive Library for Women Students & Staff",
        capacity: 50,
        isWomenOnly: true,
        location: 'Girls Hostel Complex',
        openingTime: '09:00 AM',
        closingTime: '05:00 PM',
        status: 'ACTIVE'
      }
    ];

    const libraryMap = {};

    for (const libData of librariesToSeed) {
      let lib = await Library.findOne({ code: libData.code });
      if (!lib) {
        lib = await Library.create(libData);
        console.log(`[Seed] Created Library: ${libData.name}`);
      } else {
        lib.capacity = libData.capacity;
        lib.name = libData.name;
        lib.status = 'ACTIVE';
        await lib.save();
        console.log(`[Seed] Library updated: ${libData.name} (Capacity: 50)`);
      }
      libraryMap[libData.code] = lib;
    }

    // Remove obsolete libraries (e.g. MINI_LIB)
    const obsoleteLibs = await Library.find({ code: { $nin: ['KIET_MAIN', 'KIET_2', 'KIET_WOMEN'] } });
    for (const obs of obsoleteLibs) {
      await Library.findByIdAndDelete(obs._id);
      console.log(`[Seed Clean] Removed obsolete library: ${obs.code}`);
    }

    // 2. Clean Up Obsolete Default Admin, Librarian & Entrance Users and Profiles
    const allowedLibrarianEmails = ['kietlibrarian@gmail.com', 'kiet2librarian@gmail.com', 'kietwlibrarian@gmail.com'];
    const entranceUsername = 'libraryentrance@gmail.com';
    const allowedUserEmails = ['kietadmin@gmail.com', entranceUsername, ...allowedLibrarianEmails];

    // Remove obsolete staff users (non-conforming emails)
    const deleteUsersResult = await User.deleteMany({
      username: { $nin: allowedUserEmails },
      role: { $nin: [ROLES.STUDENT, ROLES.OPEN_USER, ROLES.FACULTY] }
    });
    if (deleteUsersResult.deletedCount > 0) {
      console.log(`[Seed Clean] Removed ${deleteUsersResult.deletedCount} obsolete default staff user documents.`);
    }

    // Remove obsolete librarian profiles
    const deleteProfilesResult = await LibrarianProfile.deleteMany({ email: { $nin: allowedLibrarianEmails } });
    if (deleteProfilesResult.deletedCount > 0) {
      console.log(`[Seed Clean] Removed ${deleteProfilesResult.deletedCount} obsolete librarian profile documents.`);
    }

    // 3. Seed Default Admin User
    const adminUsername = 'kietadmin@gmail.com';
    const adminPassword = 'kietadmin@gmail.com';
    let adminUser = await User.findOne({ username: adminUsername });
    const hashedAdminPassword = await hashPassword(adminPassword);

    if (!adminUser) {
      adminUser = await User.create({
        username: adminUsername,
        password: hashedAdminPassword,
        role: ROLES.ADMIN,
        isActive: true
      });
      console.log(`[Seed] Created Default Admin Account: ${adminUsername}`);
    } else {
      adminUser.password = hashedAdminPassword;
      adminUser.role = ROLES.ADMIN;
      adminUser.isActive = true;
      await adminUser.save();
      console.log(`[Seed] Ensured Default Admin Account: ${adminUsername}`);
    }

    // Ensure Admin has NO LibrarianProfile
    await LibrarianProfile.deleteMany({ user: adminUser._id });

    // 3b. Seed Default Library Entrance User
    const entrancePassword = 'libraryentrance@gmail.com';
    let entranceUser = await User.findOne({ username: entranceUsername });
    const hashedEntrancePassword = await hashPassword(entrancePassword);

    if (!entranceUser) {
      entranceUser = await User.create({
        username: entranceUsername,
        password: hashedEntrancePassword,
        role: ROLES.LIBRARY_ENTRANCE,
        isActive: true
      });
      console.log(`[Seed] Created Default Library Entrance Account: ${entranceUsername}`);
    } else {
      entranceUser.password = hashedEntrancePassword;
      entranceUser.role = ROLES.LIBRARY_ENTRANCE;
      entranceUser.isActive = true;
      await entranceUser.save();
      console.log(`[Seed] Ensured Default Library Entrance Account: ${entranceUsername}`);
    }

    // 4. Seed Predefined Librarians for the 3 Libraries
    const librariansToSeed = [
      {
        email: 'kietlibrarian@gmail.com',
        name: 'KIET Librarian',
        password: 'kietlibrarian@gmail.com',
        libraryCode: 'KIET_MAIN'
      },
      {
        email: 'kiet2librarian@gmail.com',
        name: 'KIET 2 Librarian',
        password: 'kiet2librarian@gmail.com',
        libraryCode: 'KIET_2'
      },
      {
        email: 'kietwlibrarian@gmail.com',
        name: "KIET Women's Librarian",
        password: 'kietwlibrarian@gmail.com',
        libraryCode: 'KIET_WOMEN'
      }
    ];

    for (const libInfo of librariansToSeed) {
      const formattedEmail = libInfo.email.toLowerCase();
      const hashedPassword = await hashPassword(libInfo.password);
      const targetLibrary = libraryMap[libInfo.libraryCode];

      let libUser = await User.findOne({ username: formattedEmail });
      if (!libUser) {
        libUser = await User.create({
          username: formattedEmail,
          password: hashedPassword,
          role: ROLES.LIBRARIAN,
          isActive: true
        });
        console.log(`[Seed] Created Librarian User: ${formattedEmail}`);
      } else {
        libUser.password = hashedPassword;
        libUser.role = ROLES.LIBRARIAN;
        libUser.isActive = true;
        await libUser.save();
        console.log(`[Seed] Updated/Ensured Librarian User: ${formattedEmail}`);
      }

      let profile = await LibrarianProfile.findOne({ user: libUser._id });
      if (!profile) {
        profile = await LibrarianProfile.create({
          user: libUser._id,
          name: libInfo.name,
          email: formattedEmail,
          assignedLibrary: targetLibrary._id
        });
        console.log(`[Seed] Created LibrarianProfile for: ${formattedEmail} (${libInfo.libraryCode})`);
      } else {
        profile.name = libInfo.name;
        profile.email = formattedEmail;
        profile.assignedLibrary = targetLibrary._id;
        await profile.save();
        console.log(`[Seed] Updated/Ensured LibrarianProfile for: ${formattedEmail} (${libInfo.libraryCode})`);
      }
    }

    // 4. Seed Default Admin Settings
    const FacultyProfile = require('../models/facultyProfile.model');
    let facUser = await User.findOne({ username: 'fac001' });
    if (!facUser) {
      const facPassword = await hashPassword('password123');
      facUser = await User.create({
        username: 'fac001',
        password: facPassword,
        role: ROLES.FACULTY,
        isActive: true
      });
      await FacultyProfile.create({
        user: facUser._id,
        facultyId: 'FAC001',
        name: 'Demo Faculty',
        email: 'faculty.demo@kiet.edu',
        phone: '9876543210'
      });
      console.log('[Seed] Created Demo Faculty Account: FAC001');
    }

    const existingSettings = await AdminSetting.findOne();
    if (!existingSettings) {
      await AdminSetting.create({
        maxBooksPerStudent: DEFAULT_SETTINGS.MAX_BOOKS_PER_STUDENT,
        defaultLoanDays: DEFAULT_SETTINGS.DEFAULT_LOAN_DAYS,
        finePerDay: DEFAULT_SETTINGS.FINE_PER_DAY,
        initialSecurityDeposit: DEFAULT_SETTINGS.INITIAL_DEPOSIT_AMOUNT
      });
      console.log('[Seed] Initialized Admin Settings');
    }

    console.log('[Seed] Database Seeding Complete!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('[Seed Error]:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

seedDB();
