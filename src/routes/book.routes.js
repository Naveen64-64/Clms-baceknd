const express = require('express');
const router = express.Router();
const bookController = require('../controllers/book.controller');
const { verifyJWT, optionalJWT } = require('../middlewares/auth.middleware');
const { authorizeRoles } = require('../middlewares/rbac.middleware');
const { logAudit } = require('../middlewares/audit.middleware');
const validate = require('../middlewares/validate.middleware');
const {
  createBookSchema,
  updateBookSchema,
  addBookCopySchema,
  updateBookCopySchema,
  retireBookCopySchema,
  retireBookMasterSchema,
  searchBookQuerySchema
} = require('../validators/book.validator');
const { ROLES } = require('../config/constants');

// Public routes
router.get('/categories', optionalJWT, bookController.getCategories);
router.get('/filter-options', optionalJWT, bookController.getFilterOptions);
router.get('/new-arrivals', optionalJWT, bookController.getNewArrivals);
router.get('/search', optionalJWT, validate(searchBookQuerySchema, 'query'), bookController.searchBooks);
router.get('/', optionalJWT, validate(searchBookQuerySchema, 'query'), bookController.searchBooks);
router.get('/details/:bookId', optionalJWT, bookController.getBookDetails);
router.get('/:bookId', optionalJWT, bookController.getBookDetails);

// Librarian & Admin inventory management
router.get('/inventory/librarian', verifyJWT, authorizeRoles(ROLES.LIBRARIAN), bookController.getLibrarianInventory);
// Section 5: ADMIN ONLY for /inventory/admin
router.get('/inventory/admin', verifyJWT, authorizeRoles(ROLES.ADMIN), bookController.getAdminInventory);

// Book Copy CRUD & Retirement
router.post('/copy', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), validate(addBookCopySchema), logAudit('CREATE_BOOK_COPY', 'BOOKS'), bookController.addBookCopy);
router.get('/copy/:copyId', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), bookController.getBookCopyById);
router.put('/copy/:copyId', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), validate(updateBookCopySchema), logAudit('UPDATE_BOOK_COPY', 'BOOKS'), bookController.updateBookCopy);
router.patch('/copy/:copyId/retire', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), validate(retireBookCopySchema), logAudit('RETIRE_BOOK_COPY', 'BOOKS'), bookController.retireBookCopy);

// Book Master CRUD & Retirement
router.post('/import', verifyJWT, authorizeRoles(ROLES.ADMIN, ROLES.LIBRARIAN), logAudit('BULK_IMPORT_BOOKS', 'BOOKS'), bookController.importBooks);
router.post('/', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), validate(createBookSchema), logAudit('CREATE_BOOK_MASTER', 'BOOKS'), bookController.createBook);
router.put('/:bookId', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), validate(updateBookSchema), logAudit('UPDATE_BOOK_MASTER', 'BOOKS'), bookController.updateBook);
router.patch('/:bookId/retire', verifyJWT, authorizeRoles(ROLES.LIBRARIAN, ROLES.ADMIN), validate(retireBookMasterSchema), logAudit('RETIRE_BOOK_MASTER', 'BOOKS'), bookController.retireBookMaster);

module.exports = router;
