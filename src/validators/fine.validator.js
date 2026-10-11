const Joi = require('joi');

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

const payFineSchema = Joi.object({
  transactionId: Joi.string().regex(objectIdPattern).optional(),
  fineTransactionId: Joi.string().regex(objectIdPattern).optional(),
  rollNumber: Joi.string().trim().uppercase().optional(),
  amount: Joi.number().greater(0).required().messages({
    'number.greater': 'Payment amount must be greater than zero',
    'any.required': 'Payment amount is required'
  }),
  paymentMethod: Joi.string().valid('CASH', 'ONLINE', 'WAIVED', 'UPI').required().messages({
    'any.only': 'Invalid payment method'
  })
}).or('transactionId', 'fineTransactionId', 'rollNumber');

const fineHistoryQuerySchema = Joi.object({
  rollNumber: Joi.string().trim().uppercase().optional(),
  status: Joi.string().valid('PENDING', 'PAID', 'WAIVED').optional()
});

module.exports = {
  payFineSchema,
  fineHistoryQuerySchema
};
