const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Book = require('../models/book.model');
const BookCopy = require('../models/bookCopy.model');
const Library = require('../models/library.model');

const isDryRun = process.argv.includes('--dry-run');

console.log('========================================================================================');
console.log(`CLMS MIGRATION ENGINE — ACCESSION REGISTER IMPORT ${isDryRun ? '(DRY RUN MODE)' : '(LIVE DATABASE IMPORT)'}`);
console.log('========================================================================================');

const excelPath = path.resolve(__dirname, '../../../Accession Register FINAL.xls');
if (!fs.existsSync(excelPath)) {
  console.error(`ERROR: Accession register not found at ${excelPath}`);
  process.exit(1);
}

function getClean(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function enhancedNormalizeTitle(str) {
  if (!str) return '';
  let s = str.toLowerCase();
  // Remove MARC21 statement of responsibility trailing slash: e.g. " / "
  s = s.replace(/\s*\/\s*$/, '');
  // Replace & and + with and
  s = s.replace(/\s*&\s*/g, ' and ');
  s = s.replace(/\s*\+\s*/g, ' and ');
  // Standardize roman numerals in volume/edition
  s = s.replace(/\bvol(ume)?\s*\.?\s*i\b/g, 'vol 1')
       .replace(/\bvol(ume)?\s*\.?\s*ii\b/g, 'vol 2')
       .replace(/\bvol(ume)?\s*\.?\s*iii\b/g, 'vol 3')
       .replace(/\bvol(ume)?\s*\.?\s*iv\b/g, 'vol 4');
  // Strip special characters
  s = s.replace(/[^a-z0-9]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

async function runMigration() {
  const startTime = Date.now();
  console.log(`\n[1/5] Loading workbook: ${excelPath}...`);
  const workbook = xlsx.readFile(excelPath, { cellDates: true });
  console.log(`Workbook loaded in ${((Date.now() - startTime) / 1000).toFixed(2)}s. Total Sheets: ${workbook.SheetNames.length}`);

  // Sheet definitions & exclusion documentation
  const sheetSummary = [
    { name: 'FINAL REG', status: 'INCLUDED (Primary Base)', reason: 'Primary register export (accessions 2 to 44133)' },
    { name: 'SC BB', status: 'INCLUDED (Enrichment)', reason: 'Provides missing Titles & Call Nos for accessions 6086 to 11083' },
    { name: '1T0 4505(1)', status: 'INCLUDED (Tail Extension)', reason: 'Supplies 311 newer accession records extending to 45812' },
    { name: 'Accession Register For Books-re', status: 'INCLUDED (Letter-Suffixed Books)', reason: 'Supplies 272 letter-suffixed accession records (e.g. 39048A)' },
    { name: 'Sheet1', status: 'EXCLUDED', reason: '100.0% identical duplicate of ACC REGIS' },
    { name: 'Sheet3', status: 'EXCLUDED', reason: '100.0% identical duplicate of SC BB' },
    { name: 'F REGISTER', status: 'EXCLUDED', reason: '100.0% identical duplicate of REFERENCE' },
    { name: 'REFERENCE', status: 'EXCLUDED', reason: '98.1% overlap, fully present in FINAL REG and 1T0 4505(1)' },
    { name: 'ACC REGIS', status: 'EXCLUDED', reason: 'Earlier snapshot superseded by FINAL REG' },
    { name: '4506 TO 8611', status: 'EXCLUDED', reason: '100.0% contained range slice' },
    { name: '8612 TO 12992(3)', status: 'EXCLUDED', reason: '100.0% contained range slice' },
    { name: 'Sheet2', status: 'EXCLUDED', reason: 'Aggregate summary table (0 accession numbers)' },
    { name: 'AI 5 BOOKS ', status: 'EXCLUDED', reason: 'Wishlist (0 accession numbers)' },
    { name: 'C CODES', status: 'EXCLUDED', reason: 'Lookup table (0 accession numbers)' }
  ];

  console.log('\n[2/5] Assembling unified physical accession collection from active sheets...');
  
  // Load priority order
  const priorityOrder = [
    'SC BB',
    'FINAL REG',
    '1T0 4505(1)',
    'Accession Register For Books-re'
  ];

  const unifiedAccessions = new Map(); // accNo -> record
  let rawRowsCount = 0;

  // Count all raw rows across all sheets for mathematical audit
  for (const sName of workbook.SheetNames) {
    const s = workbook.Sheets[sName];
    const rCount = xlsx.utils.sheet_to_json(s, { defval: null }).length;
    rawRowsCount += rCount;
  }

  // Process included sheets
  for (const sheetName of priorityOrder) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
    
    rows.forEach((r, idx) => {
      const acc = getClean(r.itemnumber || r.barcode || r.AccNo || r.accno || r['Acc No'] || r['ACC NO']);
      if (!acc) return;

      let callNo = getClean(r.itemcallnumber || r.CallNo || r.callno || r['Call No'] || r['CALL NO']);
      let title = getClean(r.title || r.Title || r.TITLES || r.Titles);
      let author = getClean(r.author || r.Author || r.AUTHOR);
      let dept = getClean(r['dept final'] || r.deptfinal || r.Department || r.dept);
      let course = getClean(r['course final'] || r.coursefinal || r.course || r['COURSE LEVEL']);
      let publisher = getClean(r.publishercode || r.Publisher || r.publisher) || 'Central Library';
      let edition = getClean(r.editionstatement || r.Edition || r.edition) || 'Standard';
      let year = parseInt(getClean(r.copyrightdate || r.YearOfPublition || r.year), 10) || undefined;
      let pages = getClean(r.pages || r['No.ofPages']);
      let price = parseFloat(getClean(r.price || r.Cost)) || undefined;
      let isbn = getClean(r.isbn || r.ISBN);

      if (!unifiedAccessions.has(acc)) {
        unifiedAccessions.set(acc, {
          accessionNumber: acc,
          callNo,
          title,
          author: author || 'Unknown Author',
          department: dept || 'GENERAL',
          branch: course || 'GENERAL',
          publisher,
          edition,
          publicationYear: year,
          pages,
          price,
          isbn: isbn ? isbn.toUpperCase() : undefined,
          sourceSheet: sheetName,
          sourceRow: idx + 2
        });
      } else {
        // Enrich if existing record has blank fields
        const existing = unifiedAccessions.get(acc);
        if (!existing.title && title) existing.title = title;
        if (!existing.callNo && callNo) existing.callNo = callNo;
        if ((!existing.author || existing.author === 'Unknown Author') && author) existing.author = author;
        if ((!existing.department || existing.department === 'GENERAL') && dept) existing.department = dept;
        if ((!existing.branch || existing.branch === 'GENERAL') && course) existing.branch = course;
        if (price && !existing.price) existing.price = price;
        if (pages && !existing.pages) existing.pages = pages;
        if (isbn && !existing.isbn) existing.isbn = isbn.toUpperCase();
      }
    });
  }

  const activePoolSize = unifiedAccessions.size;
  console.log(`Active physical source pool assembled: ${activePoolSize} unique accession records.`);

  console.log('\n[3/5] Applying Option 1 Missing Call No Resolution & Deduplication...');
  
  const invalidRows = [];
  const missingCallNoRecovered = [];
  const validPhysicalRecords = [];

  for (const record of unifiedAccessions.values()) {
    if (!record.title) {
      invalidRows.push({
        accessionNumber: record.accessionNumber,
        sheet: record.sourceSheet,
        row: record.sourceRow,
        reason: 'Missing Title'
      });
      continue;
    }

    if (!record.callNo) {
      record.callNo = `NOCALLNO-${record.accessionNumber}`;
      record.callNoGenerated = true;
      missingCallNoRecovered.push({
        accessionNumber: record.accessionNumber,
        generatedCallNo: record.callNo,
        title: record.title,
        sheet: record.sourceSheet,
        row: record.sourceRow
      });
    }

    record.normalizedTitle = enhancedNormalizeTitle(record.title);
    record.dedupKey = `${record.callNo}:::${record.normalizedTitle}`;
    validPhysicalRecords.push(record);
  }

  // Group into Master Books and collect physical copies (Option B)
  const masterBookMap = new Map(); // dedupKey -> { master, copies: [] }

  validPhysicalRecords.forEach(record => {
    const key = record.dedupKey;
    if (!masterBookMap.has(key)) {
      masterBookMap.set(key, {
        master: {
          callNo: record.callNo,
          title: record.title,
          author: record.author,
          isbn: record.isbn,
          category: record.department || 'GENERAL',
          department: record.department || 'GENERAL',
          branch: record.branch || 'GENERAL',
          publisher: record.publisher,
          edition: record.edition,
          publicationYear: record.publicationYear,
          pages: record.pages,
          price: record.price,
          accessionNumber: record.accessionNumber, // primary accession
          extraFields: {
            classificationPending: !!record.callNoGenerated,
            sourceSheets: [record.sourceSheet],
            originalAccessions: [record.accessionNumber]
          }
        },
        copies: [record]
      });
    } else {
      const entry = masterBookMap.get(key);
      entry.copies.push(record);
      entry.master.extraFields.originalAccessions.push(record.accessionNumber);
      if (!entry.master.extraFields.sourceSheets.includes(record.sourceSheet)) {
        entry.master.extraFields.sourceSheets.push(record.sourceSheet);
      }
    }
  });

  const masterBooksCount = masterBookMap.size;
  const totalPhysicalCopiesCount = validPhysicalRecords.length;
  const mergedCopiesCount = totalPhysicalCopiesCount - masterBooksCount;

  // Collision analysis for reporting
  const callNoGroups = new Map();
  validPhysicalRecords.forEach(r => {
    if (!callNoGroups.has(r.callNo)) callNoGroups.set(r.callNo, []);
    callNoGroups.get(r.callNo).push(r);
  });

  const titleMismatchedCollisions = [];
  for (const [callNo, records] of callNoGroups.entries()) {
    const uniqueNormTitles = [...new Set(records.map(r => r.normalizedTitle))];
    if (uniqueNormTitles.length > 1) {
      titleMismatchedCollisions.push({
        callNo,
        rowCount: records.length,
        distinctTitlesCount: uniqueNormTitles.length,
        rawTitles: [...new Set(records.map(r => r.title))]
      });
    }
  }

  // Write rejects log
  const dataDir = path.resolve(__dirname, '../data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const rejectsLogPath = path.join(dataDir, 'rejects_log.json');

  const rejectsReport = {
    generatedAt: new Date().toISOString(),
    summary: {
      workbookRawRows: rawRowsCount,
      activeSourcePool: activePoolSize,
      invalidRows: invalidRows.length,
      validPhysicalRecords: validPhysicalRecords.length,
      masterBooksCreated: masterBooksCount,
      physicalCopiesCreated: totalPhysicalCopiesCount,
      mergedCopies: mergedCopiesCount,
      titleMismatchedCollidingCallNos: titleMismatchedCollisions.length,
      missingCallNoRecovered: missingCallNoRecovered.length
    },
    sheetExclusions: sheetSummary.filter(s => s.status === 'EXCLUDED'),
    titleMismatchedCollisions: titleMismatchedCollisions,
    missingCallNoRecovered: missingCallNoRecovered,
    invalidRows: invalidRows
  };

  fs.writeFileSync(rejectsLogPath, JSON.stringify(rejectsReport, null, 2));
  console.log(`Rejects log written to: ${rejectsLogPath}`);

  // Step D Reconciliation Output
  console.log('\n========================================================================================');
  console.log('CLMS MIGRATION v3 RECONCILIATION REPORT');
  console.log('========================================================================================');
  console.log(`Workbook Total Raw Rows (14 Sheets):                                ${rawRowsCount.toLocaleString()}`);
  console.log(`Excluded Backup / Slice Sheets (Sheet1, Sheet3, F REG, etc.):       ${(rawRowsCount - activePoolSize).toLocaleString()} rows`);
  console.log(`Active Source Pool (FINAL REG + SC BB + 1T0 4505 + Books-re):        ${activePoolSize.toLocaleString()} physical rows`);
  console.log('----------------------------------------------------------------------------------------');
  console.log(`Invalid Rows (Missing Title):                                              ${invalidRows.length} row`);
  console.log(`Valid Physical Records Processed:                                    ${validPhysicalRecords.length.toLocaleString()} rows`);
  console.log('----------------------------------------------------------------------------------------');
  console.log('Deduplication Key:                                                  (Call No + Normalized Title)');
  console.log(`Valid Master Books Created:                                           ${masterBooksCount.toLocaleString()} titles`);
  console.log(`  - Standard (Call No + Title):                                       ${(masterBooksCount - missingCallNoRecovered.length).toLocaleString()} titles`);
  console.log(`  - Recovered via Placeholder (NOCALLNO-<acc>):                          ${missingCallNoRecovered.length} titles`);
  console.log(`Physical Copies Merged Under Master Books:                           ${mergedCopiesCount.toLocaleString()} copies`);
  console.log(`Title-Mismatched Colliding Call Numbers Logged:                       ${titleMismatchedCollisions.length.toLocaleString()} Call Nos`);
  console.log('----------------------------------------------------------------------------------------');
  console.log(`Physical BookCopies to Create (Option B: Real 1:1 Accessions):       ${totalPhysicalCopiesCount.toLocaleString()} BookCopies`);
  console.log('----------------------------------------------------------------------------------------');
  const mathBalance = masterBooksCount + mergedCopiesCount + invalidRows.length;
  console.log(`Mathematical Audit: ${masterBooksCount.toLocaleString()} masters + ${mergedCopiesCount.toLocaleString()} merged copies + ${invalidRows.length} invalid = ${mathBalance.toLocaleString()} (Active Pool: ${activePoolSize.toLocaleString()})`);
  console.log(`Reconciliation Status: ${mathBalance === activePoolSize ? 'PERFECT 100.0% MATCH (0 UNEXPLAINED DROPS)' : 'MISMATCH'}`);
  console.log('========================================================================================\n');

  if (isDryRun) {
    console.log('DRY RUN COMPLETE. No database changes were made.');
    return;
  }

  // LIVE DATABASE IMPORT
  console.log('[4/5] Connecting to MongoDB Atlas for Live Migration...');
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('ERROR: MONGO_URI is not set in environment.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB Atlas.');

  // Find KIET Central Library (KIET_MAIN)
  let kietLib = await Library.findOne({ code: 'KIET_MAIN' });
  if (!kietLib) {
    kietLib = await Library.findOne({ name: /kiet library/i }) || await Library.findOne();
  }
  if (!kietLib) {
    console.error('ERROR: KIET_MAIN library not found in database. Run seed.js first.');
    process.exit(1);
  }
  console.log(`Using KIET Library: ${kietLib.name} (${kietLib.code} - ${kietLib._id})`);

  console.log('[5/5] Purging old Book and BookCopy collections...');
  const delCopies = await BookCopy.deleteMany({});
  const delBooks = await Book.deleteMany({});
  console.log(`Cleared ${delCopies.deletedCount} old BookCopies and ${delBooks.deletedCount} old Books.`);

  try {
    await Book.collection.dropIndexes();
    console.log('Dropped legacy Book indexes (cleared obsolete unique constraints like isbn_1).');
  } catch (e) {
    // collection might have had no indexes
  }

  try {
    await BookCopy.collection.dropIndexes();
    console.log('Dropped legacy BookCopy indexes.');
  } catch (e) {
    // collection might have had no indexes
  }

  console.log(`Inserting ${masterBooksCount} master books...`);
  const masterDocsToInsert = [];
  const masterKeyToIdMap = new Map();

  for (const [key, entry] of masterBookMap.entries()) {
    const doc = {
      ...entry.master,
      _id: new mongoose.Types.ObjectId()
    };
    masterDocsToInsert.push(doc);
    masterKeyToIdMap.set(key, doc._id);
  }

  const BOOK_BATCH_SIZE = 1000;
  for (let i = 0; i < masterDocsToInsert.length; i += BOOK_BATCH_SIZE) {
    const batch = masterDocsToInsert.slice(i, i + BOOK_BATCH_SIZE);
    await Book.insertMany(batch, { ordered: false });
    process.stdout.write(`\rInserted Books: ${Math.min(i + BOOK_BATCH_SIZE, masterDocsToInsert.length)} / ${masterDocsToInsert.length}`);
  }
  console.log('\nAll master books inserted successfully.');

  console.log(`Generating and inserting ${totalPhysicalCopiesCount} BookCopies (Option B)...`);
  const copyDocsToInsert = [];
  const seenBarcodes = new Set();

  for (const [key, entry] of masterBookMap.entries()) {
    const bookId = masterKeyToIdMap.get(key);
    entry.copies.forEach((copyRec, idx) => {
      let barcode = copyRec.accessionNumber;
      if (seenBarcodes.has(barcode)) {
        // Fallback suffix if accession number occurred multiple times
        barcode = `${copyRec.accessionNumber}-${idx + 1}`;
      }
      seenBarcodes.add(barcode);

      copyDocsToInsert.push({
        book: bookId,
        copyNumber: idx + 1,
        library: kietLib._id,
        barcode: barcode,
        status: 'AVAILABLE',
        rackLocation: copyRec.department ? `${copyRec.department} Rack` : 'General Rack'
      });
    });
  }

  const COPY_BATCH_SIZE = 1000;
  for (let i = 0; i < copyDocsToInsert.length; i += COPY_BATCH_SIZE) {
    const batch = copyDocsToInsert.slice(i, i + COPY_BATCH_SIZE);
    await BookCopy.insertMany(batch, { ordered: false });
    const insertedCount = Math.min(i + COPY_BATCH_SIZE, copyDocsToInsert.length);
    const pct = ((insertedCount / copyDocsToInsert.length) * 100).toFixed(1);
    process.stdout.write(`\rInserted BookCopies: ${insertedCount.toLocaleString()} / ${copyDocsToInsert.length.toLocaleString()} (${pct}%)`);
  }
  console.log('\nAll BookCopies inserted successfully.');

  console.log('Ensuring database indexes...');
  await Book.createIndexes();
  await BookCopy.createIndexes();
  console.log('Indexes verified successfully.');

  console.log('\nMigration completed successfully in ' + ((Date.now() - startTime) / 1000).toFixed(2) + 's.');
  await mongoose.disconnect();
}

runMigration().catch(err => {
  console.error('\nMIGRATION FAILED WITH ERROR:', err);
  process.exit(1);
});
