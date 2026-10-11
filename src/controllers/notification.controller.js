const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const notificationService = require('../services/notification.service');

const getNotifications = asyncHandler(async (req, res) => {
  const notifications = await notificationService.getUserNotifications(req.user.id, req.query);
  return res.status(200).json(new ApiResponse(200, notifications, 'Notifications retrieved successfully'));
});

const getUnreadCount = asyncHandler(async (req, res) => {
  const result = await notificationService.getUnreadCount(req.user.id);
  return res.status(200).json(new ApiResponse(200, result, 'Unread notification count retrieved'));
});

const markAsRead = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;
  const result = await notificationService.markAsRead(notificationId, req.user.id);
  return res.status(200).json(new ApiResponse(200, result, 'Notification marked as read'));
});

const markAllAsRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllAsRead(req.user.id);
  return res.status(200).json(new ApiResponse(200, result, 'All notifications marked as read'));
});

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead
};
