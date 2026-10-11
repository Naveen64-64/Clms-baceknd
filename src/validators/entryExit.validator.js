const Joi = require('joi');

const gateEntryExitSchema = Joi.object({
  rollNumber: Joi.string().trim().uppercase().optional(),
  userId: Joi.string().trim().uppercase().optional(),
  userIdentifier: Joi.string().trim().uppercase().optional(),
<<<<<<< HEAD
  candidates: Joi.array().items(Joi.string().trim().uppercase()).optional(),
  libraryId: Joi.string().trim().required(),
  action: Joi.string().valid('IN', 'OUT').optional()
}).or('rollNumber', 'userId', 'userIdentifier', 'candidates');
=======
  libraryId: Joi.string().trim().required(),
  action: Joi.string().valid('IN', 'OUT').optional()
}).or('rollNumber', 'userId', 'userIdentifier');
>>>>>>> 896b1feddeb4731643c43df589ca8ef7b6d8eaa2

const activeVisitsQuerySchema = Joi.object({
  libraryId: Joi.string().trim().optional()
});

module.exports = {
  gateEntryExitSchema,
  activeVisitsQuerySchema
};
