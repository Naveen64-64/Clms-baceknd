const multer = require('multer');
const path = require('path');
const ApiError = require('../utils/apiError');

// Store file in memory buffer for in-memory XLSX/CSV parsing
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.csv', '.xlsx', '.xls'];

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(
      new ApiError(
        400,
        `Invalid file type '${ext}'. Please upload an Excel (.xlsx, .xls) or CSV (.csv) file.`
      ),
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max limit
  }
});

module.exports = upload;
