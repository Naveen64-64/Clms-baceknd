const Joi = require('joi');

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

const issueBookSchema = Joi.object({
  rollNumber: Joi.string().trim().uppercase().optional(),
  facultyId: Joi.string().trim().uppercase().optional(),
  userIdentifier: Joi.string().trim().uppercase().optional(),
  bookId: Joi.string().trim().optional(),
  callNo: Joi.string().trim().optional(),
  barcode: Joi.string().trim().uppercase().optional()
}).or('rollNumber', 'facultyId', 'userIdentifier').or('bookId', 'callNo', 'barcode');

const returnBookSchema = Joi.object({
  rollNumber: Joi.string().trim().uppercase().optional(),
  facultyId: Joi.string().trim().uppercase().optional(),
  userIdentifier: Joi.string().trim().uppercase().optional(),
  bookId: Joi.string().trim().optional(),
  callNo: Joi.string().trim().optional(),
  barcode: Joi.string().trim().uppercase().optional(),
  transactionId: Joi.string().regex(objectIdPattern).optional(),
  condition: Joi.string().valid('GOOD', 'DAMAGED', 'LOST').required().messages({
    'any.required': 'Return condition is required',
    'any.only': 'condition must be one of GOOD, DAMAGED, LOST'
  })
}).or('bookId', 'callNo', 'barcode', 'transactionId');

const overdueQuerySchema = Joi.object({
  libraryId: Joi.string().trim().optional()
});

const historyQuerySchema = Joi.object({
  studentId: Joi.string().regex(objectIdPattern).optional(),
  rollNumber: Joi.string().trim().uppercase().optional()
});

module.exports = {
  issueBookSchema,
  returnBookSchema,
  overdueQuerySchema,
  historyQuerySchema
};
