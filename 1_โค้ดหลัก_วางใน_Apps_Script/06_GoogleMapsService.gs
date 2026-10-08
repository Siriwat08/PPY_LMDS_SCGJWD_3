/**
 * 06_GoogleMapsService.gs — Google Maps helpers for AppSheet Bot "Seeker"
 * Base: รหัส_v3.6.js (Amit Agarwal + patches v3.1–v3.6)
 *
 * [v5.5.7 + SEC 05/09/2026 — ถอด SPREADSHEET_ID]
 *   ฉบับนี้ = โค้ด v5.5.7 (มี AUDIT FIX-1: sweep รองรับ addr='N/A') และถอด ID ชีตจริงออก
 *   เหตุผล: SPREADSHEET_ID เดิมถูก hard-code บน repo สาธารณะ (ความเสี่ยง exposure)
 *   ผล: ปล่อย '' → mapsGetSheet_() ใช้ Active Spreadsheet ของโปรเจกต์ที่สคริปต์ผูกอยู่ (container-bound)
 *   ข้อแม้จีเจียว: สคริปต์ต้องอยู่ในโปรเจกต์ Apps Script ที่ผูกกับชีตงานจริงเท่านั้น
 *   (ยังไม่ต้องแก้อะไรเพิ่ม — ถ้าเคยเปิดชีตจาก standalone ให้กลับมาใส่ ID ที่บรรทัด SPREADSHEET_ID นี้
 *    หลังผลักโค้ดขึ้น GitHub เสร็จ)
 *
 * [COMPAT v3.7 — for Phaopanya Master v5.5.3 same project]
 *   ✅ ไม่ใช้ชื่อ onOpen / CONFIG / getCache / getSheet ฯลฯ ที่อาจชนกับ Master
 *   ✅ เมนู: เรียก mapsInstallMenu_() จาก onOpen ของ 03_Menu.gs
 *   ✅ ชื่อที่ AppSheet เรียก: processAppSheetData ยังเดิม
 *   ✅ Custom Functions ในเซลล์: GOOGLEMAPS_* ยังเดิม (ต้องชื่อนี้)
 *
 * [v5.5.3 PATCH — Custom Functions Language]
 *   - Main script (processAppSheetData / reverseGeocodeCached): setLanguage('en') + Strip Thai
 *   - Custom Functions (GOOGLEMAPS_REVERSEGEOCODE/LATLONG/ADDRESS): setLanguage('th') + ไม่ Strip
 *   - DISTANCE/DURATION: ไม่เปลี่ยน (Directions API ไม่รับ setLanguage)
 *   - เหตุผล: ผู้ใช้ต้องการภาษาไทยเมื่อพิมพ์สูตรเองในชีต แต่ชีตงานต้องสะอาด (อังกฤษ)
 *
 * วางไฟล์นี้เป็นสคริปต์แยกในโปรเจกต์เดียวกับ v5.5.3
 * แล้วเพิ่ม 1 บรรทัดใน onOpen() ของ 03_Menu.gs:
 *     mapsInstallMenu_();
 */

// =================================================================
// [ SECTION 1 ] CONFIG — prefix MAPS_ กันชนกับ Master
// =================================================================

const MAPS_CONFIG = {
  // [v5.5.7 + SEC 05/09/2026] ถอด ID ออก — ปล่อย '' จะใช้ Active spreadsheet ของโปรเจกต์ที่สคริปต์ผูกอยู่
  // (เดิม: ใส่ ID ชีตจริง hard-code อยู่บรรทัดนี้บน repo สาธารณะ — หากต้องการใช้แบบ standalone ค่อยใส่กลับที่นี่)
  SPREADSHEET_ID: '',
  SHEET_NAME: 'SCGนครหลวงJWDภูมิภาค',
  DEPOT_COORDS: '14.164671,100.625358',
  COL_DISTANCE: 'ระยะทางจากคลัง_Km',
  COL_ADDRESS: 'ชื่อที่อยู่จาก_LatLong',
  COL_LATLONG: 'จุดส่งสินค้าปลายทาง',
  COL_KEY_ID: 'ID_SCGนครหลวงJWDภูมิภาค',
  CACHE_TTL_S: 6 * 60 * 60,
  MAX_FIX_PER_RUN: 5,
  SWEEP_LOOKBACK: 50,
  RETRY_LOOKBACK: 300,
};

// =================================================================
// [ SECTION 2 ] CACHE HELPERS (namespaced)
// =================================================================

const mapsMd5_ = (key) => {
  key = key || '';
  const code = key.toLowerCase().replace(/\s/g, '');
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, code)
    .map(function (char) { return (char + 256).toString(16).slice(-2); })
    .join('');
};

const mapsGetCache_ = (key) => {
  try { return CacheService.getDocumentCache().get(mapsMd5_(key)); }
  catch (e) { return null; }
};

const mapsSetCache_ = (key, value) => {
  try {
    CacheService.getDocumentCache().put(mapsMd5_(key), value, MAPS_CONFIG.CACHE_TTL_S);
  } catch (e) { /* cache write failure ไม่บล็อก */ }
};

// =================================================================
// [ SECTION 3 ] GOOGLE MAPS HELPERS
// =================================================================

/**
 * reverseGeocodeCached — lat/lng → ที่อยู่ (cache + Plus Code filter + strip Thai)
 * ชื่อสาธารณะคงไว้ให้เรียกจากที่อื่นได้ แต่ภายในใช้ cache แบบ namespaced
 */
function reverseGeocodeCached(lat, lng) {
  if (!lat || !lng) return null;
  const key = 'rev:' + lat + ',' + lng;
  const cached = mapsGetCache_(key);
  if (cached !== null) return cached;

  try {
    const response = Maps.newGeocoder()
      .setLanguage('en')
      .reverseGeocode(lat, lng);

    if (response.results && response.results.length > 0) {
      let addr = 'GeoErr';
      const plusCodePattern = /^[A-Z0-9]{4,}\+[A-Z0-9]{2,}\s*,?\s*/i;

      for (let i = 0; i < response.results.length; i++) {
        const res = response.results[i];
        if (res.types && res.types.indexOf('plus_code') !== -1) continue;
        if (res.formatted_address && plusCodePattern.test(res.formatted_address)) continue;
        addr = res.formatted_address;
        break;
      }
      if (addr === 'GeoErr') addr = response.results[0].formatted_address;

      addr = addr.replace(plusCodePattern, '').trim();
      addr = mapsStripThaiChars_(addr);

      mapsSetCache_(key, addr);
      return addr;
    }
  } catch (e) { /* swallow */ }
  return 'GeoErr';
}

function mapsStripThaiChars_(s) {
  if (!s) return s;
  return String(s)
    .replace(/[\u0E00-\u0E7F]/g, '')
    .replace(/,\s*,/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDistanceCached(latLngStr) {
  if (!latLngStr || !String(latLngStr).includes(',')) return null;
  const key = 'dist:' + latLngStr;
  const cached = mapsGetCache_(key);
  if (cached !== null) return cached;

  try {
    const directions = Maps.newDirectionFinder()
      .setOrigin(MAPS_CONFIG.DEPOT_COORDS)
      .setDestination(latLngStr)
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .getDirections();
    if (directions.routes && directions.routes.length > 0) {
      const dist = directions.routes[0].legs[0].distance.value / 1000;
      mapsSetCache_(key, dist);
      return dist;
    }
  } catch (e) { /* swallow */ }
  return 'MapErr';
}

function mapsGetSheet_() {
  let ss;
  if (MAPS_CONFIG.SPREADSHEET_ID) {
    try {
      ss = SpreadsheetApp.openById(MAPS_CONFIG.SPREADSHEET_ID);
    } catch (e) {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) throw new Error('mapsGetSheet_: ไม่พบ Spreadsheet');
  const sheet = ss.getSheetByName(MAPS_CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('ไม่พบชีต "' + MAPS_CONFIG.SHEET_NAME + '"');
  return sheet;
}

function mapsGetColumnIndex_(header, colName) {
  return header.indexOf(colName) + 1;
}

// =================================================================
// [ SECTION 4 ] MAIN — AppSheet Bot "Seeker"
// ชื่อ processAppSheetData ต้องคงเดิม (AppSheet เรียกชื่อนี้)
// =================================================================

function processAppSheetData(rowId, latLngString, rowNumber) {
  console.log('🚀 Maps Start Process for ID: ' + rowId);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = mapsGetSheet_();

    const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0].map(function (h) { return h.toString().trim(); });
    const idxKey = mapsGetColumnIndex_(headerRow, MAPS_CONFIG.COL_KEY_ID);
    if (idxKey === 0) throw new Error('❌ ไม่พบคอลัมน์ "' + MAPS_CONFIG.COL_KEY_ID + '"');

    const targetRow = mapsFindTargetRow_(sheet, idxKey, rowId, rowNumber);
    if (targetRow === -1) throw new Error('Critical: ID "' + rowId + '" not found in sheet.');

    const idxDist = mapsGetColumnIndex_(headerRow, MAPS_CONFIG.COL_DISTANCE);
    const idxAddr = mapsGetColumnIndex_(headerRow, MAPS_CONFIG.COL_ADDRESS);
    const idxLL_Main = mapsGetColumnIndex_(headerRow, MAPS_CONFIG.COL_LATLONG);

    if ((!latLngString || !String(latLngString).includes(',')) && idxLL_Main > 0) {
      latLngString = sheet.getRange(targetRow, idxLL_Main).getValue();
    }

    if (latLngString && String(latLngString).includes(',')) {
      const parts = String(latLngString).split(',');
      const lat = parseFloat(parts[0].trim());
      const lng = parseFloat(parts[1].trim());

      const outputDist = getDistanceCached(latLngString);
      const outputAddr = reverseGeocodeCached(lat, lng);

      if (idxDist > 0) sheet.getRange(targetRow, idxDist).setValue(outputDist);
      if (idxAddr > 0) sheet.getRange(targetRow, idxAddr).setValue(outputAddr);
      console.log('✅ Maps Main Job Done at Row ' + targetRow +
        ' (dist=' + outputDist + ', addr=' + outputAddr + ')');
    }

    mapsAutoSweep_(sheet, headerRow, idxDist, idxAddr, idxLL_Main, targetRow);
    SpreadsheetApp.flush();
  } catch (err) {
    console.error('🔥 Maps Error: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

function mapsFindTargetRow_(sheet, idxKey, rowId, rowNumber) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    Utilities.sleep(attempt === 1 ? 2000 : (attempt === 2 ? 3000 : 5000));

    const suggestedRow = parseInt(rowNumber, 10);
    if (!isNaN(suggestedRow) && suggestedRow > 1 && suggestedRow <= sheet.getLastRow()) {
      const valAtRow = sheet.getRange(suggestedRow, idxKey).getValue();
      if (valAtRow.toString() == rowId.toString()) {
        console.log('✅ Maps Found ID at suggested row: ' + suggestedRow);
        return suggestedRow;
      }
    }

    const last = sheet.getLastRow();
    if (last < 2) continue;
    const allIds = sheet.getRange(2, idxKey, last - 1, 1).getValues().flat();
    const foundIndex = allIds.findIndex(function (id) {
      return id.toString() == rowId.toString();
    });
    if (foundIndex !== -1) {
      const foundRow = foundIndex + 2;
      console.log('✅ Maps Found ID via full scan at row: ' + foundRow);
      return foundRow;
    }
    console.warn('⚠️ Maps Attempt ' + attempt + ': ID "' + rowId + '" not found, retrying...');
  }
  return -1;
}

function mapsAutoSweep_(sheet, headerRow, idxDist, idxAddr, idxLL_Main, excludeRow) {
  try {
    const lastRow = sheet.getLastRow();
    const startSweep = Math.max(2, lastRow - MAPS_CONFIG.SWEEP_LOOKBACK);
    const rowsToCheck = lastRow - startSweep + 1;
    if (rowsToCheck <= 0) return;

    const values = sheet.getRange(startSweep, 1, rowsToCheck, sheet.getLastColumn()).getValues();
    let fixedCount = 0;
    const sweepUpdates = [];

    for (let i = 0; i < values.length && fixedCount < MAPS_CONFIG.MAX_FIX_PER_RUN; i++) {
      const rowVal = values[i];
      const currentRowNum = startSweep + i;
      if (currentRowNum === excludeRow) continue;

      const valDist = idxDist > 0 ? rowVal[idxDist - 1] : 'OK';
      const valAddr = idxAddr > 0 ? rowVal[idxAddr - 1] : 'OK';
      const valLL = idxLL_Main > 0 ? rowVal[idxLL_Main - 1] : '';

      // [v5.5.7 AUDIT FIX-1] เพิ่ม valAddr === 'N/A' ใน gate — เดิมเช็คเฉพาะ valDist 'N/A'
      //   ทำให้แถวที่ addr='N/A' แต่ dist มีค่า ไม่ถูก sweep ทั้งที่ inner logic รองรับการแก้ addr N/A อยู่แล้ว
      //   หลักฐาน: SOURCE จริงมี 3 แถว addr='N/A' + dist ถูกต้อง ค้างไม่ถูกแก้
      if ((valDist === '' || valDist === 'N/A' || valAddr === '' || valAddr === 'N/A') &&
          valLL && valLL.toString().includes(',')) {
        console.log('🧹 Maps Auto-Sweep fixing Row ' + currentRowNum + '...');
        const llStr = valLL.toString();
        const parts = llStr.split(',').map(function (s) { return parseFloat(s.trim()); });
        const sLat = parts[0];
        const sLng = parts[1];
        const newDist = (valDist === '' || valDist === 'N/A') ? getDistanceCached(llStr) : valDist;
        const newAddr = (valAddr === '' || valAddr === 'N/A') ? reverseGeocodeCached(sLat, sLng) : valAddr;
        sweepUpdates.push({ rowNum: currentRowNum, newDist: newDist, newAddr: newAddr });
        fixedCount++;
      }
    }

    sweepUpdates.forEach(function (u) {
      if (idxDist > 0) sheet.getRange(u.rowNum, idxDist).setValue(u.newDist);
      if (idxAddr > 0) sheet.getRange(u.rowNum, idxAddr).setValue(u.newAddr);
    });

    if (fixedCount > 0) console.log('🧹 Maps Auto-Sweep Fixed ' + fixedCount + ' rows.');
  } catch (sweepErr) {
    console.warn('Maps Auto-Sweep Error (Non-critical): ' + sweepErr.message);
  }
}

// =================================================================
// [ SECTION 5 ] MANUAL TOOLS (ชื่อไม่ชน Master)
// =================================================================

/** ซ่อมแถวที่ระยะทาง/ที่อยู่ว่าง — 300 แถวล่าสุด */
function mapsRetryMissingData() {
  console.log('🔄 Maps Start Batch Retry...');
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    const sheet = mapsGetSheet_();
    const header = sheet.getDataRange().getDisplayValues()[0];
    const idxDist = mapsGetColumnIndex_(header, MAPS_CONFIG.COL_DISTANCE);
    const idxAddr = mapsGetColumnIndex_(header, MAPS_CONFIG.COL_ADDRESS);
    const idxLL = mapsGetColumnIndex_(header, MAPS_CONFIG.COL_LATLONG);
    if (idxDist === 0 || idxAddr === 0 || idxLL === 0) {
      throw new Error('ไม่พบคอลัมน์ที่ต้องการ — เช็คชื่อใน MAPS_CONFIG');
    }

    const values = sheet.getDataRange().getDisplayValues();
    const startRow = Math.max(1, values.length - MAPS_CONFIG.RETRY_LOOKBACK);
    let fixCount = 0;

    for (let i = startRow; i < values.length; i++) {
      const row = values[i];
      const rowNum = i + 1;
      const distVal = row[idxDist - 1];
      const addrVal = row[idxAddr - 1];
      const latLngStr = row[idxLL - 1];

      // [v5.5.7 AUDIT FIX-1] เพิ่ม addrVal === 'N/A' ใน gate ให้ตรงกับ inner logic (เดิมพลาดเฉพาะฝั่ง addr)
      if ((distVal === '' || distVal === 'N/A' || addrVal === '' || addrVal === 'N/A') &&
          latLngStr && String(latLngStr).includes(',')) {
        const parts = String(latLngStr).split(',').map(function (s) { return parseFloat(s.trim()); });
        const lat = parts[0];
        const lng = parts[1];
        const newDist = (distVal === '' || distVal === 'N/A') ? getDistanceCached(latLngStr) : distVal;
        const newAddr = (addrVal === '' || addrVal === 'N/A') ? reverseGeocodeCached(lat, lng) : addrVal;
        sheet.getRange(rowNum, idxDist).setValue(newDist);
        sheet.getRange(rowNum, idxAddr).setValue(newAddr);
        fixCount++;
      }
    }

    SpreadsheetApp.flush();
    SpreadsheetApp.getUi().alert('✅ ซ่อมข้อมูล (Maps) เสร็จสิ้น: ' + fixCount + ' แถว');
    console.log('✅ Maps Retry Fixed ' + fixCount + ' rows.');
    return 'Fixed ' + fixCount;
  } catch (err) {
    console.error('🔥 Maps Retry Error: ' + err.message);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** ล้าง DocumentCache ของพิกัดในชีต SOURCE */
function mapsClearAllCache() {
  try {
    const sheet = mapsGetSheet_();
    const header = sheet.getDataRange().getDisplayValues()[0];
    const idxLL = mapsGetColumnIndex_(header, MAPS_CONFIG.COL_LATLONG);
    if (idxLL === 0) throw new Error('ไม่พบคอลัมน์พิกัด — เช็ค COL_LATLONG ใน MAPS_CONFIG');

    const allValues = sheet.getDataRange().getDisplayValues();
    const keysToRemove = {};

    for (let i = 1; i < allValues.length; i++) {
      const latLngStr = allValues[i][idxLL - 1];
      if (!latLngStr || !String(latLngStr).includes(',')) continue;
      const parts = String(latLngStr).split(',');
      const lat = parseFloat(parts[0].trim());
      const lng = parseFloat(parts[1].trim());
      if (isNaN(lat) || isNaN(lng)) continue;

      keysToRemove[mapsMd5_('dist:' + latLngStr)] = true;
      keysToRemove[mapsMd5_('rev:' + lat + ',' + lng)] = true;
    }

    const uniqueKeys = Object.keys(keysToRemove);
    if (uniqueKeys.length === 0) {
      SpreadsheetApp.getUi().alert('ℹ️ ไม่พบพิกัดในชีต — ไม่มี Cache ที่ต้องล้าง');
      return;
    }

    const cache = CacheService.getDocumentCache();
    const chunkSize = 100;
    for (let i = 0; i < uniqueKeys.length; i += chunkSize) {
      cache.removeAll(uniqueKeys.slice(i, i + chunkSize));
    }

    const coordCount = Math.round(uniqueKeys.length / 2);
    console.log('✅ mapsClearAllCache: removed ' + uniqueKeys.length + ' keys (' + coordCount + ' coords)');
    SpreadsheetApp.getUi().alert(
      '✅ ล้าง Cache (Maps) เสร็จสิ้น\n' +
      'ล้างแล้ว ' + coordCount + ' พิกัด (' + uniqueKeys.length + ' keys)'
    );
  } catch (e) {
    console.error('🔥 mapsClearAllCache error: ' + e.message);
    SpreadsheetApp.getUi().alert('❌ ล้าง Cache ไม่สำเร็จ:\n' + e.message);
  }
}

// =================================================================
// [ SECTION 6 ] MENU — ห้ามตั้งชื่อ onOpen (ชนกับ 03_Menu.gs)
// =================================================================

/** เรียกจาก onOpen() ของ Master: mapsInstallMenu_(); */
function mapsInstallMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('🛠️ เครื่องมือพิเศษ (Maps)')
    .addItem('🔄 ซ่อมข้อมูล (300 แถวล่าสุด)', 'mapsRetryMissingData')
    .addItem('🧹 ล้าง Cache (Plus Code ค้าง)', 'mapsClearAllCache')
    .addToUi();
}

// =================================================================
// [ SECTION 7 ] CUSTOM FUNCTIONS (ชื่อต้องตรงสูตรในเซลล์)
// =================================================================

/**
 * =GOOGLEMAPS_LATLONG("10 Hanover Square, NY")
 * [v5.5.3] เพิ่ม setLanguage('th') — ผู้ใช้อยู่ไทย ต้องการเห็นชื่อไทยในเซลล์
 * @param {String} address
 * @return {String} "lat,lng"
 * @customFunction
 */
const GOOGLEMAPS_LATLONG = (address) => {
  if (!address) throw new Error('No address specified!');
  if (address.map) return address.map(GOOGLEMAPS_LATLONG);
  const key = ['latlong', 'th', address].join(',');
  const value = mapsGetCache_(key);
  if (value !== null) return value;

  // [v5.5.3] บังคับภาษาไทย (Custom Function only)
  const { results: [data = null] = [] } = Maps.newGeocoder()
    .setLanguage('th')
    .geocode(address);
  if (data === null) throw new Error('Address not found!');

  const { geometry: { location: { lat, lng } } = {} } = data;
  const result = lat + ',' + lng;
  mapsSetCache_(key, result);
  return result;
};

/**
 * =GOOGLEMAPS_ADDRESS("10005")
 * [v5.5.3] เพิ่ม setLanguage('th') — ที่อยู่เต็มเป็นภาษาไทย
 * @param {String} address
 * @return {String} formatted_address (ภาษาไทย)
 * @customFunction
 */
const GOOGLEMAPS_ADDRESS = (address) => {
  if (!address) throw new Error('No address specified!');
  if (address.map) return address.map(GOOGLEMAPS_ADDRESS);
  const key = ['address', 'th', address].join(',');
  const value = mapsGetCache_(key);
  if (value !== null) return value;

  // [v5.5.3] บังคับภาษาไทย (Custom Function only)
  const { results: [data = null] = [] } = Maps.newGeocoder()
    .setLanguage('th')
    .geocode(address);
  if (data === null) throw new Error('Address not found!');

  const { formatted_address } = data;
  mapsSetCache_(key, formatted_address);
  return formatted_address;
};

/**
 * =GOOGLEMAPS_REVERSEGEOCODE(latitude, longitude)
 * [v5.5.3] เปลี่ยน setLanguage('en') → setLanguage('th') + เอา stripThai ออก
 *           เก็บ Plus Code filter ไว้ (Plus Code ไม่ใช่ภาษา)
 * @param {Number} latitude
 * @param {Number} longitude
 * @return {String} ที่อยู่ภาษาไทย (ไม่มี Plus Code, เก็บอักษรไทยไว้)
 * @customFunction
 */
const GOOGLEMAPS_REVERSEGEOCODE = (latitude, longitude) => {
  if (!latitude) throw new Error('No latitude specified!');
  if (!longitude) throw new Error('No longitude specified!');
  const key = ['reverse', 'th', latitude, longitude].join(',');
  const value = mapsGetCache_(key);
  if (value !== null) return value;

  // [v5.5.3] เปลี่ยน 'en' → 'th' — Custom Function คืนภาษาไทย
  const response = Maps.newGeocoder()
    .setLanguage('th')
    .reverseGeocode(latitude, longitude);

  if (!response.results || response.results.length === 0) return 'N/A';

  // [v5.5.3 KEEP] Plus Code filter ยังกรอง (Plus Code ไม่ใช่ภาษา)
  const plusCodePattern = /^[A-Z0-9]{4,}\+[A-Z0-9]{2,}\s*,?\s*/i;
  let addr = null;
  for (let i = 0; i < response.results.length; i++) {
    const res = response.results[i];
    if (res.types && res.types.indexOf('plus_code') !== -1) continue;
    if (res.formatted_address && plusCodePattern.test(res.formatted_address)) continue;
    addr = res.formatted_address;
    break;
  }
  if (!addr) addr = response.results[0].formatted_address;

  // [v5.5.3 REMOVED] ไม่ strip Thai — เก็บภาษาไทยไว้ (Custom Function only)
  addr = addr.replace(plusCodePattern, '').trim();

  mapsSetCache_(key, addr);
  return addr;
};

/**
 * =GOOGLEMAPS_DISTANCE("NY 10005", "Hoboken NJ", "walking")
 * @param {String} origin
 * @param {String} destination
 * @param {String} mode
 * @return {String}
 * @customFunction
 */
const GOOGLEMAPS_DISTANCE = (origin, destination, mode) => {
  mode = mode || 'driving';
  if (!origin || !destination) throw new Error('No address specified!');
  if (origin.map) return origin.map(GOOGLEMAPS_DISTANCE);
  const key = ['distance', origin, destination, mode].join(',');
  const value = mapsGetCache_(key);
  if (value !== null) return value;

  const { routes: [data = null] = [] } = Maps.newDirectionFinder()
    .setOrigin(origin)
    .setDestination(destination)
    .setMode(mode)
    .getDirections();
  if (data === null) throw new Error('No route found!');

  const { legs: [{ distance: { text: distance } } = {}] = [] } = data;
  mapsSetCache_(key, distance);
  return distance;
};

/**
 * =GOOGLEMAPS_DURATION("NY 10005", "Hoboken NJ", "walking")
 * @param {String} origin
 * @param {String} destination
 * @param {String} mode
 * @return {String}
 * @customFunction
 */
const GOOGLEMAPS_DURATION = (origin, destination, mode) => {
  mode = mode || 'driving';
  if (!origin || !destination) throw new Error('No address specified!');
  if (origin.map) return origin.map(GOOGLEMAPS_DURATION);
  const key = ['duration', origin, destination, mode].join(',');
  const value = mapsGetCache_(key);
  if (value !== null) return value;

  const { routes: [data = null] = [] } = Maps.newDirectionFinder()
    .setOrigin(origin)
    .setDestination(destination)
    .setMode(mode)
    .getDirections();
  if (data === null) throw new Error('No route found!');

  const { legs: [{ duration: { text: time } } = {}] = [] } = data;
  mapsSetCache_(key, time);
  return time;
};
