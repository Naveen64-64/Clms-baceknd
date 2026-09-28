const Joi = require('joi');

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

const reportQuerySchema = Joi.object({
  libraryId: Joi.string().trim().optional(),
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().optional(),
  month: Joi.number().integer().min(1).max(12).optional(),
  year: Joi.number().integer().min(2000).max(2100).optional(),
  branch: Joi.string().valid('AIDS', 'CSM', 'CSD', 'CSC', 'CAI').optional(),
  category: Joi.string().trim().optional(),
  days: Joi.number().integer().min(1).max(365).optional()
});

module.exports = {
  reportQuerySchema
};
