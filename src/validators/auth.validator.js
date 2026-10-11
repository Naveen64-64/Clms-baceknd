const Joi = require('joi');

const loginSchema = Joi.object({
  username: Joi.string().trim().optional(),
  email: Joi.string().trim().optional(),
  rollNumber: Joi.string().trim().optional(),
  password: Joi.string().required()
}).or('username', 'email', 'rollNumber');

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().trim().required()
});

const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required()
});

module.exports = {
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema
};
