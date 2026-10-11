const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const VisitLog = require('../models/visitLog.model');
const Library = require('../models/library.model');
const StudentProfile = require('../models/studentProfile.model');

function request(method, pathName, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const options = {
      hostname: '127.0.0.1',
      port: 5000,
      path: pathName,
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
  console.log('   TESTING ENTRANCE DASHBOARD UX & API FIXES');
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

  const rollNumber = '23B21A4268';
  const libraryCode = 'KIET_MAIN';

  try {
    // 0. Clean up any active visit for test student
    const student = await StudentProfile.findOne({ rollNumber });
    const library = await Library.findOne({ code: libraryCode });

    assert(student !== null, `0a. Found test student profile: ${student?.name} (${rollNumber})`);
    assert(library !== null, `0b. Found target library: ${library?.name} (${libraryCode})`);

    await VisitLog.updateMany(
      { rollNumber, checkoutTime: null },
      { $set: { checkoutTime: new Date() } }
    );

    // Initial occupancy check
    const initialSeatsRes = await request('GET', `/api/v1/libraries/${libraryCode}/status`);
    const initialActive = initialSeatsRes.body?.data?.activeVisits ?? 0;
    console.log(`  ℹ️ Initial active occupancy: ${initialActive} / ${library.capacity}`);

    // TEST 1: Check-IN of valid student ID
    console.log('\n--- TEST 1: Scan valid ID (Check-IN) ---');
    const inRes = await request('POST', '/api/v1/library-entrance/verify', {
      candidates: [rollNumber],
      libraryId: libraryCode
    });

    assert(inRes.status === 200, 'TEST 1a: Status 200 OK on Check-IN', inRes.body);
    assert(inRes.body?.data?.action === 'IN', 'TEST 1b: Result action is "IN"');
    assert(inRes.body?.data?.userId === rollNumber, 'TEST 1c: Roll number matches 23B21A4268');
    assert(inRes.body?.data?.userName !== undefined, `TEST 1d: Student name returned: "${inRes.body?.data?.userName}"`);
    assert(inRes.body?.data?.libraryName !== undefined, `TEST 1e: Library name returned: "${inRes.body?.data?.libraryName}"`);
    assert(inRes.body?.data?.timestamp !== undefined, 'TEST 1f: Timestamp is present');

    // TEST 2: Check Occupancy Update
    console.log('\n--- TEST 2: Check Occupancy increments ---');
    const afterInSeats = await request('GET', `/api/v1/libraries/${libraryCode}/status`);
    const afterInActive = afterInSeats.body?.data?.activeVisits ?? 0;
    assert(afterInActive === initialActive + 1, `TEST 2: Occupancy incremented: ${initialActive} -> ${afterInActive}`);

    // TEST 3: Check Recent Gate Activity has new IN at top
    console.log('\n--- TEST 3: Check Recent Gate Activity (New IN at top) ---');
    const recentRes1 = await request('GET', `/api/v1/entry-exit/recent/${libraryCode}?limit=20`);
    assert(recentRes1.status === 200, 'TEST 3a: Recent activity API returns 200 OK');
    const events1 = recentRes1.body?.data || [];
    assert(events1.length > 0, `TEST 3b: Found ${events1.length} recent activity records`);
    assert(events1[0]?.action === 'IN' && events1[0]?.userId === rollNumber, 'TEST 3c: Newest record at index 0 is the IN scan for 23B21A4268');

    // TEST 4: Immediate second scan before 60 seconds (60-second rule)
    console.log('\n--- TEST 4: Immediate second scan before 60s (NO OUT) ---');
    const immediateRes = await request('POST', '/api/v1/library-entrance/verify', {
      candidates: [rollNumber],
      libraryId: libraryCode
    });

    assert(immediateRes.status === 400, 'TEST 4a: Status 400 BAD REQUEST on scan before 60 seconds');
    assert(immediateRes.body?.code === 'MINIMUM_VISIT_DURATION', 'TEST 4b: code is MINIMUM_VISIT_DURATION');
    assert(immediateRes.body?.message?.includes('1 minute') || immediateRes.body?.message?.includes('minute'), `TEST 4c: Message: "${immediateRes.body?.message}"`);
    const remainingSeconds = immediateRes.body?.data?.remainingSeconds || immediateRes.body?.errorDetails?.remainingSeconds;
    assert(remainingSeconds > 0, `TEST 4d: Remaining seconds returned: ${remainingSeconds}s`);

    // TEST 5: Unregistered Roll Number
    console.log('\n--- TEST 5: Unregistered Roll Number (USER NOT FOUND) ---');
    const unknownRes = await request('POST', '/api/v1/library-entrance/verify', {
      candidates: ['99ZZ999999'],
      libraryId: libraryCode
    });

    assert(unknownRes.status === 404, 'TEST 5a: Unregistered roll number returns 404 Not Found');
    assert(unknownRes.body?.message?.includes('USER NOT FOUND'), 'TEST 5b: Message indicates USER NOT FOUND');

    // TEST 6: Check-OUT after 60 seconds
    console.log('\n--- TEST 6: Check-OUT after 60s elapsed ---');
    // Fast-forward checkInTime by 65 seconds in database
    await VisitLog.updateOne(
      { rollNumber, checkoutTime: null },
      { $set: { checkInTime: new Date(Date.now() - 65 * 1000) } }
    );

    const outRes = await request('POST', '/api/v1/library-entrance/verify', {
      candidates: [rollNumber],
      libraryId: libraryCode
    });

    assert(outRes.status === 200, 'TEST 6a: Status 200 OK on Check-OUT');
    assert(outRes.body?.data?.action === 'OUT', 'TEST 6b: Result action is "OUT"');
    assert(outRes.body?.data?.userId === rollNumber, 'TEST 6c: Roll number matches 23B21A4268');
    assert(outRes.body?.data?.checkoutTime !== null, 'TEST 6d: checkoutTime recorded');

    // TEST 7: Check Occupancy decrements back
    console.log('\n--- TEST 7: Check Occupancy decrements back ---');
    const afterOutSeats = await request('GET', `/api/v1/libraries/seats/${libraryCode}`);
    const afterOutActive = afterOutSeats.body?.data?.activeVisits ?? 0;
    assert(afterOutActive === initialActive, `TEST 7: Occupancy decremented: ${afterInActive} -> ${afterOutActive}`);

    // TEST 8: Check Recent Gate Activity has OUT at top (and previous IN below it)
    console.log('\n--- TEST 8: Recent Gate Activity chronological events ---');
    const recentRes2 = await request('GET', `/api/v1/entry-exit/recent/${libraryCode}?limit=20`);
    const events2 = recentRes2.body?.data || [];
    assert(events2[0]?.action === 'OUT' && events2[0]?.userId === rollNumber, 'TEST 8a: Top event is now OUT for 23B21A4268');
    const matchingInEvent = events2.find(e => e.action === 'IN' && e.userId === rollNumber);
    assert(matchingInEvent !== undefined, 'TEST 8b: IN event for 23B21A4268 is preserved alongside OUT (separate chronological events, not deduplicated)');

    // TEST 9: Recent Gate Activity row capacity
    console.log('\n--- TEST 9: Recent Gate Activity Capacity ---');
    assert(events2.length >= 2, `TEST 9: Activity records returned (${events2.length} events) with up to 20 supported`);

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await mongoose.disconnect();
  }

  console.log('\n========================================================================');
  console.log(`   VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
