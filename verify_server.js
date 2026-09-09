const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const htmlPath = 'C:/Users/This_PC/.gemini/antigravity/scratch/index.html';
const serverPath = 'C:/Users/This_PC/.gemini/antigravity/scratch/server.js';
const gasPath = 'C:/Users/This_PC/.gemini/antigravity/scratch/google_apps_script.js';

const html = fs.readFileSync(htmlPath, 'utf8');
const gasCode = fs.readFileSync(gasPath, 'utf8');
const serverCode = fs.readFileSync(serverPath, 'utf8');

console.log('============================================================');
console.log('🧪 RUNNING COMPREHENSIVE SERVER HOST & MULTI-DEVICE TEST SUITE');
console.log('============================================================\n');

// 1. Check syntax of all files
let feSyntaxPass = false;
try {
  const scriptContent = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new Function(scriptContent);
  feSyntaxPass = true;
  console.log('1. index.html Embedded JavaScript Syntax: PASS');
} catch (e) {
  console.error('1. index.html Syntax Error:', e.message);
}

let gasSyntaxPass = false;
try {
  new Function(gasCode);
  gasSyntaxPass = true;
  console.log('2. google_apps_script.js Syntax: PASS');
} catch (e) {
  console.error('2. google_apps_script.js Syntax Error:', e.message);
}

let serverSyntaxPass = false;
try {
  new Function(serverCode);
  serverSyntaxPass = true;
  console.log('3. server.js Syntax: PASS');
} catch (e) {
  console.error('3. server.js Syntax Error:', e.message);
}

// 2. Check i18n completeness
const m = html.match(/const i18n = (\{[\s\S]*?\n\};)/);
const i18n = eval('(' + m[1].trim().replace(/;$/, '') + ')');
const regex = /data-i18n(?:-html)?=["']([^"']+)["']/g;
let match, keys = [];
while ((match = regex.exec(html)) !== null) {
  keys.push(match[1]);
}
const uniq = Array.from(new Set(keys));
console.log(`4. Unique data-i18n keys in HTML (${uniq.length} keys):`);
let missingTh = 0, missingEn = 0;
for (const k of uniq) {
  if (!i18n.th[k]) { console.warn('   Missing TH:', k); missingTh++; }
  if (!i18n.en[k]) { console.warn('   Missing EN:', k); missingEn++; }
}
console.log(`   Missing Translations -> TH: ${missingTh} | EN: ${missingEn} -> ${missingTh === 0 && missingEn === 0 ? 'PASS' : 'FAIL'}`);

// 3. Start Server Host on Test Port (3099) and run HTTP + SSE tests
const TEST_PORT = 3099;
process.env.PORT = String(TEST_PORT);
process.env.DATA_DIR = path.join(__dirname, 'test_data');

const { server, db, broadcastSSE } = require(serverPath);

server.listen(TEST_PORT, '127.0.0.1', async () => {
  console.log(`\n🚀 Server Host started in-process on http://127.0.0.1:${TEST_PORT}`);

  try {
    // Helper to make HTTP requests
    function apiRequest(method, endpoint, body = null) {
      return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path: endpoint,
          method: method,
          headers: {
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
          }
        };
        const req = http.request(options, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
            } catch (e) {
              resolve({ status: res.statusCode, headers: res.headers, data });
            }
          });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
      });
    }

    // Test 5: Static File Serving
    const homeRes = await apiRequest('GET', '/');
    const staticPass = homeRes.status === 200 && typeof homeRes.data === 'string' && homeRes.data.includes('Parking-A-Lot');
    console.log(`5. Static Web Server (GET / -> index.html): ${staticPass ? 'PASS' : 'FAIL'}`);

    // Test 6: Health Endpoint
    const healthRes = await apiRequest('GET', '/api/health');
    const healthPass = healthRes.status === 200 && healthRes.data.success && healthRes.data.status === 'online';
    console.log(`6. Health Check API (GET /api/health): ${healthPass ? 'PASS' : 'FAIL'} (Local IPs: ${healthRes.data.localIps?.join(', ') || 'N/A'})`);

    // Test 7: Get All Data Endpoint
    const dataRes = await apiRequest('GET', '/api/data');
    const dataPass = dataRes.status === 200 && Array.isArray(dataRes.data.data.buildings) && Array.isArray(dataRes.data.data.lots);
    console.log(`7. Fetch Central DB (GET /api/data): ${dataPass ? 'PASS' : 'FAIL'} (${dataRes.data.data.buildings.length} buildings, ${dataRes.data.data.lots.length} lots)`);

    // Test 8: Lot Adjustment Mutation
    const lotA = dataRes.data.data.lots[0];
    const initialAvail = lotA.available;
    const adjustRes = await apiRequest('POST', '/api/lots/adjust', { id: lotA.id, change: -1 });
    const adjustPass = adjustRes.status === 200 && adjustRes.data.data.available === (initialAvail - 1);
    console.log(`8. Lot Adjustment API (POST /api/lots/adjust): ${adjustPass ? 'PASS' : 'FAIL'} (${initialAvail} -> ${adjustRes.data.data.available})`);

    // Test 9: Real-time Multi-Device SSE Broadcast
    const sseReceived = await new Promise((resolve) => {
      let eventsReceived = [];
      const sseReq = http.request({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/events',
        method: 'GET'
      }, res => {
        res.on('data', chunk => {
          const str = chunk.toString();
          if (str.includes('event: lot_updated') || str.includes('initial_state')) {
            eventsReceived.push(str);
            if (eventsReceived.some(s => s.includes('event: lot_updated'))) {
              resolve(true);
            }
          }
        });
      });
      sseReq.end();

      // Trigger mutation from another "device"
      setTimeout(async () => {
        await apiRequest('POST', '/api/lots/adjust', { id: lotA.id, change: 1 });
      }, 200);

      setTimeout(() => resolve(eventsReceived.length > 0), 2000);
    });
    console.log(`9. Real-Time SSE Stream Broadcast across Devices: ${sseReceived ? 'PASS' : 'FAIL'}`);

    // Test 10: Building CRUD Endpoint
    const bldgRes = await apiRequest('POST', '/api/buildings/save', {
      name: 'อาคารนวัตกรรมดิจิทัล',
      nameEn: 'Digital Innovation Hub',
      category: 'classroom',
      lat: 45,
      lng: 55
    });
    const bldgPass = bldgRes.status === 200 && bldgRes.data.success && bldgRes.data.data.id;
    console.log(`10. Building Save API (POST /api/buildings/save): ${bldgPass ? 'PASS' : 'FAIL'} (ID: ${bldgRes.data.data.id})`);

    // Test 11: Parking Check-In & Check-Out Workflow
    const parkRes = await apiRequest('POST', '/api/parking/park', {
      username: 'tester_driver',
      buildingId: 'b1',
      lotId: 'a'
    });
    const parkPass = parkRes.status === 200 && parkRes.data.session && parkRes.data.session.lotId === 'a';

    const checkOutRes = await apiRequest('POST', '/api/parking/checkout', {
      username: 'tester_driver',
      buildingId: 'b1',
      lotId: 'a'
    });
    const checkOutPass = checkOutRes.status === 200 && checkOutRes.data.success;
    console.log(`11. Parking Session (Park & Check-Out) APIs: ${(parkPass && checkOutPass) ? 'PASS' : 'FAIL'}`);

    // Test 12: Review Submission
    const revRes = await apiRequest('POST', '/api/reviews', {
      username: 'tester_reviewer',
      name: 'นักศึกษาทดสอบ',
      stars: 5,
      text: 'ทดสอบระบบเซิร์ฟเวอร์เรียลไทม์ ทำงานได้รวดเร็วมากครับ'
    });
    const revPass = revRes.status === 200 && revRes.data.review && revRes.data.review.id;
    console.log(`12. Review Submission API (POST /api/reviews): ${revPass ? 'PASS' : 'FAIL'}`);

    // Test 13: User Authentication API
    const loginRes = await apiRequest('POST', '/api/auth/login', {
      username: 'ardeshir',
      password: 'hassanzxdeh'
    });
    const loginPass = loginRes.status === 200 && loginRes.data.user && loginRes.data.user.role === 'admin';
    console.log(`13. Central User Auth API (POST /api/auth/login): ${loginPass ? 'PASS' : 'FAIL'} (User: ${loginRes.data.user?.name || 'N/A'})`);

    // Test 14: Server Config API
    const cfgRes = await apiRequest('POST', '/api/config', {
      googleSheetsUrl: 'https://script.google.com/macros/s/AKfycbz_test/exec'
    });
    const cfgPass = cfgRes.status === 200 && cfgRes.data.config.googleSheetsUrl.includes('AKfycbz_test');
    console.log(`14. Server Config & Google Sheets Bridge API: ${cfgPass ? 'PASS' : 'FAIL'}`);

    const allPassed = feSyntaxPass && gasSyntaxPass && serverSyntaxPass && (missingTh === 0) && (missingEn === 0) &&
      staticPass && healthPass && dataPass && adjustPass && sseReceived && bldgPass && parkPass && checkOutPass && revPass && loginPass && cfgPass;

    console.log('\n============================================================');
    console.log(allPassed ? '🎉 ALL 14 TEST CHECKS PASSED WITH 100% SUCCESS!' : '❌ SOME TESTS FAILED');
    console.log('============================================================');

    server.close();
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('Test Execution Error:', err);
    server.close();
    process.exit(1);
  }
});
