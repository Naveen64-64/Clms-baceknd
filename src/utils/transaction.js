const mongoose = require('mongoose');

/**
 * Execute callback within a Mongoose transaction if supported by MongoDB (replica set / Atlas),
 * or execute directly if MongoDB is running as a standalone server.
 */
const runInTransaction = async (callback) => {
  const topology = mongoose.connection.client?.topology;
  const type = topology?.description?.type;
  const isReplicaSetOrSharded = type === 'ReplicaSetWithPrimary' || type === 'Sharded';

  if (!isReplicaSetOrSharded) {
    // Standalone MongoDB server -> run directly without session/transaction
    return await callback(null);
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    session.endSession();
  }
};

module.exports = {
  runInTransaction
};
