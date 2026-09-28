const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const studentService = require('../services/student.service');


const registerStudent = asyncHandler(async (req, res) => {
  const student = await studentService.registerStudent(req.body, req.user.id);
  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        student,
        `Student ${student.name} registered successfully with Roll Number ${student.rollNumber}`
      )
    );
});

const getStudentProfile = asyncHandler(async (req, res) => {
  let rollNumber = req.params.rollNumber;

  // Student Privacy Protection: A Student can only view their own profile (Part 11 Security)
  if (req.user && req.user.role === 'STUDENT') {
    rollNumber = req.user.studentProfile?.rollNumber || req.user.username;
  }

  const student = await studentService.getStudentByRollNumber(rollNumber || req.user.username);
  return res.status(200).json(new ApiResponse(200, student, 'Student profile fetched successfully'));
});

const getTcClearance = asyncHandler(async (req, res) => {
  const { rollNumber } = req.params;
  const tcStatus = await studentService.getTcClearance(rollNumber, req.user);
  return res.status(200).json(new ApiResponse(200, tcStatus, 'TC clearance status fetched successfully'));
});

const getAllStudents = asyncHandler(async (req, res) => {
  const students = await studentService.getAllStudents(req.query);
  return res.status(200).json(new ApiResponse(200, students, 'Students fetched successfully'));
});

const clearStudentData = asyncHandler(async (req, res) => {
  const { rollNumber } = req.params;
  const { confirmationRollNumber } = req.body || {};
  const result = await studentService.clearStudentData(rollNumber, confirmationRollNumber, req.user);
  return res.status(200).json(new ApiResponse(200, result, 'Student library account data cleared successfully'));
});

const getStudentDetails = asyncHandler(async (req, res) => {
  const { rollNumber } = req.params;
  const details = await studentService.getStudentDetails(rollNumber, req.user);
  const message = details.userType === 'FACULTY' ? 'Faculty details fetched successfully' : 'Student details fetched successfully';
  return res.status(200).json(new ApiResponse(200, details, message));
});


const bulkImportStudents = asyncHandler(async (req, res) => {
  const result = await studentService.bulkImportStudents(req.body.students, req.user.id);
  return res.status(201).json(new ApiResponse(201, result, 'Bulk import completed'));
});

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

const resolveDeptFromText = (text) => {
  if (!text) return null;
  const upper = String(text).toUpperCase().trim();
  for (const [key, val] of Object.entries(DEPT_MAP)) {
    if (upper.includes(key)) return val;
  }
  return null;
};

const bulkImportFromFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'Please upload an Excel (.xlsx, .xls) or CSV file');
  }

  let workbook;
  try {
    workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
  } catch (err) {
    throw new ApiError(400, `Failed to parse spreadsheet file: ${err.message}`);
  }

  const defaultYear = req.body.academicYear ? Number(req.body.academicYear) : 1;
  const defaultDept = req.body.department ? req.body.department.trim().toUpperCase() : '';
  const parsedStudents = [];
  const seenRolls = new Set();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    const sheetDept = resolveDeptFromText(sheetName);

    for (const row of rows) {
      let rollNumber = '';
      let name = '';
      let department = '';
      let gender = '';
      let academicYear = defaultYear;
      let email = '';
      let phone = '';
      let password = '';

      for (const [k, v] of Object.entries(row)) {
        const keyUpper = String(k).toUpperCase().replace(/[\s._-]/g, '');
        const valStr = String(v).trim();

        if (
          keyUpper.includes('HTNO') ||
          keyUpper.includes('ROLL') ||
          keyUpper.includes('REGD') ||
          keyUpper.includes('PIN')
        ) {
          rollNumber = valStr;
        } else if (
          keyUpper.includes('NAME') ||
          keyUpper.includes('STUDENT') ||
          keyUpper.includes('CANDIDATE')
        ) {
          name = valStr;
        } else if (
          keyUpper.includes('DEPT') ||
          keyUpper.includes('BRANCH') ||
          keyUpper.includes('DEPARTMENT')
        ) {
          department = valStr;
        } else if (keyUpper.includes('GENDER') || keyUpper.includes('SEX')) {
          gender = valStr;
        } else if (keyUpper.includes('YEAR')) {
          const parsedYr = parseInt(valStr, 10);
          if (!isNaN(parsedYr)) academicYear = parsedYr;
        } else if (keyUpper.includes('EMAIL') || keyUpper.includes('MAIL')) {
          email = valStr;
        } else if (keyUpper.includes('PHONE') || keyUpper.includes('MOBILE') || keyUpper.includes('CONTACT')) {
          phone = valStr;
        } else if (keyUpper.includes('PASS') || keyUpper.includes('PWD')) {
          password = valStr;
        }

        if (!rollNumber && /^\d{2}[A-Za-z0-9]{2}\d[A-Za-z0-9]\d{4}$/.test(valStr)) {
          rollNumber = valStr;
        }
      }

      if (!rollNumber || !name) continue;

      const rollUpper = rollNumber.toUpperCase().replace(/\s+/g, '');
      if (seenRolls.has(rollUpper)) continue;
      seenRolls.add(rollUpper);

      const finalDept = resolveDeptFromText(department) || sheetDept || defaultDept || 'CSM';

      const campusMatch = rollUpper.match(/^\d{2}(B2|6Q|JN)/);
      const campusCode = campusMatch ? campusMatch[1] : '';
      let finalGender = 'MALE';
      if (gender) {
        finalGender = gender.toUpperCase().startsWith('F') ? 'FEMALE' : 'MALE';
      } else if (campusCode === 'JN') {
        finalGender = 'FEMALE';
      }

      parsedStudents.push({
        rollNumber: rollUpper,
        name: name.trim(),
        department: finalDept,
        gender: finalGender,
        academicYear,
        email,
        phone,
        password: password || rollUpper.toLowerCase()
      });
    }
  }

  if (parsedStudents.length === 0) {
    throw new ApiError(400, 'No valid student records found in uploaded file. Please ensure columns include Roll Number / HTNO and Name.');
  }

  const result = await studentService.bulkImportStudents(parsedStudents, req.user.id);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        totalParsed: parsedStudents.length,
        successfulCount: result.successful.length,
        failedCount: result.failed.length,
        successful: result.successful,
        failed: result.failed
      },
      `Bulk file import completed: ${result.successful.length} registered, ${result.failed.length} failed`
    )
  );
});

module.exports = {
  registerStudent,
  getStudentProfile,
  getTcClearance,
  getAllStudents,
  clearStudentData,
  getStudentDetails,
  bulkImportStudents,
  bulkImportFromFile
};

