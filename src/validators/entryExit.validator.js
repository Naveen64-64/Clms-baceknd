const Joi = require('joi');

const gateEntryExitSchema = Joi.object({
  rollNumber: Joi.string().trim().uppercase().optional(),
  userId: Joi.string().trim().uppercase().optional(),
  userIdentifier: Joi.string().trim().uppercase().optional(),
  libraryId: Joi.string().trim().required(),
  action: Joi.string().valid('IN', 'OUT').optional()
}).or('rollNumber', 'userId', 'userIdentifier');

const activeVisitsQuerySchema = Joi.object({
  libraryId: Joi.string().trim().optional()
});

module.exports = {
  gateEntryExitSchema,
  activeVisitsQuerySchema
};
