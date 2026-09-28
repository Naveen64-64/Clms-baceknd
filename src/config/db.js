const dns = require('dns');
const mongoose = require('mongoose');

// Configure reliable DNS servers for MongoDB Atlas SRV resolution on Windows/local DNS
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (dnsErr) {
  console.warn('[MongoDB] Warning: Could not set custom DNS servers:', dnsErr.message);
}

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`[MongoDB] Connected: ${conn.connection.host} / ${conn.connection.name}`);
  } catch (error) {
    console.error(`[MongoDB] Connection Error: ${error.message}`);
    if (process.env.MONGODB_URI && process.env.MONGODB_URI.includes('mongodb.net')) {
      console.error('\n[MongoDB Atlas] Connection failed. Fix with these steps:');
      console.error('  1. Check your internet connection');
      console.error('  2. Go to https://cloud.mongodb.com → Your Project → Network Access');
      console.error('  3. Click "+ Add IP Address" → "Allow Access from Anywhere" (adds 0.0.0.0/0)');
      console.error('  4. Wait 30 seconds, then restart the server\n');
    }
    process.exit(1);
  }
};

module.exports = connectDB;
