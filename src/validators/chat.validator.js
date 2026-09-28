const Joi = require('joi');

const chatMessageSchema = Joi.object({
  message: Joi.string().trim().min(1).max(1000).required().messages({
    'string.empty': 'Chat message cannot be empty',
    'string.min': 'Chat message cannot be empty',
    'string.max': 'Chat message cannot exceed 1000 characters',
    'any.required': 'Chat message is required'
  }),
  conversationHistory: Joi.array()
    .items(
      Joi.object({
        role: Joi.string().valid('user', 'assistant', 'system').required(),
        content: Joi.string().trim().max(2000).required()
      })
    )
    .max(10)
    .optional(),
  currentRoute: Joi.string().trim().max(150).optional()
});

module.exports = {
  chatMessageSchema
};
