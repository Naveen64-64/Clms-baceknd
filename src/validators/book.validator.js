const Joi = require('joi');

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

const createBookSchema = Joi.object({
  callNo: Joi.string().trim().required(),
  title: Joi.string().trim().required(),
  author: Joi.string().trim().required(),
  isbn: Joi.string().trim().uppercase().optional().allow(''),
  category: Joi.string().trim().required(),
  department: Joi.string().trim().optional().allow(''),
  branch: Joi.string().trim().optional().default('GENERAL'),
  publisher: Joi.string().trim().optional().allow(''),
  edition: Joi.string().trim().optional().allow(''),
  publicationYear: Joi.number().optional(),
  pages: Joi.string().trim().optional().allow(''),
  price: Joi.number().optional(),
  language: Joi.string().trim().optional().allow(''),
  subject: Joi.string().trim().optional().allow(''),
  accessionNumber: Joi.string().trim().optional().allow(''),
  description: Joi.string().trim().optional().allow(''),
  imageUrl: Joi.string().trim().optional().allow(''),
  externalId: Joi.string().trim().optional()
});

const updateBookSchema = Joi.object({
  callNo: Joi.string().trim().optional(),
  title: Joi.string().trim().optional(),
  author: Joi.string().trim().optional(),
  isbn: Joi.string().trim().uppercase().optional().allow(''),
  category: Joi.string().trim().optional(),
  department: Joi.string().trim().optional().allow(''),
  branch: Joi.string().trim().optional(),
  publisher: Joi.string().trim().optional().allow(''),
  edition: Joi.string().trim().optional().allow(''),
  publicationYear: Joi.number().optional(),
  pages: Joi.string().trim().optional().allow(''),
  price: Joi.number().optional(),
  language: Joi.string().trim().optional().allow(''),
  subject: Joi.string().trim().optional().allow(''),
  description: Joi.string().trim().optional().allow(''),
  imageUrl: Joi.string().trim().optional().allow('')
});

const addBookCopySchema = Joi.object({
  bookId: Joi.string().regex(objectIdPattern).required().messages({
    'string.pattern.base': 'bookId must be a valid 24-character ObjectId'
  }),
  barcode: Joi.string().trim().uppercase().required(),
  libraryId: Joi.string().regex(objectIdPattern).optional().messages({
    'string.pattern.base': 'libraryId must be a valid 24-character ObjectId'
  }),
  rackLocation: Joi.string().trim().optional().default('General Rack')
});

const updateBookCopySchema = Joi.object({
  rackLocation: Joi.string().trim().optional(),
  status: Joi.string().valid('AVAILABLE', 'ISSUED', 'LOST', 'DAMAGED', 'RETIRED').optional()
});

const retireBookCopySchema = Joi.object({
  reason: Joi.string().trim().required()
});

const retireBookMasterSchema = Joi.object({
  reason: Joi.string().trim().required()
});

const searchBookQuerySchema = Joi.object({
  search: Joi.string().trim().optional().max(100),
  category: Joi.string().trim().optional(),
  branch: Joi.string().trim().optional(),
  department: Joi.string().trim().optional(),
  libraryId: Joi.string().trim().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  includeRetired: Joi.boolean().default(false),
  availability: Joi.string().trim().optional(),
  isNewArrival: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional()
});


module.exports = {
  createBookSchema,
  updateBookSchema,
  addBookCopySchema,
  updateBookCopySchema,
  retireBookCopySchema,
  retireBookMasterSchema,
  searchBookQuerySchema
};
