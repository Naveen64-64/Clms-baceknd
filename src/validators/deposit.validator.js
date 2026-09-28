const Joi = require('joi');
const { DEPOSIT_TRANSACTION_TYPES } = require('../config/constants');

const deductDepositSchema = Joi.object({
  rollNumber: Joi.string().trim().uppercase().required(),
  amount: Joi.number().positive().required().messages({
    'number.positive': 'Deduction amount must be strictly greater than 0'
  }),
  reason: Joi.string().trim().required(),
  type: Joi.string().valid(...Object.values(DEPOSIT_TRANSACTION_TYPES)).optional()
});

const refundDepositSchema = Joi.object({
  rollNumber: Joi.string().trim().uppercase().required()
});

const ledgerQuerySchema = Joi.object({
  rollNumber: Joi.string().trim().uppercase().optional()
});

module.exports = {
  deductDepositSchema,
  refundDepositSchema,
  ledgerQuerySchema
};
