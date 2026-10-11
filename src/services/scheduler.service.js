const cron = require('node-cron');
const reminderService = require('./reminder.service');
const libraryHoursService = require('./libraryHours.service');

let cronJob = null;
let libraryClosingJob = null;

const runSchedulerJob = async () => {
  try {
    const result = await reminderService.processAutomatedReminders();
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Scheduler] Processed automated reminders: ${result.remindersSent} reminders sent out of ${result.processedCount} transactions evaluated.`);
    }
  } catch (err) {
    console.error('[Scheduler Error]:', err.message || err);
  }

  // Defensive: check and close any stale visits hourly
  try {
    await libraryHoursService.closeStaleActiveVisits();
  } catch (err) {
    console.error('[Scheduler Error in Stale Visits]:', err.message || err);
  }
};

const startScheduler = async () => {
  if (cronJob) return;

  // 1. Startup Recovery: Immediately resolve any stale active visits from prior days/sessions
  try {
    const recoveryResult = await libraryHoursService.closeStaleActiveVisits();
    if (recoveryResult.closedCount > 0) {
      console.log(`[Scheduler Startup] Resolved ${recoveryResult.closedCount} stale active visit(s) across libraries:`, recoveryResult.affectedLibraries);
    }
  } catch (err) {
    console.error('[Scheduler Startup Error]: Failed to resolve stale active visits:', err.message || err);
  }

  // 2. Run automated reminders check immediately once on startup
  runSchedulerJob();

  // 3. Hourly reminder & stale visit maintenance
  cronJob = cron.schedule('0 * * * *', runSchedulerJob);
  console.log(`[Scheduler] Automated reminders scheduler started (Interval: Hourly)`);

  // 4. Daily 05:00 PM Automatic Library Closing Job (Asia/Kolkata timezone)
  libraryClosingJob = cron.schedule(
    '0 17 * * *',
    async () => {
      try {
        console.log('[Scheduler] 05:00 PM Asia/Kolkata trigger: Executing automatic library closing...');
        await libraryHoursService.autoCloseAllActiveVisits();
      } catch (err) {
        console.error('[Scheduler Error in 5PM Auto-Close]:', err.message || err);
      }
    },
    {
      scheduled: true,
      timezone: 'Asia/Kolkata'
    }
  );
  console.log(`[Scheduler] Registered 05:00 PM Daily Automatic Library Closing Job (Timezone: Asia/Kolkata)`);
};

const stopScheduler = () => {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[Scheduler] Automated reminders scheduler stopped');
  }
  if (libraryClosingJob) {
    libraryClosingJob.stop();
    libraryClosingJob = null;
    console.log('[Scheduler] Daily library closing job stopped');
  }
};

module.exports = {
  startScheduler,
  stopScheduler,
  runSchedulerJob
};

