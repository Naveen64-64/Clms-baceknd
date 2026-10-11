const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');

// Models
const Library = require('../models/library.model');
const User = require('../models/user.model');
const LibrarianProfile = require('../models/librarianProfile.model');
const AdminSetting = require('../models/adminSetting.model');
const Book = require('../models/book.model');
const StudentProfile = require('../models/studentProfile.model');
const OpenUserProfile = require('../models/openUserProfile.model');
const LibraryGateLog = require('../models/libraryGateLog.model');
const InventoryTransaction = require('../models/inventoryTransaction.model');

async function migrateData() {
  const localUri = process.env.LOCAL_MONGODB_URI || 'mongodb://127.0.0.1:27017/kiet_library_db';
  const atlasUri = process.env.MONGODB_URI;

  console.log('[Migration] Starting DB migration check...');
  console.log('[Migration] Local Mongo URI:', localUri);
  console.log('[Migration] Atlas Mongo URI:', atlasUri ? atlasUri.replace(/:[^:@]+@/, ':****@') : 'UNDEFINED');

  if (!atlasUri) {
    console.error('[Migration Error] MONGODB_URI is not set in environment.');
    process.exit(1);
  }

  let localConnection = null;
  let hasLocalData = false;

  try {
    console.log('[Migration] Attempting to connect to Local MongoDB to read existing data...');
    localConnection = await mongoose.createConnection(localUri, { serverSelectionTimeoutMS: 3000 }).asPromise();
    console.log('[Migration] Successfully connected to Local MongoDB.');
    
    // Check local collections
    const collections = await localConnection.db.listCollections().toArray();
    console.log(`[Migration] Found ${collections.length} collection(s) in local DB.`);

    if (collections.length > 0) {
      for (const col of collections) {
        const count = await localConnection.db.collection(col.name).countDocuments();
        console.log(` - Local Collection '${col.name}': ${count} documents`);
        if (count > 0) hasLocalData = true;
      }
    }
  } catch (err) {
    console.log('[Migration Note] Local MongoDB not reachable or empty. Will perform direct Atlas initialization/seeding.');
  }

  // Connect to Atlas MongoDB via mongoose main connection
  try {
    console.log('[Migration] Connecting to MongoDB Atlas Cloud...');
    await mongoose.connect(atlasUri);
    console.log('[Migration] Successfully connected to MongoDB Atlas Cloud!');

    if (hasLocalData && localConnection) {
      console.log('[Migration] Transferring local data to Atlas DB...');
      const collections = await localConnection.db.listCollections().toArray();

      for (const colInfo of collections) {
        const colName = colInfo.name;
        const localDocs = await localConnection.db.collection(colName).find({}).toArray();
        if (localDocs.length === 0) continue;

        console.log(`[Migration] Copying ${localDocs.length} document(s) for collection '${colName}'...`);
        const targetCollection = mongoose.connection.db.collection(colName);
        
        for (const doc of localDocs) {
          await targetCollection.replaceOne({ _id: doc._id }, doc, { upsert: true });
        }
        console.log(`[Migration] Collection '${colName}' synced to Atlas successfully.`);
      }
    } else {
      console.log('[Migration] Seeding Atlas DB defaults...');
    }

    if (localConnection) {
      await localConnection.close();
    }

    console.log('[Migration] Database migration completed successfully!');
  } catch (error) {
    console.error('[Migration Error]:', error.message);
    process.exit(1);
  }
}

migrateData().then(() => {
  console.log('[Migration] Done.');
  process.exit(0);
}).catch(err => {
  console.error('[Migration Error]:', err);
  process.exit(1);
});
