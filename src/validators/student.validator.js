const Joi = require('joi');
const { GENDERS, ROLL_NUMBER_REGEX } = require('../config/constants');

const registerStudentSchema = Joi.object({
  rollNumber: Joi.string().trim().uppercase()
    .pattern(ROLL_NUMBER_REGEX)
    .required()
    .messages({
      'string.pattern.base': 'Roll Number must be exactly 10 characters in KIET format: '
        + 'YY + Campus Code (B2/6Q/JN) + Digit + Letter + 4-digit Serial. '
        + 'Examples: 23B21A4268, 236Q1A4203, 23JN1A4267'
    }),
  name: Joi.string().trim().required(),
  gender: Joi.string().valid(...Object.values(GENDERS)).required(),
  department: Joi.string().trim().uppercase().required(),
  academicYear: Joi.number().integer().min(1).max(5).required(),
  email: Joi.string().email().trim().optional().allow(''),
  phone: Joi.string().trim().optional().allow(''),
  password: Joi.string().min(6).required()
});

const studentQuerySchema = Joi.object({
  department: Joi.string().trim().optional(),
  gender: Joi.string().valid(...Object.values(GENDERS)).optional(),
  academicYear: Joi.number().integer().min(1).max(5).optional(),
  search: Joi.string().trim().optional().max(100),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const bulkRegisterStudentSchema = Joi.object({
  students: Joi.array().items(registerStudentSchema).min(1).max(500).required()
});

module.exports = {
  registerStudentSchema,
  studentQuerySchema,
  bulkRegisterStudentSchema
};
