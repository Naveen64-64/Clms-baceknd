const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Book = require('../models/book.model');
const BookCopy = require('../models/bookCopy.model');

async function backup() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('ERROR: MONGO_URI is missing');
    process.exit(1);
  }

  console.log('Connecting to MongoDB for pre-migration backup...');
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  const backupDir = path.join(__dirname, '../data/backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const booksBackupPath = path.join(backupDir, `books_backup_${timestamp}.json`);
  const copiesBackupPath = path.join(backupDir, `bookcopies_backup_${timestamp}.json`);

  console.log('Fetching existing books...');
  const books = await Book.find({}).lean();
  console.log(`Found ${books.length} existing books. Writing to ${booksBackupPath}...`);
  fs.writeFileSync(booksBackupPath, JSON.stringify(books, null, 2));

  console.log('Fetching existing book copies...');
  const copies = await BookCopy.find({}).lean();
  console.log(`Found ${copies.length} existing book copies. Writing to ${copiesBackupPath}...`);
  fs.writeFileSync(copiesBackupPath, JSON.stringify(copies, null, 2));

  const booksStats = fs.statSync(booksBackupPath);
  const copiesStats = fs.statSync(copiesBackupPath);

  console.log('\n--- BACKUP CONFIRMATION ---');
  console.log(`Books Backup: ${booksBackupPath} (${booksStats.size} bytes, ${books.length} documents)`);
  console.log(`Copies Backup: ${copiesBackupPath} (${copiesStats.size} bytes, ${copies.length} documents)`);

  if (!fs.existsSync(booksBackupPath) || !fs.existsSync(copiesBackupPath)) {
    throw new Error('Backup file verification failed: file does not exist.');
  }

  console.log('Backup completed successfully.');
  await mongoose.disconnect();
}

backup().catch(err => {
  console.error('BACKUP FAILED:', err);
  process.exit(1);
});
