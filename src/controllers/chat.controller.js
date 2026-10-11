const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const chatbotService = require('../services/chatbot.service');

const handleChat = asyncHandler(async (req, res) => {
  const { message, conversationHistory, currentRoute } = req.body;
  const user = req.user || null;

  try {
    const result = await chatbotService.processMessage({
      message,
      conversationHistory,
      currentRoute,
      user
    });

    return res.status(200).json(
      new ApiResponse(200, result, 'Chat response generated successfully')
    );
  } catch (err) {
    console.error('[ChatController] Unhandled error:', err);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          message:
            "I'm temporarily unable to process your request. Please try again shortly or use the navigation sidebar.",
          actions: []
        },
        'Fallback chat response'
      )
    );
  }
});

module.exports = {
  handleChat
};
