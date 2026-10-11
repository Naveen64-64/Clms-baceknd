const Notification = require('../models/notification.model');
const ApiError = require('../utils/apiError');

const createNotification = async (recipientUserId, type, title, message, relatedEntity = null) => {
  return await Notification.create({
    recipientUser: recipientUserId,
    type,
    title,
    message,
    relatedEntity
  });
};

const getUserNotifications = async (recipientUserId, query = {}) => {
  const filter = { recipientUser: recipientUserId };
  if (query.isRead !== undefined) {
    filter.isRead = query.isRead === 'true';
  }
  return await Notification.find(filter).sort({ createdAt: -1 }).limit(50);
};

const getUnreadCount = async (recipientUserId) => {
  const count = await Notification.countDocuments({
    recipientUser: recipientUserId,
    isRead: false
  });
  return { unreadCount: count };
};

const markAsRead = async (notificationId, recipientUserId) => {
  const notification = await Notification.findOne({
    _id: notificationId,
    recipientUser: recipientUserId
  });
  if (!notification) throw new ApiError(404, 'Notification not found');

  notification.isRead = true;
  await notification.save();
  return notification;
};

const markAllAsRead = async (recipientUserId) => {
  await Notification.updateMany(
    { recipientUser: recipientUserId, isRead: false },
    { isRead: true }
  );
  return { message: 'All notifications marked as read' };
};

module.exports = {
  createNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead
};
