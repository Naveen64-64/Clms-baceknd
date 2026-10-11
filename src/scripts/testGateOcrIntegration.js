const http = require('http');

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const options = {
      hostname: '127.0.0.1',
      port: 5000,
      path: path,
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

async function run() {
  console.log('========================================================================');
  console.log('   TESTING OCR ENTRANCE VERIFICATION & VISITLOG INTEGRATION');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, desc) {
    if (condition) {
      console.log(`  ✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${desc}`);
      failed++;
    }
  }

  try {
    // 1. Check health
    const health = await request('GET', '/health');
    assert(health.status === 200 && health.body.data.dbConnected === true, '1. Health check returns 200 UP and dbConnected=true');

    // 2. Direct Roll Number Check-IN
    const roll1 = '23B21A4268';
    const inRes = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: roll1,
      libraryId: 'KIET_MAIN'
    });
    assert(
      inRes.status === 200 && inRes.body.data.action === 'IN' && inRes.body.data.userId === roll1,
      `2. Direct roll number (${roll1}) Check-IN records status IN`
    );

    // 3. Cross-library check-in conflict (student is inside KIET_MAIN, attempts entry at KIET_2)
    const conflictRes = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: roll1,
      libraryId: 'KIET_2'
    });
    assert(
      conflictRes.status === 409 && conflictRes.body.code === 'ALREADY_INSIDE_OTHER_LIBRARY',
      '3. Cross-library check-in blocked with 409 ALREADY_INSIDE_OTHER_LIBRARY'
    );

    // 4. Direct Roll Number Immediate Scan of same student (< 60s) -> must be blocked with MINIMUM_VISIT_DURATION
    const outRes = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: roll1,
      libraryId: 'KIET_MAIN'
    });
    assert(
      outRes.status === 400 && outRes.body.code === 'MINIMUM_VISIT_DURATION',
      `4. Immediate scan of same student (${roll1}) blocked with 400 MINIMUM_VISIT_DURATION`
    );

    // 5. Candidate list resolution (OCR candidate array with noise) - Student B enters normally!
    const candRes = await request('POST', '/api/v1/library-entrance/verify', {
      candidates: ['INVALID_NOISE', '9999999999', '23B21A4595'],
      libraryId: 'KIET_MAIN'
    });
    assert(
      candRes.status === 200 && candRes.body.data.userId === '23B21A4595' && candRes.body.data.action === 'IN',
      '5. Candidate array resolution correctly skips noise and matches valid registered student'
    );

    // 6. Connect to DB to simulate > 60s elapsed for roll1 and 23B21A4595
    const mongoose = require('mongoose');
    const path = require('path');
    require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
    const VisitLog = require('../models/visitLog.model');
    await mongoose.connect(process.env.MONGODB_URI);

    const pastTime = new Date(Date.now() - 70000);
    await VisitLog.updateMany({ rollNumber: { $in: [roll1, '23B21A4595'] }, checkoutTime: null }, { $set: { checkInTime: pastTime } });

    // 7. Check out roll1 after 60s
    const outResAfter60 = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: roll1,
      libraryId: 'KIET_MAIN'
    });
    assert(
      outResAfter60.status === 200 && outResAfter60.body.data.action === 'OUT',
      `6. Check-OUT of ${roll1} succeeds after 60 seconds elapsed`
    );

    // 8. Check out 23B21A4595 after 60s
    const candOut = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: '23B21A4595',
      libraryId: 'KIET_MAIN'
    });
    assert(candOut.status === 200 && candOut.body.data.action === 'OUT', '7. Candidate student check-OUT succeeds after 60s');

    // 9. Gender Restriction Enforcement: Male student entering Women's Library
    const genderBlock = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: '23B21A4595',
      libraryId: 'KIET_WOMEN'
    });
    assert(
      genderBlock.status === 403,
      "8. Male student blocked with 403 from KIET Women's Library"
    );

    await mongoose.disconnect();

    // 8. Unknown Roll Number
    const unknownRes = await request('POST', '/api/v1/library-entrance/verify', {
      rollNumber: '99ZZ9Z9999',
      libraryId: 'KIET_MAIN'
    });
    assert(unknownRes.status === 404, '8. Unregistered roll number returns 404 User Not Found');

    console.log('\n========================================================================');
    console.log(`   OCR GATE INTEGRATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  }
}

run();
