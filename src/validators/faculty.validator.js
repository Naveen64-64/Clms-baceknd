const Joi = require('joi');

const registerFacultySchema = Joi.object({
  facultyId: Joi.string().trim().uppercase().required().messages({
    'string.empty': 'Faculty ID is required',
    'any.required': 'Faculty ID is required'
  }),
  name: Joi.string().trim().optional(),
  fullName: Joi.string().trim().optional(),
  email: Joi.string().email().trim().lowercase().required().messages({
    'string.empty': 'Email Address is required',
    'string.email': 'Valid Email Address is required',
    'any.required': 'Email Address is required'
  }),
  phone: Joi.string().trim().required().messages({
    'string.empty': 'Phone Number is required',
    'any.required': 'Phone Number is required'
  }),
  password: Joi.string().min(6).required().messages({
    'string.empty': 'Password is required',
    'string.min': 'Password must be at least 6 characters',
    'any.required': 'Password is required'
  }),
  // Optional legacy fields that should never be required
  department: Joi.string().trim().optional(),
  employeeId: Joi.string().trim().optional()
}).or('name', 'fullName').messages({
  'object.missing': 'Full Name (or name) is required'
});

module.exports = {
  registerFacultySchema
};

