const BorrowTransaction = require('../models/borrowTransaction.model');
const StudentProfile = require('../models/studentProfile.model');
const Notification = require('../models/notification.model');
const FineTransaction = require('../models/fineTransaction.model');
const { BORROW_STATUS } = require('../config/constants');

const processAutomatedReminders = async () => {
  const currentDate = new Date();
  const startOfDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const endOfDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 23, 59, 59);

  const tomorrow = new Date(startOfDay);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date(endOfDay);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

  let remindersSent = 0;

  // 1. Process Due Tomorrow Reminders
  const dueSoonTxs = await BorrowTransaction.find({
    status: BORROW_STATUS.BORROWED,
    dueDate: { $gte: tomorrow, $lte: dayAfterTomorrow }
  }).populate('student').populate({ path: 'bookCopy', populate: { path: 'book' } });

  for (const tx of dueSoonTxs) {
    if (!tx.student?.user) continue;

    const existingNotif = await Notification.findOne({
      recipientUser: tx.student.user,
      type: 'DUE_SOON',
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      'relatedEntity.transactionId': tx._id
    });

    if (!existingNotif) {
      await Notification.create({
        recipientUser: tx.student.user,
        type: 'DUE_SOON',
        title: 'Book Return Reminder',
        message: `Your borrowed book "${tx.bookCopy?.book?.title || 'Book'}" is due tomorrow. Please return it on time to avoid fines.`,
        relatedEntity: { transactionId: tx._id, dueDate: tx.dueDate }
      });
      remindersSent++;
    }
  }

  // 2. Process Due Today Reminders
  const dueTodayTxs = await BorrowTransaction.find({
    status: BORROW_STATUS.BORROWED,
    dueDate: { $gte: startOfDay, $lte: endOfDay }
  }).populate('student').populate({ path: 'bookCopy', populate: { path: 'book' } });

  for (const tx of dueTodayTxs) {
    if (!tx.student?.user) continue;

    const existingNotif = await Notification.findOne({
      recipientUser: tx.student.user,
      type: 'DUE_TODAY',
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      'relatedEntity.transactionId': tx._id
    });

    if (!existingNotif) {
      await Notification.create({
        recipientUser: tx.student.user,
        type: 'DUE_TODAY',
        title: 'Book Due Today!',
        message: `Your borrowed book "${tx.bookCopy?.book?.title || 'Book'}" is due TODAY. Please return it before closing time.`,
        relatedEntity: { transactionId: tx._id, dueDate: tx.dueDate }
      });
      remindersSent++;
    }
  }

  // 3. Process Overdue Status Update & Daily ₹1 Fine Accrual
  const overdueTxs = await BorrowTransaction.find({
    status: { $in: [BORROW_STATUS.BORROWED, BORROW_STATUS.OVERDUE] },
    dueDate: { $lt: startOfDay }
  }).populate('student').populate({ path: 'bookCopy', populate: { path: 'book' } });

  for (const tx of overdueTxs) {
    const diffTime = Math.max(0, currentDate - tx.dueDate);
    const overdueDays = Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
    const fineAmount = overdueDays * 1; // ₹1 per overdue day

    tx.fineAmount = fineAmount;
    if (tx.status === BORROW_STATUS.BORROWED) {
      tx.status = BORROW_STATUS.OVERDUE;
    }
    await tx.save();

    // Idempotent FineTransaction update/upsert
    if (tx.student?._id) {
      let fineTx = await FineTransaction.findOne({ borrowTransaction: tx._id });
      if (fineTx) {
        if (fineTx.status === 'PENDING') {
          fineTx.amount = fineAmount;
          fineTx.overdueFine = fineAmount;
          fineTx.reason = 'OVERDUE';
          await fineTx.save();
        }
      } else {
        await FineTransaction.create({
          student: tx.student._id,
          borrowTransaction: tx._id,
          amount: fineAmount,
          overdueFine: fineAmount,
          conditionFine: 0,
          reason: 'OVERDUE',
          paymentMethod: 'CASH',
          status: 'PENDING'
        });
      }
    }

    if (!tx.student?.user) continue;

    const existingNotif = await Notification.findOne({
      recipientUser: tx.student.user,
      type: 'OVERDUE',
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      'relatedEntity.transactionId': tx._id
    });

    if (!existingNotif) {
      await Notification.create({
        recipientUser: tx.student.user,
        type: 'OVERDUE',
        title: 'Overdue Book Alert!',
        message: `Your borrowed book "${tx.bookCopy?.book?.title || 'Book'}" is ${overdueDays} day(s) OVERDUE. Current fine: ₹${fineAmount} (accruing ₹1/day).`,
        relatedEntity: { transactionId: tx._id, dueDate: tx.dueDate, fineAmount }
      });
      remindersSent++;
    }
  }

  return { remindersSent, processedCount: dueSoonTxs.length + dueTodayTxs.length + overdueTxs.length };
};

module.exports = {
  processAutomatedReminders
};
