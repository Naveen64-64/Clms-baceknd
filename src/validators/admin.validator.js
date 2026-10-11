const Joi = require('joi');

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

const createLibrarianSchema = Joi.object({
  name: Joi.string().trim().required(),
  email: Joi.string().email().trim().lowercase().required(),
  password: Joi.string().min(6).required(),
  assignedLibraryId: Joi.string().regex(objectIdPattern).required().messages({
    'string.pattern.base': 'assignedLibraryId must be a valid 24-character ObjectId'
  }),
  phone: Joi.string().trim().optional().allow('')
});

const updateLibrarianSchema = Joi.object({
  name: Joi.string().trim().optional(),
  phone: Joi.string().trim().optional().allow(''),
  assignedLibraryId: Joi.string().regex(objectIdPattern).optional().messages({
    'string.pattern.base': 'assignedLibraryId must be a valid 24-character ObjectId'
  })
});

const toggleLibrarianStatusSchema = Joi.object({
  isActive: Joi.boolean().required()
});

const resetLibrarianPasswordSchema = Joi.object({
  newPassword: Joi.string().min(6).required()
});

const updateSettingsSchema = Joi.object({
  fineRatePerOverdueDay: Joi.number().min(0).optional(),
  defaultMaxBorrowLimit: Joi.number().integer().min(1).optional(),
  standardLoanDurationDays: Joi.number().integer().min(1).optional(),
  fineRatePerDay: Joi.number().min(0).optional(),
  maxBorrowLimit: Joi.number().integer().min(1).optional(),
  loanDurationDays: Joi.number().integer().min(1).optional(),
  maxBooksPerStudent: Joi.number().integer().min(1).optional(),
  defaultLoanDays: Joi.number().integer().min(1).optional(),
  finePerDay: Joi.number().min(0).optional(),
  initialSecurityDeposit: Joi.number().min(0).optional()
}).min(1);

module.exports = {
  createLibrarianSchema,
  updateLibrarianSchema,
  toggleLibrarianStatusSchema,
  resetLibrarianPasswordSchema,
  updateSettingsSchema
};
