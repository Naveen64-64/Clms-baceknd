const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { optionalJWT } = require('../middlewares/auth.middleware');
const { chatLimiter } = require('../middlewares/rateLimiter.middleware');
const validate = require('../middlewares/validate.middleware');
const { chatMessageSchema } = require('../validators/chat.validator');

// POST /api/v1/chat
// Publicly accessible with optional JWT authentication to populate user identity & role
router.post(
  '/',
  chatLimiter,
  optionalJWT,
  validate(chatMessageSchema),
  chatController.handleChat
);

module.exports = router;
