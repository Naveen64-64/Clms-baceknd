const Joi = require('joi');

const createTcRequestSchema = Joi.object({
  reason: Joi.string().required().trim().messages({
    'string.empty': 'Reason for TC / No Due request is required',
    'any.required': 'Reason for TC / No Due request is required'
  }),
  fathersName: Joi.string().allow('', null).trim(),
  enclosures: Joi.object({
    idCard: Joi.boolean().default(true),
    libraryCard: Joi.boolean().default(true),
    photocopyPC: Joi.boolean().default(false)
  }).optional()
});

const rejectTcRequestSchema = Joi.object({
  rejectionReason: Joi.string().required().trim().min(3).messages({
    'string.empty': 'Rejection reason is required',
    'string.min': 'Rejection reason must be at least 3 characters',
    'any.required': 'Rejection reason is required'
  })
});

module.exports = {
  createTcRequestSchema,
  rejectTcRequestSchema
};
