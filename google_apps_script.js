/**
 * ============================================================================
 * PARKING-A-LOT: GOOGLE APPS SCRIPT DATABASE BACKEND (Code.gs)
 * Version: 2.1.0 (High-Reliability Dual-Mode Storage)
 * ============================================================================
 * 
 * INSTRUCTIONS FOR SETUP / คำแนะนำการติดตั้ง:
 * 1. Open your Google Spreadsheet (or create a new one at https://sheets.new).
 * 2. In Google Sheets, click "Extensions" (ส่วนขยาย) > "Apps Script".
 * 3. Delete any default code in Code.gs, paste this entire file, and click "Save" (Ctrl+S / Cmd+S).
 * 4. Click "Deploy" (การทำให้ใช้งานได้) > "New deployment" (การทำให้ใช้งานได้รายการใหม่).
 * 5. Select type: "Web app" (เว็บแอป).
 * 6. Set Description: "Parking-A-Lot API v2.1".
 * 7. Execute as: "Me" (ฉัน - your email).
 * 8. Who has access: "Anyone" (ทุกคน - CRITICAL: Must be "Anyone" so the app can connect).
 * 9. Click "Deploy", authorize permissions when prompted, and copy the Web App URL.
 * 10. Paste the Web App URL into the Parking-A-Lot settings inside the web application.
 * ============================================================================
 */

// SPREADSHEET CONFIGURATION:
// Leave EMPTY ("") if this script was opened from "Extensions > Apps Script" inside the Sheet.
// Only fill this in if you are using a Standalone Apps Script project.
const SPREADSHEET_ID_OR_URL = "";

// Sheet Names & Column Definitions
const SHEETS = {
  USERS: 'Users',
  BUILDINGS: 'Buildings',
  LOTS: 'Lots',
  PARKING_HISTORY: 'ParkingHistory',
  SEARCH_HISTORY: 'SearchHistory',
  FAVORITES: 'Favorites',
  REVIEWS: 'Reviews',
  NOTIFICATIONS: 'Notifications'
};

const SCHEMAS = {
  Users: ['id', 'username', 'password', 'name', 'role', 'avatar', 'created_at', 'updated_at'],
  Buildings: ['id', 'name_th', 'name_en', 'category', 'lat', 'lng', 'updated_at'],
  Lots: ['id', 'name_th', 'name_en', 'building_id', 'capacity', 'available', 'lat', 'lng', 'updated_at'],
  ParkingHistory: ['id', 'username', 'building_id', 'lot_id', 'timestamp'],
  SearchHistory: ['id', 'username', 'query', 'timestamp'],
  Favorites: ['id', 'username', 'lot_id', 'created_at'],
  Reviews: ['id', 'username', 'name', 'stars', 'text', 'timestamp', 'status'],
  Notifications: ['id', 'username', 'text', 'timestamp', 'is_read']
};

/**
 * Get the active Spreadsheet instance with fallback
 */
function getSpreadsheet() {
  if (SPREADSHEET_ID_OR_URL && SPREADSHEET_ID_OR_URL.trim().length > 0) {
    const trimmed = SPREADSHEET_ID_OR_URL.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return SpreadsheetApp.openByUrl(trimmed);
    } else {
      return SpreadsheetApp.openById(trimmed);
    }
  }
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch(e) {}
  
  throw new Error("Active spreadsheet not found. Make sure you opened Apps Script from inside Google Sheets (Extensions > Apps Script) or set SPREADSHEET_ID_OR_URL in Code.gs.");
}

/**
 * Handle HTTP GET Requests (Queries, Health Checks & Fallback Mutations)
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    let payload = {};
    if (params.payload) {
      try { 
        payload = typeof params.payload === 'string' ? JSON.parse(params.payload) : params.payload; 
      } catch(ex) { 
        payload = {}; 
      }
    }
    const merged = Object.assign({}, params, payload);
    const action = merged.action || 'ping';

    initializeDatabase();

    // Route action
    return handleAction(action, merged);
  } catch (err) {
    return errorResponse(err.message || 'Internal Server Error', 500);
  }
}

/**
 * Handle HTTP POST Requests (Mutations, Auth, CRUD)
 */
function doPost(e) {
  try {
    initializeDatabase();
    let body = {};
    if (e && e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (ex) {
        body = e.parameter || {};
      }
    } else {
      body = (e && e.parameter) || {};
    }

    let payload = {};
    if (body.payload) {
      try {
        payload = typeof body.payload === 'string' ? JSON.parse(body.payload) : body.payload;
      } catch(ex) {}
    }

    const merged = Object.assign({}, body, payload);
    const action = merged.action || (e && e.parameter && e.parameter.action) || 'ping';
    return handleAction(action, merged);
  } catch (err) {
    return errorResponse(err.message || 'Internal Server Error', 500);
  }
}

/**
 * Central Action Dispatcher
 */
function handleAction(action, body) {
  switch (action) {
    case 'ping':
      return jsonResponse({
        success: true,
        status: 'online',
        message: 'Parking-A-Lot Google Sheets API is connected and active!',
        spreadsheetName: getSpreadsheet().getName(),
        sheets: getSpreadsheet().getSheets().map(s => s.getName()),
        timestamp: new Date().toISOString()
      });

    case 'init':
      initializeDatabase(true);
      return jsonResponse({ 
        success: true, 
        message: 'Database initialized successfully',
        sheets: getSpreadsheet().getSheets().map(s => s.getName())
      });

    case 'testWrite': {
      const testMsg = 'Test write: ' + (body.message || 'System connectivity check') + ' at ' + new Date().toLocaleString('th-TH');
      const testData = {
        id: 'test_' + Date.now(),
        username: (body.username || 'tester').toLowerCase(),
        query: testMsg,
        timestamp: Date.now()
      };
      appendRow(SHEETS.SEARCH_HISTORY, testData);
      return jsonResponse({
        success: true,
        message: 'Test record written successfully to SearchHistory sheet!',
        data: testData,
        spreadsheetName: getSpreadsheet().getName(),
        sheets: getSpreadsheet().getSheets().map(s => s.getName()),
        timestamp: new Date().toISOString()
      });
    }

    case 'getInitialData':
      return jsonResponse({
        success: true,
        data: {
          buildings: getRows(SHEETS.BUILDINGS),
          lots: getRows(SHEETS.LOTS),
          reviews: getRows(SHEETS.REVIEWS),
          timestamp: Date.now()
        }
      });

    case 'getBuildings':
      return jsonResponse({ success: true, data: getRows(SHEETS.BUILDINGS) });

    case 'getLots':
      return jsonResponse({ success: true, data: getRows(SHEETS.LOTS) });

    case 'getReviews':
      return jsonResponse({ success: true, data: getRows(SHEETS.REVIEWS) });

    case 'getUserData': {
      const username = (body.username || '').toLowerCase();
      if (!username) return errorResponse('Username is required', 400);

      const history = getRows(SHEETS.PARKING_HISTORY).filter(r => (r.username || '').toLowerCase() === username);
      const searches = getRows(SHEETS.SEARCH_HISTORY).filter(r => (r.username || '').toLowerCase() === username);
      const favorites = getRows(SHEETS.FAVORITES).filter(r => (r.username || '').toLowerCase() === username);
      const notifs = getRows(SHEETS.NOTIFICATIONS).filter(r => (r.username || '').toLowerCase() === username);

      return jsonResponse({
        success: true,
        data: {
          parkingHistory: history,
          searchHistory: searches,
          favorites: favorites.map(f => f.lot_id),
          notifications: notifs
        }
      });
    }

    case 'register': {
      const name = (body.name || '').trim();
      const username = (body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!name || !username || !password) {
        return errorResponse('Please provide name, username, and password', 400);
      }

      const users = getRows(SHEETS.USERS);
      if (users.some(u => (u.username || '').toLowerCase() === username)) {
        return errorResponse('Username is already taken', 409);
      }

      const newUser = {
        id: 'user_' + Date.now(),
        username: username,
        password: password,
        name: name,
        role: 'user',
        avatar: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      appendRow(SHEETS.USERS, newUser);
      return jsonResponse({
        success: true,
        message: 'User registered successfully and saved to Google Sheets',
        data: { username: newUser.username, name: newUser.name, role: newUser.role, avatar: newUser.avatar }
      });
    }

    case 'login': {
      const username = (body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!username || !password) {
        return errorResponse('Please provide username and password', 400);
      }

      const users = getRows(SHEETS.USERS);
      const user = users.find(u => (u.username || '').toLowerCase() === username && String(u.password) === password);
      if (!user) {
        return errorResponse('Invalid username or password', 401);
      }

      return jsonResponse({
        success: true,
        message: 'Login successful from Google Sheets',
        data: { username: user.username, name: user.name, role: user.role, avatar: user.avatar }
      });
    }

    case 'updateProfile': {
      const username = (body.username || '').trim().toLowerCase();
      const name = (body.name || '').trim();
      const password = body.password ? String(body.password) : '';
      const avatar = body.avatar || '';

      if (!username) return errorResponse('Username is required', 400);
      const users = getRows(SHEETS.USERS);
      const rowIndex = users.findIndex(u => (u.username || '').toLowerCase() === username);
      if (rowIndex === -1) return errorResponse('User not found', 404);

      const current = users[rowIndex];
      if (name) current.name = name;
      if (password) current.password = password;
      if (avatar) current.avatar = avatar;
      current.updated_at = new Date().toISOString();

      updateRow(SHEETS.USERS, rowIndex + 2, current);
      return jsonResponse({ success: true, message: 'Profile updated in Google Sheets', data: current });
    }

    case 'saveLot': {
      const lot = body.lot || body;
      const id = lot.id || 'lot-' + Date.now();
      const name_th = (lot.name_th || lot.name || '').trim();
      const name_en = (lot.name_en || lot.nameEn || name_th).trim();
      const building_id = lot.building_id || lot.buildingId || '';
      const capacity = parseInt(lot.capacity, 10) || 20;
      const available = typeof lot.available !== 'undefined' ? parseInt(lot.available, 10) : capacity;
      const lat = parseFloat(lot.lat) || 50;
      const lng = parseFloat(lot.lng) || 50;

      if (!name_th || !building_id) {
        return errorResponse('Lot name and building reference are required', 400);
      }

      const lots = getRows(SHEETS.LOTS);
      const existingIdx = lots.findIndex(l => String(l.id) === String(id));

      const lotData = {
        id,
        name_th,
        name_en,
        building_id,
        capacity,
        available: Math.max(0, Math.min(capacity, available)),
        lat,
        lng,
        updated_at: new Date().toISOString()
      };

      if (existingIdx >= 0) {
        updateRow(SHEETS.LOTS, existingIdx + 2, lotData);
      } else {
        appendRow(SHEETS.LOTS, lotData);
      }

      return jsonResponse({ success: true, message: 'Lot saved successfully to Google Sheets', data: lotData });
    }

    case 'adjustLotAvailability': {
      const id = body.id || '';
      const change = parseInt(body.change, 10) || 0;
      if (!id) return errorResponse('Lot ID required', 400);

      const lots = getRows(SHEETS.LOTS);
      const idx = lots.findIndex(l => String(l.id) === String(id));
      if (idx === -1) return errorResponse('Lot not found', 404);

      const lot = lots[idx];
      const cap = parseInt(lot.capacity, 10) || 20;
      const curAvail = parseInt(lot.available, 10) || 0;
      lot.available = Math.max(0, Math.min(cap, curAvail + change));
      lot.updated_at = new Date().toISOString();

      updateRow(SHEETS.LOTS, idx + 2, lot);
      return jsonResponse({ success: true, message: 'Availability updated in Google Sheets', data: lot });
    }

    case 'deleteLot': {
      const id = body.id || '';
      if (!id) return errorResponse('Lot ID required', 400);
      const lots = getRows(SHEETS.LOTS);
      const idx = lots.findIndex(l => String(l.id) === String(id));
      if (idx === -1) return errorResponse('Lot not found', 404);

      deleteRow(SHEETS.LOTS, idx + 2);
      return jsonResponse({ success: true, message: 'Lot deleted successfully from Google Sheets' });
    }

    case 'submitReview': {
      const username = (body.username || 'guest').toLowerCase();
      const name = (body.name || 'ผู้เยี่ยมชม').trim();
      const stars = Math.max(1, Math.min(5, parseInt(body.stars, 10) || 5));
      const text = (body.text || '').trim();

      const reviewData = {
        id: 'rev_' + Date.now(),
        username,
        name,
        stars,
        text,
        timestamp: Date.now(),
        status: 'published'
      };

      appendRow(SHEETS.REVIEWS, reviewData);
      return jsonResponse({ success: true, message: 'Review saved to Google Sheets', data: reviewData });
    }

    case 'recordParking': {
      const username = (body.username || 'guest').toLowerCase();
      const building_id = body.building_id || body.buildingId || '';
      const lot_id = body.lot_id || body.lotId || '';

      const parkingData = {
        id: 'park_' + Date.now(),
        username,
        building_id,
        lot_id,
        timestamp: Date.now()
      };

      appendRow(SHEETS.PARKING_HISTORY, parkingData);

      // Decrement lot availability in sheet
      if (lot_id) {
        const lots = getRows(SHEETS.LOTS);
        const idx = lots.findIndex(l => String(l.id) === String(lot_id));
        if (idx >= 0) {
          const lot = lots[idx];
          lot.available = Math.max(0, (parseInt(lot.available, 10) || 0) - 1);
          lot.updated_at = new Date().toISOString();
          updateRow(SHEETS.LOTS, idx + 2, lot);
        }
      }

      return jsonResponse({ success: true, message: 'Parking logged in Google Sheets', data: parkingData });
    }

    case 'recordSearch': {
      const username = (body.username || 'guest').toLowerCase();
      const query = (body.query || '').trim();
      if (!query) return errorResponse('Query is empty', 400);

      const searchData = {
        id: 'search_' + Date.now(),
        username,
        query,
        timestamp: Date.now()
      };

      appendRow(SHEETS.SEARCH_HISTORY, searchData);
      return jsonResponse({ success: true, message: 'Search logged in Google Sheets', data: searchData });
    }

    case 'toggleFavorite': {
      const username = (body.username || '').toLowerCase();
      const lot_id = body.lot_id || body.lotId || '';
      if (!username || !lot_id) return errorResponse('Username and Lot ID required', 400);

      const favorites = getRows(SHEETS.FAVORITES);
      const idx = favorites.findIndex(f => (f.username || '').toLowerCase() === username && String(f.lot_id) === String(lot_id));

      if (idx >= 0) {
        deleteRow(SHEETS.FAVORITES, idx + 2);
        return jsonResponse({ success: true, message: 'Favorite removed from Google Sheets', isFavorite: false });
      } else {
        appendRow(SHEETS.FAVORITES, {
          id: 'fav_' + Date.now(),
          username,
          lot_id,
          created_at: new Date().toISOString()
        });
        return jsonResponse({ success: true, message: 'Favorite saved to Google Sheets', isFavorite: true });
      }
    }

    default:
      return errorResponse('Unknown action: ' + action, 400);
  }
}

/**
 * Send JSON response
 */
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Send error response
 */
function errorResponse(msg, code) {
  return ContentService.createTextOutput(JSON.stringify({
    success: false,
    error: msg,
    code: code || 400,
    timestamp: Date.now()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Initialize all database sheets and default seed data
 */
function initializeDatabase(forceRefresh) {
  const ss = getSpreadsheet();
  const sheetKeys = Object.keys(SCHEMAS);

  sheetKeys.forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    const headers = SCHEMAS[sheetName];

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e9edf8');
      sheet.setFrozenRows(1);
    } else if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e9edf8');
      sheet.setFrozenRows(1);
    }
  });

  // Seed default buildings if empty
  const bldgSheet = ss.getSheetByName(SHEETS.BUILDINGS);
  if (bldgSheet && bldgSheet.getLastRow() <= 1) {
    const defaultBuildings = [
      ['b1', 'อาคารเรียนรวม', 'Complex Lecture Building', 'classroom', 40, 60, new Date().toISOString()],
      ['b2', 'คณะวิศวกรรมศาสตร์', 'Faculty of Engineering', 'classroom', 78, 28, new Date().toISOString()],
      ['b3', 'หอสมุดกลาง', 'Central Library', 'classroom', 18, 78, new Date().toISOString()],
      ['b4', 'อาคารสำนักงานอธิการบดี', "President's Office Building", 'office', 58, 12, new Date().toISOString()],
      ['b5', 'คณะเกษตรศาสตร์', 'Faculty of Agriculture', 'classroom', 88, 70, new Date().toISOString()],
      ['b6', 'สำนักบริการวิชาการ', 'Academic Services Bureau', 'office', 10, 38, new Date().toISOString()]
    ];
    defaultBuildings.forEach(b => bldgSheet.appendRow(b));
  }

  // Seed default lots if empty
  const lotSheet = ss.getSheetByName(SHEETS.LOTS);
  if (lotSheet && lotSheet.getLastRow() <= 1) {
    const defaultLots = [
      ['a', 'ลาน A หน้าอาคารเรียนรวม', 'Lot A - Lecture Complex', 'b1', 20, 15, 38, 58, new Date().toISOString()],
      ['b', 'ลาน B ข้างวิศวกรรมศาสตร์', 'Lot B - Engineering Wing', 'b2', 20, 5, 75, 31, new Date().toISOString()],
      ['d', 'ลาน D หลังหอสมุดกลาง', 'Lot D - Behind Library', 'b3', 20, 8, 21, 75, new Date().toISOString()]
    ];
    defaultLots.forEach(l => lotSheet.appendRow(l));
  }

  // Seed default admin users
  const userSheet = ss.getSheetByName(SHEETS.USERS);
  if (userSheet) {
    const existingUsers = getRows(SHEETS.USERS);
    const hasArdeshir = existingUsers.some(u => (u.username || '').toLowerCase() === 'ardeshir');
    const hasAlpine = existingUsers.some(u => (u.username || '').toLowerCase() === 'project alpine');

    if (!hasArdeshir) {
      appendRow(SHEETS.USERS, {
        id: 'admin_ardeshir',
        username: 'Ardeshir',
        password: 'hassanzxdeh',
        name: 'Ardeshir',
        role: 'admin',
        avatar: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    if (!hasAlpine) {
      appendRow(SHEETS.USERS, {
        id: 'admin_alpine',
        username: 'Project Alpine',
        password: 'orchid',
        name: 'Project Alpine (Tester / Admin)',
        role: 'admin',
        avatar: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } else {
      const alpineIdx = existingUsers.findIndex(u => (u.username || '').toLowerCase() === 'project alpine');
      if (alpineIdx >= 0 && existingUsers[alpineIdx].role !== 'admin') {
        const u = existingUsers[alpineIdx];
        u.role = 'admin';
        u.updated_at = new Date().toISOString();
        updateRow(SHEETS.USERS, alpineIdx + 2, u);
      }
    }
  }

  // Delete default blank Sheet1 if other sheets exist
  try {
    const defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่น1');
    if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
    }
  } catch(e) {}

  SpreadsheetApp.flush();
}

/**
 * Read all rows from a sheet as an array of JSON objects
 */
function getRows(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return [];

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return data.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

/**
 * Append an object as a row using schema headers & immediately commit
 */
function appendRow(sheetName, obj) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    initializeDatabase();
    sheet = ss.getSheetByName(sheetName);
  }
  const lastCol = sheet.getLastColumn() || (SCHEMAS[sheetName] ? SCHEMAS[sheetName].length : 8);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const rowData = headers.map(h => typeof obj[h] !== 'undefined' ? obj[h] : '');
  sheet.appendRow(rowData);
  SpreadsheetApp.flush();
}

/**
 * Update an existing row by row index (1-indexed) & immediately commit
 */
function updateRow(sheetName, rowIndex, obj) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const rowData = headers.map(h => typeof obj[h] !== 'undefined' ? obj[h] : '');
  sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  SpreadsheetApp.flush();
}

/**
 * Delete a specific row by row index (1-indexed) & immediately commit
 */
function deleteRow(sheetName, rowIndex) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;
  sheet.deleteRow(rowIndex);
  SpreadsheetApp.flush();
}
