const StudentProfile = require('../models/studentProfile.model');
const FacultyProfile = require('../models/facultyProfile.model');
const User = require('../models/user.model');
const { ROLES } = require('../config/constants');
const ApiError = require('../utils/apiError');

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const getAllUsers = async (query = {}) => {
  const { userType = 'ALL', search, page = 1, limit = 20, department, gender, academicYear } = query;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const safeSearch = search ? escapeRegex(search.trim()) : null;

  let results = [];
  let totalCount = 0;

  if (userType === 'STUDENT') {
    const filter = {};
    if (department) filter.department = department.trim();
    if (gender) filter.gender = gender.toUpperCase();
    if (academicYear) filter.academicYear = Number(academicYear);
    if (safeSearch) {
      filter.$or = [
        { rollNumber: { $regex: safeSearch, $options: 'i' } },
        { name: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
        { phone: { $regex: safeSearch, $options: 'i' } }
      ];
    }

    totalCount = await StudentProfile.countDocuments(filter);
    const students = await StudentProfile.find(filter)
      .populate('user', 'username isActive createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    results = students.map((s) => ({
      userType: ROLES.STUDENT,
      role: ROLES.STUDENT,
      id: s.rollNumber,
      rollNumber: s.rollNumber,
      identifier: s.rollNumber,
      name: s.name,
      department: s.department,
      email: s.email || '',
      phone: s.phone || '',
      status: s.user?.isActive ? 'ACTIVE' : 'INACTIVE',
      createdAt: s.createdAt
    }));
  } else if (userType === 'FACULTY') {
    const filter = {};
    if (safeSearch) {
      filter.$or = [
        { facultyId: { $regex: safeSearch, $options: 'i' } },
        { name: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
        { phone: { $regex: safeSearch, $options: 'i' } }
      ];
    }

    totalCount = await FacultyProfile.countDocuments(filter);
    const faculty = await FacultyProfile.find(filter)
      .populate('user', 'username isActive createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    results = faculty.map((f) => ({
      userType: ROLES.FACULTY,
      role: ROLES.FACULTY,
      id: f.facultyId,
      facultyId: f.facultyId,
      identifier: f.facultyId,
      name: f.name,
      department: 'FACULTY',
      email: f.email || '',
      phone: f.phone || '',
      status: f.user?.isActive ? 'ACTIVE' : 'INACTIVE',
      createdAt: f.createdAt
    }));
  } else {
    // ALL USERS: Fetch students and faculty
    const studentFilter = {};
    if (department) studentFilter.department = department.trim();
    if (gender) studentFilter.gender = gender.toUpperCase();
    if (academicYear) studentFilter.academicYear = Number(academicYear);
    if (safeSearch) {
      studentFilter.$or = [
        { rollNumber: { $regex: safeSearch, $options: 'i' } },
        { name: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
        { phone: { $regex: safeSearch, $options: 'i' } }
      ];
    }

    const facultyFilter = {};
    if (safeSearch) {
      facultyFilter.$or = [
        { facultyId: { $regex: safeSearch, $options: 'i' } },
        { name: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
        { phone: { $regex: safeSearch, $options: 'i' } }
      ];
    }

    const [students, facultyCount, studentsCount, faculty] = await Promise.all([
      StudentProfile.find(studentFilter).populate('user', 'username isActive createdAt'),
      FacultyProfile.countDocuments(facultyFilter),
      StudentProfile.countDocuments(studentFilter),
      FacultyProfile.find(facultyFilter).populate('user', 'username isActive createdAt')
    ]);

    totalCount = studentsCount + facultyCount;

    const mappedStudents = students.map((s) => ({
      userType: ROLES.STUDENT,
      role: ROLES.STUDENT,
      id: s.rollNumber,
      rollNumber: s.rollNumber,
      identifier: s.rollNumber,
      name: s.name,
      department: s.department,
      email: s.email || '',
      phone: s.phone || '',
      status: s.user?.isActive ? 'ACTIVE' : 'INACTIVE',
      createdAt: s.createdAt
    }));

    const mappedFaculty = faculty.map((f) => ({
      userType: ROLES.FACULTY,
      role: ROLES.FACULTY,
      id: f.facultyId,
      facultyId: f.facultyId,
      identifier: f.facultyId,
      name: f.name,
      department: 'FACULTY',
      email: f.email || '',
      phone: f.phone || '',
      status: f.user?.isActive ? 'ACTIVE' : 'INACTIVE',
      createdAt: f.createdAt
    }));

    const combined = [...mappedStudents, ...mappedFaculty].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    results = combined.slice(skip, skip + limitNum);
  }

  return {
    users: results,
    pagination: {
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalCount / limitNum)
    }
  };
};

module.exports = {
  getAllUsers
};
