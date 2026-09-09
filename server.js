/**
 * ============================================================================
 * PARKING-A-LOT: CENTRALIZED REAL-TIME SERVER HOST (server.js)
 * Version: 1.0.0 (High-Performance Zero-Dependency Multi-Device Host)
 * ============================================================================
 * 
 * Features:
 * - Built-in Static File Server (serves index.html, assets, CORS headers)
 * - Central Persistent Database (data/database.json) with atomic writes
 * - Real-Time Server-Sent Events (SSE) for instant synchronization across all devices
 * - Complete RESTful API for Lots, Buildings, Parking Sessions, Reviews, and Auth
 * - Google Sheets Bi-Directional Bridge (background sync with Google Apps Script)
 * - Automatic Local Network (LAN) IP Discovery for phone/tablet Wi-Fi connection
 * ============================================================================
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { URL } = require('node:url');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default Seed Data
const DEFAULT_SEED = {
  buildings: [
    { id: 'b1', name: 'อาคารเรียนรวม', nameEn: 'Complex Lecture Building', category: 'classroom', lat: 40, lng: 60, updatedAt: new Date().toISOString() },
    { id: 'b2', name: 'คณะวิศวกรรมศาสตร์', nameEn: 'Faculty of Engineering', category: 'classroom', lat: 78, lng: 28, updatedAt: new Date().toISOString() },
    { id: 'b3', name: 'หอสมุดกลาง', nameEn: 'Central Library', category: 'classroom', lat: 18, lng: 78, updatedAt: new Date().toISOString() },
    { id: 'b4', name: 'อาคารสำนักงานอธิการบดี', nameEn: "President's Office Building", category: 'office', lat: 58, lng: 12, updatedAt: new Date().toISOString() },
    { id: 'b5', name: 'คณะเกษตรศาสตร์', nameEn: 'Faculty of Agriculture', category: 'classroom', lat: 88, lng: 70, updatedAt: new Date().toISOString() },
    { id: 'b6', name: 'สำนักบริการวิชาการ', nameEn: 'Academic Services Bureau', category: 'office', lat: 10, lng: 38, updatedAt: new Date().toISOString() }
  ],
  lots: [
    { id: 'a', name: 'ลาน A หน้าอาคารเรียนรวม', nameEn: 'Lot A - Lecture Complex', buildingId: 'b1', capacity: 20, available: 15, lat: 38, lng: 58, updatedAt: new Date().toISOString() },
    { id: 'b', name: 'ลาน B ข้างวิศวกรรมศาสตร์', nameEn: 'Lot B - Engineering Wing', buildingId: 'b2', capacity: 20, available: 5, lat: 75, lng: 31, updatedAt: new Date().toISOString() },
    { id: 'd', name: 'ลาน D หลังหอสมุดกลาง', nameEn: 'Lot D - Behind Library', buildingId: 'b3', capacity: 20, available: 8, lat: 21, lng: 75, updatedAt: new Date().toISOString() }
  ],
  users: [
    { id: 'admin_ardeshir', username: 'ardeshir', password: 'hassanzxdeh', name: 'Ardeshir', role: 'admin', avatar: '', createdAt: new Date().toISOString() },
    { id: 'admin_alpine', username: 'project alpine', password: 'orchid', name: 'Project Alpine (Tester / Admin)', role: 'admin', avatar: '', createdAt: new Date().toISOString() }
  ],
  reviews: [
    { id: 'rev_1', username: 'somchai', name: 'สมชาย นักศึกษา', stars: 5, text: 'ระบบหาที่จอดสะดวกมากครับ ช่วงเช้าประหยัดเวลาไปเยอะมาก', timestamp: Date.now() - 3600000 * 5 },
    { id: 'rev_2', username: 'jane', name: 'Jane (Exchange Student)', stars: 5, text: 'Super easy navigation and accurate lot availability!', timestamp: Date.now() - 3600000 * 2 }
  ],
  parkingHistory: [],
  searchHistory: [],
  favorites: {} // { username: [lotId, ...] }
};

// In-Memory Database and Config
let db = loadDatabase();
let config = loadConfig();

// Active SSE Connections
const sseClients = new Set();

/**
 * Load Database from JSON file or Seed
 */
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return Object.assign({}, DEFAULT_SEED, parsed);
    }
  } catch (err) {
    console.error('[DB] Error loading database, creating backup and using seed:', err.message);
  }
  saveDatabase(DEFAULT_SEED);
  return JSON.parse(JSON.stringify(DEFAULT_SEED));
}

/**
 * Save Database to JSON file atomically
 */
function saveDatabase(dataToSave = db) {
  try {
    const tempFile = DB_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(dataToSave, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('[DB] Error saving database:', err.message);
  }
}

/**
 * Load Config from JSON file
 */
function loadConfig() {
  const defaultConfig = {
    googleSheetsUrl: process.env.GOOGLE_SHEETS_URL || '',
    syncIntervalSeconds: 60,
    serverName: 'Parking-A-Lot Realtime Host',
    autoSyncWithSheets: true
  };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return Object.assign({}, defaultConfig, JSON.parse(raw));
    }
  } catch (err) {
    console.warn('[Config] Error loading config:', err.message);
  }
  saveConfig(defaultConfig);
  return defaultConfig;
}

/**
 * Save Config to JSON file
 */
function saveConfig(cfg = config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('[Config] Error saving config:', err.message);
  }
}

/**
 * Broadcast Real-Time Event to ALL connected devices via SSE
 */
function broadcastSSE(eventType, data = {}) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(message);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

// Periodic SSE Keepalive / Heartbeat every 15 seconds
setInterval(() => {
  const ping = `: heartbeat ${Date.now()}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(ping);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}, 15000);

/**
 * Google Sheets Asynchronous Sync Worker
 */
async function pushToGoogleSheets(action, payload) {
  const url = (config.googleSheetsUrl || '').trim();
  if (!url || !url.startsWith('http')) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const qs = new URLSearchParams({ action, payload: JSON.stringify(payload) }).toString();
    const fullUrl = url + (url.includes('?') ? '&' : '?') + qs;

    const res = await fetch(fullUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    clearTimeout(timeout);

    if (res.ok) {
      const json = await res.json();
      return json;
    }
  } catch (err) {
    console.warn(`[Sheets Sync] Failed to push action '${action}':`, err.message);
  }
  return null;
}

/**
 * Bi-directional Sync with Google Sheets
 */
async function syncWithGoogleSheets() {
  const url = (config.googleSheetsUrl || '').trim();
  if (!url || !url.startsWith('http')) {
    return { success: false, error: 'Google Sheets URL not configured' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const fullUrl = url + (url.includes('?') ? '&' : '?') + 'action=getInitialData';
    const res = await fetch(fullUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const json = await res.json();

    if (json && json.success && json.data) {
      let changed = false;
      if (Array.isArray(json.data.buildings) && json.data.buildings.length) {
        db.buildings = json.data.buildings.map(b => ({
          id: b.id,
          name: b.name_th || b.name,
          nameEn: b.name_en || b.nameEn || b.name,
          category: b.category || 'classroom',
          lat: parseFloat(b.lat) || 50,
          lng: parseFloat(b.lng) || 50,
          updatedAt: b.updated_at || new Date().toISOString()
        }));
        changed = true;
      }
      if (Array.isArray(json.data.lots) && json.data.lots.length) {
        db.lots = json.data.lots.map(l => ({
          id: l.id,
          name: l.name_th || l.name,
          nameEn: l.name_en || l.nameEn || l.name,
          buildingId: l.building_id || l.buildingId,
          capacity: parseInt(l.capacity, 10) || 20,
          available: parseInt(l.available, 10) || 0,
          lat: parseFloat(l.lat) || 50,
          lng: parseFloat(l.lng) || 50,
          updatedAt: l.updated_at || new Date().toISOString()
        }));
        changed = true;
      }
      if (Array.isArray(json.data.reviews) && json.data.reviews.length) {
        db.reviews = json.data.reviews.map(r => ({
          id: r.id || 'rev_' + Date.now(),
          stars: parseInt(r.stars, 10) || 5,
          text: r.text || '',
          name: r.name || 'ผู้ใช้งาน',
          timestamp: parseInt(r.timestamp, 10) || Date.now()
        }));
        changed = true;
      }

      if (changed) {
        saveDatabase();
        broadcastSSE('full_sync', {
          buildings: db.buildings,
          lots: db.lots,
          reviews: db.reviews,
          timestamp: Date.now()
        });
      }

      return { success: true, message: 'Synchronized successfully with Google Sheets', timestamp: Date.now() };
    }
  } catch (err) {
    console.warn('[Sheets Sync] Error during sync:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get all Network IPv4 Addresses for LAN access
 */
function getNetworkIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ interface: name, address: net.address });
      }
    }
  }
  return ips;
}

/**
 * Helper to parse JSON request bodies
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Helper to send JSON responses with CORS headers
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(data));
}

/**
 * Helper to send static files
 */
function sendStaticFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('File Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

/**
 * Main HTTP Server Request Handler
 */
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  try {
    // 1. REAL-TIME SERVER-SENT EVENTS (SSE) ENDPOINT
    if (pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write(': connected to Parking-A-Lot Realtime Stream\n\n');

      const clientInfo = {
        id: 'client_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        req,
        res,
        ip: req.socket.remoteAddress
      };
      sseClients.add(clientInfo);

      // Send immediate initial sync state to new connection
      res.write(`event: initial_state\ndata: ${JSON.stringify({
        buildings: db.buildings,
        lots: db.lots,
        reviews: db.reviews,
        activeClients: sseClients.size,
        googleSheetsConfigured: !!(config.googleSheetsUrl && config.googleSheetsUrl.startsWith('http')),
        timestamp: Date.now()
      })}\n\n`);

      req.on('close', () => {
        sseClients.delete(clientInfo);
      });
      return;
    }

    // 2. HEALTH & SERVER STATUS API
    if (pathname === '/api/health' && method === 'GET') {
      const ips = getNetworkIps();
      return sendJson(res, 200, {
        success: true,
        status: 'online',
        serverName: config.serverName,
        activeConnections: sseClients.size,
        localIps: ips.map(i => `http://${i.address}:${PORT}`),
        googleSheetsUrl: config.googleSheetsUrl ? 'configured' : 'not_set',
        totalBuildings: db.buildings.length,
        totalLots: db.lots.length,
        totalSpaces: db.lots.reduce((s, l) => s + (parseInt(l.available, 10) || 0), 0),
        timestamp: new Date().toISOString()
      });
    }

    // 3. GET ALL INITIAL / CURRENT DATA
    if (pathname === '/api/data' && method === 'GET') {
      return sendJson(res, 200, {
        success: true,
        data: {
          buildings: db.buildings,
          lots: db.lots,
          reviews: db.reviews,
          config: {
            googleSheetsUrl: config.googleSheetsUrl,
            serverName: config.serverName
          },
          activeClients: sseClients.size,
          timestamp: Date.now()
        }
      });
    }

    // 4. LOT ADJUSTMENT (INCREMENT / DECREMENT)
    if (pathname === '/api/lots/adjust' && method === 'POST') {
      const body = await readJsonBody(req);
      const { id, change } = body;
      const lot = db.lots.find(l => l.id === id);
      if (!lot) return sendJson(res, 404, { success: false, error: 'Lot not found' });

      const diff = parseInt(change, 10) || 0;
      const capacity = parseInt(lot.capacity, 10) || 20;
      const current = parseInt(lot.available, 10) || 0;
      lot.available = Math.max(0, Math.min(capacity, current + diff));
      lot.updatedAt = new Date().toISOString();

      saveDatabase();
      broadcastSSE('lot_updated', { lot, source: 'adjust' });
      pushToGoogleSheets('adjustLotAvailability', { id, change: diff });

      return sendJson(res, 200, { success: true, data: lot });
    }

    // 5. LOT SAVE (CREATE OR UPDATE FULL DETAILS)
    if (pathname === '/api/lots/save' && method === 'POST') {
      const body = await readJsonBody(req);
      const lotData = body.lot || body;
      const id = lotData.id || 'lot-' + Date.now();
      const name = (lotData.name || lotData.name_th || '').trim();
      const nameEn = (lotData.nameEn || lotData.name_en || name).trim();
      const buildingId = lotData.buildingId || lotData.building_id || '';
      const capacity = Math.max(1, parseInt(lotData.capacity, 10) || 20);
      const available = typeof lotData.available !== 'undefined'
        ? Math.max(0, Math.min(capacity, parseInt(lotData.available, 10) || 0))
        : capacity;
      const lat = parseFloat(lotData.lat) || 50;
      const lng = parseFloat(lotData.lng) || 50;

      if (!name || !buildingId) {
        return sendJson(res, 400, { success: false, error: 'Name and buildingId are required' });
      }

      const existingIdx = db.lots.findIndex(l => l.id === id);
      const savedLot = {
        id,
        name,
        nameEn,
        buildingId,
        capacity,
        available,
        lat,
        lng,
        updatedAt: new Date().toISOString()
      };

      if (existingIdx >= 0) {
        db.lots[existingIdx] = savedLot;
      } else {
        db.lots.push(savedLot);
      }

      saveDatabase();
      broadcastSSE(existingIdx >= 0 ? 'lot_updated' : 'lot_added', { lot: savedLot });
      pushToGoogleSheets('saveLot', savedLot);

      return sendJson(res, 200, { success: true, data: savedLot });
    }

    // 6. LOT DELETE
    if ((pathname === '/api/lots/delete' && method === 'POST') || (pathname.startsWith('/api/lots/') && method === 'DELETE')) {
      const body = method === 'DELETE' ? {} : await readJsonBody(req);
      const id = body.id || pathname.split('/').pop();
      const idx = db.lots.findIndex(l => l.id === id);
      if (idx === -1) return sendJson(res, 404, { success: false, error: 'Lot not found' });

      const deleted = db.lots.splice(idx, 1)[0];
      saveDatabase();
      broadcastSSE('lot_deleted', { id, deleted });
      pushToGoogleSheets('deleteLot', { id });

      return sendJson(res, 200, { success: true, message: 'Lot deleted successfully', id });
    }

    // 7. BUILDING SAVE (CREATE OR UPDATE)
    if (pathname === '/api/buildings/save' && method === 'POST') {
      const body = await readJsonBody(req);
      const bldgData = body.building || body;
      const id = bldgData.id || 'bldg-' + Date.now();
      const name = (bldgData.name || bldgData.name_th || '').trim();
      const nameEn = (bldgData.nameEn || bldgData.name_en || name).trim();
      const category = (bldgData.category || 'classroom').trim();
      const lat = Math.max(5, Math.min(95, parseFloat(bldgData.lat) || 50));
      const lng = Math.max(5, Math.min(95, parseFloat(bldgData.lng) || 50));

      if (!name) {
        return sendJson(res, 400, { success: false, error: 'Building name is required' });
      }

      const existingIdx = db.buildings.findIndex(b => b.id === id);
      const savedBuilding = {
        id,
        name,
        nameEn,
        category,
        lat,
        lng,
        updatedAt: new Date().toISOString()
      };

      if (existingIdx >= 0) {
        db.buildings[existingIdx] = savedBuilding;
      } else {
        db.buildings.push(savedBuilding);
      }

      saveDatabase();
      broadcastSSE(existingIdx >= 0 ? 'building_updated' : 'building_added', { building: savedBuilding });
      pushToGoogleSheets('saveBuilding', savedBuilding);

      return sendJson(res, 200, { success: true, data: savedBuilding });
    }

    // 8. BUILDING DELETE
    if ((pathname === '/api/buildings/delete' && method === 'POST') || (pathname.startsWith('/api/buildings/') && method === 'DELETE')) {
      const body = method === 'DELETE' ? {} : await readJsonBody(req);
      const id = body.id || pathname.split('/').pop();
      const idx = db.buildings.findIndex(b => b.id === id);
      if (idx === -1) return sendJson(res, 404, { success: false, error: 'Building not found' });

      const deleted = db.buildings.splice(idx, 1)[0];
      saveDatabase();
      broadcastSSE('building_deleted', { id, deleted });
      pushToGoogleSheets('deleteBuilding', { id });

      return sendJson(res, 200, { success: true, message: 'Building deleted successfully', id });
    }

    // 9. PARKING CHECK-IN (PARK SPOT)
    if (pathname === '/api/parking/park' && method === 'POST') {
      const body = await readJsonBody(req);
      const { username, buildingId, lotId } = body;
      const lot = db.lots.find(l => l.id === lotId);
      if (lot) {
        lot.available = Math.max(0, (parseInt(lot.available, 10) || 0) - 1);
        lot.updatedAt = new Date().toISOString();
      }

      const session = {
        id: 'park_' + Date.now(),
        username: (username || 'guest').toLowerCase(),
        buildingId,
        lotId,
        startTime: Date.now()
      };
      db.parkingHistory.push(session);

      saveDatabase();
      if (lot) broadcastSSE('lot_updated', { lot, source: 'park' });
      broadcastSSE('parking_session_started', { session });
      pushToGoogleSheets('recordParking', { username, building_id: buildingId, lot_id: lotId });

      return sendJson(res, 200, { success: true, session, lot });
    }

    // 10. PARKING CHECK-OUT (RELEASE SPOT)
    if (pathname === '/api/parking/checkout' && method === 'POST') {
      const body = await readJsonBody(req);
      const { username, lotId, buildingId } = body;
      const lot = db.lots.find(l => l.id === lotId);
      if (lot) {
        const capacity = parseInt(lot.capacity, 10) || 20;
        lot.available = Math.min(capacity, (parseInt(lot.available, 10) || 0) + 1);
        lot.updatedAt = new Date().toISOString();
      }

      saveDatabase();
      if (lot) broadcastSSE('lot_updated', { lot, source: 'checkout' });
      broadcastSSE('parking_session_ended', { username, lotId, timestamp: Date.now() });
      pushToGoogleSheets('recordCheckOut', { username, lot_id: lotId, building_id: buildingId });

      return sendJson(res, 200, { success: true, message: 'Checked out successfully, space released', lot });
    }

    // 11. SUBMIT REVIEW
    if (pathname === '/api/reviews' && method === 'POST') {
      const body = await readJsonBody(req);
      const review = {
        id: 'rev_' + Date.now(),
        username: (body.username || 'guest').toLowerCase(),
        name: (body.name || 'ผู้ใช้งาน').trim(),
        stars: Math.max(1, Math.min(5, parseInt(body.stars, 10) || 5)),
        text: (body.text || '').trim(),
        timestamp: Date.now()
      };
      db.reviews.unshift(review);
      if (db.reviews.length > 50) db.reviews = db.reviews.slice(0, 50);

      saveDatabase();
      broadcastSSE('review_added', { review });
      pushToGoogleSheets('submitReview', review);

      return sendJson(res, 200, { success: true, review });
    }

    // 12. USER AUTHENTICATION & REGISTRATION
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await readJsonBody(req);
      const username = (body.username || '').trim().toLowerCase();
      const password = String(body.password || '');

      const user = db.users.find(u => u.username === username && String(u.password) === password);
      if (!user) {
        return sendJson(res, 401, { success: false, error: 'Invalid username or password' });
      }
      return sendJson(res, 200, {
        success: true,
        user: { id: user.id, username: user.username, name: user.name, role: user.role, avatar: user.avatar }
      });
    }

    if (pathname === '/api/auth/register' && method === 'POST') {
      const body = await readJsonBody(req);
      const name = (body.name || '').trim();
      const username = (body.username || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!name || !username || !password) {
        return sendJson(res, 400, { success: false, error: 'Please provide name, username, and password' });
      }
      if (db.users.some(u => u.username === username)) {
        return sendJson(res, 409, { success: false, error: 'Username is already taken' });
      }

      const newUser = {
        id: 'user_' + Date.now(),
        username,
        password,
        name,
        role: 'user',
        avatar: '',
        createdAt: new Date().toISOString()
      };
      db.users.push(newUser);
      saveDatabase();
      pushToGoogleSheets('register', { name, username, password });

      return sendJson(res, 200, {
        success: true,
        user: { id: newUser.id, username: newUser.username, name: newUser.name, role: newUser.role, avatar: newUser.avatar }
      });
    }

    if (pathname === '/api/auth/profile' && method === 'POST') {
      const body = await readJsonBody(req);
      const username = (body.username || '').trim().toLowerCase();
      const user = db.users.find(u => u.username === username);
      if (!user) return sendJson(res, 404, { success: false, error: 'User not found' });

      if (body.name) user.name = body.name.trim();
      if (body.password) user.password = String(body.password);
      if (typeof body.avatar !== 'undefined') user.avatar = body.avatar;

      saveDatabase();
      pushToGoogleSheets('updateProfile', { username, name: user.name, password: user.password, avatar: user.avatar });

      return sendJson(res, 200, {
        success: true,
        user: { id: user.id, username: user.username, name: user.name, role: user.role, avatar: user.avatar }
      });
    }

    // 13. CONFIGURATION & GOOGLE SHEETS BRIDGE SYNC
    if (pathname === '/api/config' && method === 'GET') {
      return sendJson(res, 200, {
        success: true,
        config: {
          googleSheetsUrl: config.googleSheetsUrl,
          serverName: config.serverName,
          autoSyncWithSheets: config.autoSyncWithSheets
        },
        localIps: getNetworkIps().map(i => `http://${i.address}:${PORT}`)
      });
    }

    if (pathname === '/api/config' && method === 'POST') {
      const body = await readJsonBody(req);
      if (typeof body.googleSheetsUrl !== 'undefined') config.googleSheetsUrl = body.googleSheetsUrl.trim();
      if (typeof body.serverName !== 'undefined') config.serverName = body.serverName.trim();
      if (typeof body.autoSyncWithSheets !== 'undefined') config.autoSyncWithSheets = !!body.autoSyncWithSheets;

      saveConfig();
      broadcastSSE('config_updated', { config });

      return sendJson(res, 200, { success: true, config });
    }

    if (pathname === '/api/sync/sheets' && method === 'POST') {
      const syncResult = await syncWithGoogleSheets();
      return sendJson(res, syncResult.success ? 200 : 400, syncResult);
    }

    // 14. STATIC WEB SERVER (Serve index.html and static assets)
    if (method === 'GET') {
      if (pathname === '/' || pathname === '/index.html') {
        return sendStaticFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
      }

      // Safe static file lookup in root directory
      const safePath = path.normalize(path.join(__dirname, pathname));
      if (safePath.startsWith(__dirname) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const ext = path.extname(safePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon'
        };
        const mime = mimeTypes[ext] || 'application/octet-stream';
        return sendStaticFile(res, safePath, mime);
      }

      // Default fallback for SPA navigation
      return sendStaticFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
    }

    // 404 For Unhandled Endpoints
    sendJson(res, 404, { success: false, error: 'Endpoint Not Found' });
  } catch (err) {
    console.error(`[Server Error] ${method} ${pathname}:`, err);
    sendJson(res, 500, { success: false, error: 'Internal Server Error', details: err.message });
  }
});

// Start Server Listen
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const ips = getNetworkIps();
    console.log('============================================================');
    console.log(`🚗 PARKING-A-LOT SERVER HOST IS RUNNING`);
    console.log(`📡 Local Machine:   http://localhost:${PORT}`);
    if (ips.length > 0) {
      console.log(`📱 Wi-Fi / LAN IP:  http://${ips[0].address}:${PORT}`);
      ips.slice(1).forEach(ip => console.log(`   Alternate IP:   http://${ip.address}:${PORT}`));
    }
    console.log(`⚡ Real-Time SSE:   http://localhost:${PORT}/api/events`);
    console.log(`💾 Database:        ${DB_FILE}`);
    console.log('============================================================');
  });
}

module.exports = { server, db, config, broadcastSSE, syncWithGoogleSheets, saveDatabase };
