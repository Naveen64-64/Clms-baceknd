const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const bookService = require('../services/book.service');
const dataset = require('../data/college_library_branch_books_demo.json');

const seedBooks = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kiet_library_db';
    await mongoose.connect(mongoUri);
    console.log('[Seed Books] Connected to MongoDB:', mongoUri);

    const summary = await bookService.importBooksDataset(dataset);

    console.log('========================================================================');
    console.log('   COLLEGE LIBRARY BRANCH BOOKS DEMO DATASET IMPORT SUMMARY            ');
    console.log('========================================================================');
    console.log(`  Total Dataset Records  : ${summary.total}`);
    console.log(`  Books Created          : ${summary.booksCreated}`);
    console.log(`  Books Skipped          : ${summary.booksSkipped}`);
    console.log(`  Copies Created         : ${summary.copiesCreated}`);
    console.log(`  Duplicate Copies       : ${summary.duplicates}`);
    console.log(`  Errors Encountered     : ${summary.errors.length}`);
    console.log('========================================================================');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('[Seed Books Error]:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

seedBooks();
