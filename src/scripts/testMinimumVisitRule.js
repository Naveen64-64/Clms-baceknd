const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const VisitLog = require('../models/visitLog.model');

function request(method, reqPath, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const options = {
      hostname: '127.0.0.1',
      port: 5000,
      path: reqPath,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('========================================================================');
  console.log('   TESTING 60-SECOND MINIMUM IN -> OUT VISIT GAP RULE');
  console.log('========================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);

  let passed = 0;
  let failed = 0;

  function assert(condition, desc, extra = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${desc} ${extra ? `(${JSON.stringify(extra)})` : ''}`);
      failed++;
    }
  }

  const rollA = '23B21A4268';
  const rollB = '23B21A4595';

  try {
    // Clean up any lingering active visits for test roll numbers
    await VisitLog.updateMany(
      { rollNumber: { $in: [rollA, rollB] }, checkoutTime: null },
      { $set: { checkoutTime: new Date() } }
    );

    // 1. Student A Check-IN
    const inA = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: rollA,
      libraryId: 'KIET_MAIN'
    });
    assert(
      inA.status === 200 && inA.body.data?.action === 'IN',
      '1. Student A Check-IN succeeds with status IN',
      inA.body
    );

    // 2. Student A Immediate Second Scan (< 60s) -> MUST FAIL with MINIMUM_VISIT_DURATION
    const outImmediateA = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: rollA,
      libraryId: 'KIET_MAIN'
    });
    assert(
      outImmediateA.status === 400 &&
      outImmediateA.body.code === 'MINIMUM_VISIT_DURATION' &&
      typeof outImmediateA.body.remainingSeconds === 'number' &&
      outImmediateA.body.remainingSeconds > 0,
      `2. Student A immediate scan rejected (code: MINIMUM_VISIT_DURATION, remaining: ${outImmediateA.body.remainingSeconds}s)`,
      outImmediateA.body
    );

    // Verify no OUT record created in database for Student A
    const activeVisitA = await VisitLog.findOne({ rollNumber: rollA, checkoutTime: null });
    assert(
      activeVisitA !== null && activeVisitA.checkoutTime === null,
      '3. Student A active VisitLog remains intact in DB (checkoutTime is still null)'
    );

    // 4. Student B Scans (Different User at 10 seconds later) -> MUST BE ALLOWED NORMALLY
    const inB = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: rollB,
      libraryId: 'KIET_MAIN'
    });
    assert(
      inB.status === 200 && inB.body.data?.action === 'IN',
      '4. Student B Check-IN succeeds normally (Student A cooldown does NOT block Student B)',
      inB.body
    );

    // 5. Student B immediate scan -> MUST ALSO FAIL with MINIMUM_VISIT_DURATION for Student B
    const outImmediateB = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: rollB,
      libraryId: 'KIET_MAIN'
    });
    assert(
      outImmediateB.status === 400 &&
      outImmediateB.body.code === 'MINIMUM_VISIT_DURATION',
      '5. Student B immediate scan rejected with MINIMUM_VISIT_DURATION',
      outImmediateB.body
    );

    // 6. Simulate 65 seconds elapsed for Student A by updating checkInTime in DB
    const sixtyFiveSecAgo = new Date(Date.now() - 65 * 1000);
    await VisitLog.updateOne(
      { _id: activeVisitA._id },
      { $set: { checkInTime: sixtyFiveSecAgo } }
    );

    // 7. Student A Scans Again (>= 60s elapsed) -> MUST NOW SUCCEED with OUT
    const outValidA = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: rollA,
      libraryId: 'KIET_MAIN'
    });
    assert(
      outValidA.status === 200 && outValidA.body.data?.action === 'OUT',
      '6. Student A scan after 60s successfully checks OUT',
      outValidA.body
    );

    // Verify Student A visit is completed in DB
    const completedVisitA = await VisitLog.findById(activeVisitA._id);
    assert(
      completedVisitA.checkoutTime !== null,
      '7. Student A VisitLog is marked completed with valid checkoutTime in DB'
    );

    // Clean up Student B
    await VisitLog.updateOne(
      { rollNumber: rollB, checkoutTime: null },
      { $set: { checkoutTime: new Date() } }
    );

    console.log('\n========================================================================');
    console.log(`   60-SECOND RULE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

    await mongoose.disconnect();
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('Test execution failed:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTests();
