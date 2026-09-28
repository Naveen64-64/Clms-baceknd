const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');
const Library = require('../models/library.model');
const Book = require('../models/book.model');
const BookCopy = require('../models/bookCopy.model');
const BorrowTransaction = require('../models/borrowTransaction.model');
const { BOOK_STATUS, BORROW_STATUS } = require('../config/constants');

const normalizeInventory = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kiet_library_db';
    await mongoose.connect(mongoUri);
    console.log('[Normalize Inventory] Connected to MongoDB:', mongoUri);

    const libraries = await Library.find({ status: { $ne: 'INACTIVE' }, code: { $in: ['KIET_MAIN', 'KIET_2', 'KIET_WOMEN'] } }).sort({ code: 1 });
    if (libraries.length === 0) {
      console.error('[Normalize Inventory Error] No libraries found in DB.');
      await mongoose.disconnect();
      process.exit(1);
    }

    const activeBooks = await Book.find({ isRetired: false }).sort({ title: 1 });
    console.log(`[Normalize Inventory] Found ${libraries.length} libraries and ${activeBooks.length} active master books.`);

    let totalCopiesCreated = 0;
    let totalCopiesRemoved = 0;
    let totalReconciledIssued = 0;
    let totalReconciledDamaged = 0;
    let totalReconciledLost = 0;
    let totalReconciledAvailable = 0;

    for (const book of activeBooks) {
      for (const lib of libraries) {
        let libPrefix = 'KM';
        if (lib.code === 'KIET_2') libPrefix = 'K2';
        else if (lib.code === 'KIET_WOMEN') libPrefix = 'KW';
        else if (lib.code) libPrefix = lib.code.replace('KIET_', 'K');

        const cleanExtId = book.externalId ? book.externalId.replace('DEMO-', '') : book._id.toString().slice(-6);

        // Fetch existing non-retired copies for this (book, library)
        let existingCopies = await BookCopy.find({ book: book._id, library: lib._id, isRetired: false }).sort({ barcode: 1, createdAt: 1 });

        const targetCount = 10;

        if (existingCopies.length > targetCount) {
          // Safely trim excess unborrowed copies to ensure exactly 10 copies per library
          const countToRemove = existingCopies.length - targetCount;
          let removedForThisBook = 0;

          for (const copy of existingCopies) {
            if (removedForThisBook >= countToRemove) break;

            const hasActiveOrPastBorrow = await BorrowTransaction.exists({ bookCopy: copy._id });
            if (!hasActiveOrPastBorrow) {
              await BookCopy.findByIdAndDelete(copy._id);
              removedForThisBook++;
              totalCopiesRemoved++;
            }
          }

          // Re-fetch remaining copies
          existingCopies = await BookCopy.find({ book: book._id, library: lib._id, isRetired: false }).sort({ barcode: 1, createdAt: 1 });
        }

        if (existingCopies.length < targetCount) {
          const missingCount = targetCount - existingCopies.length;
          let createdForThisBook = 0;

          for (let i = 1; i <= targetCount * 2; i++) {
            if (createdForThisBook >= missingCount) break;

            const indexStr = String(i).padStart(2, '0');
            const barcode = `${libPrefix}-${book.branch || 'GEN'}-${cleanExtId}-${indexStr}`;

            const barcodeExists = await BookCopy.findOne({ barcode });
            if (!barcodeExists) {
              await BookCopy.create({
                book: book._id,
                library: lib._id,
                barcode,
                rackLocation: `${book.branch || 'GEN'}-RACK-1`,
                status: BOOK_STATUS.AVAILABLE,
                isRetired: false
              });
              createdForThisBook++;
              totalCopiesCreated++;
            }
          }
        }
      }
    }

    // Status Reconciliation with Borrow Transactions
    console.log('[Normalize Inventory] Reconciling BookCopy statuses against circulation history...');

    const allCopies = await BookCopy.find({ isRetired: false });

    for (const copy of allCopies) {
      // Check for active (unreturned) borrow transaction
      const activeTx = await BorrowTransaction.findOne({
        bookCopy: copy._id,
        status: { $in: [BORROW_STATUS.BORROWED, BORROW_STATUS.OVERDUE] }
      });

      if (activeTx) {
        if (copy.status !== BOOK_STATUS.ISSUED) {
          copy.status = BOOK_STATUS.ISSUED;
          await copy.save();
        }
        totalReconciledIssued++;
        continue;
      }

      // Check last completed transaction if copy is not explicitly lost or damaged
      const lastTx = await BorrowTransaction.findOne({
        bookCopy: copy._id,
        status: BORROW_STATUS.RETURNED
      }).sort({ returnDate: -1 });

      if (lastTx && lastTx.conditionOnReturn === 'DAMAGED') {
        if (copy.status !== 'DAMAGED') {
          copy.status = 'DAMAGED';
          await copy.save();
        }
        totalReconciledDamaged++;
      } else if (lastTx && lastTx.conditionOnReturn === 'LOST') {
        if (copy.status !== 'LOST') {
          copy.status = 'LOST';
          await copy.save();
        }
        totalReconciledLost++;
      } else {
        if (copy.status === BOOK_STATUS.ISSUED) {
          // No active borrow tx -> reset to AVAILABLE
          copy.status = BOOK_STATUS.AVAILABLE;
          await copy.save();
        }
        if (copy.status === BOOK_STATUS.AVAILABLE) {
          totalReconciledAvailable++;
        } else if (copy.status === 'DAMAGED') {
          totalReconciledDamaged++;
        } else if (copy.status === 'LOST') {
          totalReconciledLost++;
        }
      }
    }

    console.log('========================================================================');
    console.log('   CLMS INVENTORY NORMALIZATION & RECONCILIATION SUMMARY                ');
    console.log('========================================================================');
    console.log(`  Active Master Books Processed : ${activeBooks.length}`);
    console.log(`  Target Copies Per Library/Book: 10`);
    console.log(`  New Physical Copies Created   : ${totalCopiesCreated}`);
    console.log(`  Excess Unborrowed Copies Removed: ${totalCopiesRemoved}`);
    console.log(`  Reconciled AVAILABLE Copies   : ${totalReconciledAvailable}`);
    console.log(`  Reconciled ISSUED Copies      : ${totalReconciledIssued}`);
    console.log(`  Reconciled DAMAGED Copies     : ${totalReconciledDamaged}`);
    console.log(`  Reconciled LOST Copies        : ${totalReconciledLost}`);
    console.log('========================================================================');

    await mongoose.disconnect();
    console.log('[Normalize Inventory] Done successfully!');
    process.exit(0);
  } catch (error) {
    console.error('[Normalize Inventory Error]:', error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
};

normalizeInventory();
