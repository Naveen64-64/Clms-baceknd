const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

const mongoose = require('mongoose');
const xlsx = require('xlsx');
const bcrypt = require('bcryptjs');

const User = require('../models/user.model');
const StudentProfile = require('../models/studentProfile.model');
const Notification = require('../models/notification.model');
const { ROLES, GENDERS } = require('../config/constants');

const DEPT_MAP = {
  '42': 'CSM',
  '43': 'CAI',
  '44': 'CSD',
  '45': 'AIDS',
  '46': 'CSC',
  'CSM': 'CSM',
  'CAI': 'CAI',
  'CSD': 'CSD',
  'AIDS': 'AIDS',
  'CSC': 'CSC'
};

const resolveDept = (sheetName) => {
  const upper = sheetName.toUpperCase().trim();
  for (const [key, val] of Object.entries(DEPT_MAP)) {
    if (upper.includes(key)) return val;
  }
  return 'CSM'; // fallback
};

const FILES = [
  {
    fileName: '2ND YEAR DATA.xlsx',
    filePath: path.resolve(__dirname, '../../../2ND YEAR DATA.xlsx'),
    year: 2
  },
  {
    fileName: '3RD YEAR DATA.xlsx',
    filePath: path.resolve(__dirname, '../../../3RD YEAR DATA.xlsx'),
    year: 3
  },
  {
    fileName: '4TH YEAR DATA.xlsx',
    filePath: path.resolve(__dirname, '../../../4TH YEAR DATA.xlsx'),
    year: 4
  }
];

const parseFiles = () => {
  const allStudents = [];
  const seenRolls = new Set();

  for (const fileConfig of FILES) {
    console.log(`\n[Reader] Reading file: ${fileConfig.fileName} (Academic Year ${fileConfig.year})`);
    let workbook;
    try {
      workbook = xlsx.readFile(fileConfig.filePath);
    } catch (err) {
      console.error(`❌ Could not open file ${fileConfig.filePath}: ${err.message}`);
      continue;
    }

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
      const dept = resolveDept(sheetName);
      let sheetCount = 0;

      for (const row of rows) {
        let rawRoll = '';
        let rawName = '';

        for (const [k, v] of Object.entries(row)) {
          const keyUpper = String(k).toUpperCase().replace(/[\s._-]/g, '');
          const valStr = String(v).trim();

          if (
            keyUpper.includes('HTNO') ||
            keyUpper.includes('ROLL') ||
            keyUpper.includes('REGD') ||
            keyUpper.includes('PIN') ||
            keyUpper.includes('H.T.NO')
          ) {
            rawRoll = valStr;
          } else if (
            keyUpper.includes('NAME') ||
            keyUpper.includes('STUDENT') ||
            keyUpper.includes('CANDIDATE')
          ) {
            rawName = valStr;
          }

          if (!rawRoll && /^\d{2}[A-Za-z0-9]{2}\d[A-Za-z0-9]\d{4}$/.test(valStr)) {
            rawRoll = valStr;
          }
        }

        if (!rawRoll || !rawName) continue;

        const rollUpper = rawRoll.toUpperCase().replace(/\s+/g, '');
        const campusMatch = rollUpper.match(/^\d{2}(B2|6Q|JN)/);
        if (!campusMatch) {
          continue;
        }

        if (seenRolls.has(rollUpper)) {
          continue;
        }
        seenRolls.add(rollUpper);

        const campusCode = campusMatch[1];
        const gender = campusCode === 'JN' ? GENDERS.FEMALE : GENDERS.MALE;

        allStudents.push({
          rollNumber: rollUpper,
          username: rollUpper.toLowerCase(),
          name: String(rawName).trim(),
          campusCode,
          gender,
          department: dept,
          academicYear: fileConfig.year,
          section: 'A'
        });
        sheetCount++;
      }

      console.log(`  - Sheet [${sheetName}] -> Dept: ${dept}, Parsed Students: ${sheetCount}`);
    }
  }

  return allStudents;
};

const run = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kiet_library_db';
    console.log('[Seed Students] Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('[Seed Students] Connected to DB successfully.');

    const students = parseFiles();
    console.log(`\n[Summary] Total parsed students from Excel files: ${students.length}`);

    if (students.length === 0) {
      console.log('No student records found to seed. Exiting.');
      process.exit(0);
    }

    // Clean existing student accounts and profiles to ensure a 100% clean seed
    console.log('[Database] Cleaning existing student accounts and profiles...');
    await User.deleteMany({ role: ROLES.STUDENT });
    await StudentProfile.deleteMany({});
    await Notification.deleteMany({ type: 'REGISTRATION' });
    console.log('[Database] Cleaned existing student data.');

    const toInsert = students;
    console.log(`[Database] Seeding ${toInsert.length} student accounts...`);

    // Pre-generate salt once to speed up bcrypt operations dramatically
    const salt = await bcrypt.genSalt(10);

    const BATCH_SIZE = 250;
    let insertedCount = 0;

    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const chunk = toInsert.slice(i, i + BATCH_SIZE);

      const items = await Promise.all(
        chunk.map(async (st) => {
          const userId = new mongoose.Types.ObjectId();
          const profileId = new mongoose.Types.ObjectId();
          const hashedPassword = await bcrypt.hash(st.username, salt);

          return {
            userDoc: {
              _id: userId,
              username: st.username,
              password: hashedPassword,
              role: ROLES.STUDENT,
              isActive: true
            },
            profileDoc: {
              _id: profileId,
              user: userId,
              rollNumber: st.rollNumber,
              campusCode: st.campusCode,
              name: st.name,
              gender: st.gender,
              department: st.department,
              academicYear: st.academicYear,
              section: st.section,
              securityDepositBalance: 0
            },
            notificationDoc: {
              recipientUser: userId,
              type: 'REGISTRATION',
              title: 'Welcome to KIET Library!',
              message: `Your library account has been successfully initialized with Roll Number ${st.rollNumber}.`,
              relatedEntity: { studentProfileId: profileId }
            }
          };
        })
      );

      const userDocs = items.map((item) => item.userDoc);
      const profileDocs = items.map((item) => item.profileDoc);
      const notificationDocs = items.map((item) => item.notificationDoc);

      await User.insertMany(userDocs, { ordered: false });
      await StudentProfile.insertMany(profileDocs, { ordered: false });
      await Notification.insertMany(notificationDocs, { ordered: false });

      insertedCount += chunk.length;
      console.log(`  ✓ Inserted ${insertedCount} / ${toInsert.length} student accounts...`);
    }

    console.log('\n🎉 ================================================');
    console.log(`✅ Successfully seeded ${insertedCount} student accounts!`);
    console.log(`   - Users created: ${insertedCount}`);
    console.log(`   - StudentProfiles created: ${insertedCount}`);
    console.log(`   - Welcome Notifications created: ${insertedCount}`);
    console.log(`   - Default Login credentials: Roll Number (e.g. ${toInsert[0].rollNumber})`);
    console.log(`   - Default Password: Lowercase Roll Number (e.g. ${toInsert[0].username})`);
    console.log('================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

run();
