const Joi = require('joi');

const createLibrarySchema = Joi.object({
  name: Joi.string().trim().required(),
  code: Joi.string().trim().uppercase().required(),
  capacity: Joi.number().integer().min(1).required(),
  isWomenOnly: Joi.boolean().default(false),
  location: Joi.string().trim().optional().allow(''),
  description: Joi.string().trim().optional().allow(''),
  openingTime: Joi.string().trim().default('09:00 AM'),
  closingTime: Joi.string().trim().default('05:00 PM'),
  status: Joi.string().valid('ACTIVE', 'INACTIVE', 'MAINTENANCE').default('ACTIVE')
});

const updateLibrarySchema = Joi.object({
  name: Joi.string().trim().optional(),
  description: Joi.string().trim().optional().allow(''),
  capacity: Joi.number().integer().min(1).optional(),
  location: Joi.string().trim().optional().allow(''),
  openingTime: Joi.string().trim().optional(),
  closingTime: Joi.string().trim().optional(),
  status: Joi.string().valid('ACTIVE', 'INACTIVE', 'MAINTENANCE').optional()
});

module.exports = {
  createLibrarySchema,
  updateLibrarySchema
};
