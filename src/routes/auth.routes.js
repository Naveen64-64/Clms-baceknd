const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyJWT } = require('../middlewares/auth.middleware');
const { authLimiter } = require('../middlewares/rateLimiter.middleware');
const validate = require('../middlewares/validate.middleware');
const { loginSchema, refreshTokenSchema, changePasswordSchema } = require('../validators/auth.validator');

router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/refresh-token', authLimiter, validate(refreshTokenSchema), authController.refreshToken);
router.post('/change-password', verifyJWT, validate(changePasswordSchema), authController.changePassword);
router.post('/logout', verifyJWT, authController.logout);
router.get('/me', verifyJWT, authController.getCurrentUser);

module.exports = router;
