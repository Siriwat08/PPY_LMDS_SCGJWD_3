/*
 * WorkloadService — แมชต์งานในชีตตารางงานประจำวัน
 * Safe Mode: ไม่แก้หัวคอลัมน์เดิม และไม่สร้างหัวคอลัมน์อัตโนมัติ
 * เขียนเฉพาะ LatLong_Actual, MATCH_KEY, MD_ID และ LatLong_Actual_Status
 *
 * v5.4.4+ : โหลดดัชนีจาก SYS_MASTER_IDX ก่อน (เบา) — ถ้าว่าง fallback ไป MASTER
 * v5.4.3+ : MATCH_KEY มาจากตอนโหลด SCG (makeKey ชุดเดียวกับปุ่ม 1)
 *           ปุ่ม 2 = lookup เป็นหลัก / fallback สร้าง key ถ้าแถวเก่าว่าง
 * v5.3.1+ : ใช้ SHEETS.* และ MASTER_IDX จาก 00_Config.gs
 */

// Alias สำหรับ backward compat — ชี้ไปที่ SHEETS.* ใน 00_Config.gs
const WL_SHEET = SHEETS.DAILY;   // 'ตารางงานประจำวัน'
const DAILY_WRITE_HEADERS = ['LatLong_Actual', 'MATCH_KEY', 'MD_ID', 'LatLong_Actual_Status'];
const DAILY_MAX_MS = 5 * 60 * 1000;

function runDailyMatch() {
  // [v5.4.1 P1-3 FIX] LockService — กัน race condition เขียน MATCH_KEY/MD_ID ซ้ำ
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('runDailyMatch: มีคนกดปุ่ม 2 ค้างอยู่ — รอ 20s แล้วยังไม่ว่าง');
  }
  try {
  const startedAt = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(WL_SHEET);
  if (!sh) throw new Error('ไม่พบชีต: ' + WL_SHEET);

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { total: 0, found: 0, fallback2: 0, review: 0 };

  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); });
  const cols = headerMap_(headers);
  ['ShipToName', 'ShipToAddress', 'SoldToName']
    .concat(DAILY_WRITE_HEADERS)
    .forEach(function (h) { requireHeader_(cols, h, WL_SHEET); });

  const all = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // [v5.4.4] โหลดดัชนีเบาจาก SYS_MASTER_IDX ก่อน — ถ้าว่าง/ไม่มี → fallback MASTER ทั้งแผ่น
  let map3 = {};
  let map3a = {};
  let indexSource = 'NONE';
  const fromIdx = loadMapsFromMasterIdx_();
  if (fromIdx && fromIdx.count > 0) {
    map3 = fromIdx.map3;
    map3a = fromIdx.map3a;
    indexSource = 'IDX:' + fromIdx.count;
  } else {
    const msh = ss.getSheetByName(SHEETS.MASTER);
    if (!msh) throw new Error('ไม่พบชีต: ' + SHEETS.MASTER);
    validateMasterHeaders_(msh);
    const mLast = msh.getLastRow();
    if (mLast >= 2) {
      const master = msh.getRange(2, 1, mLast - 1, MASTER_COLS).getValues();
      master.forEach(function (r) {
        const key = String(r[MASTER_IDX.MATCH_KEY] || '');
        if (!key) return;
        const parts = key.split('|');
        if (parts.length !== 3) return;
        if (!map3[key]) map3[key] = r;
        const aliasKey = makeKeyAlias(parts[0], parts[1], parts[2]);
        if (!map3a[aliasKey]) map3a[aliasKey] = r;
      });
      indexSource = 'MASTER:' + Object.keys(map3).length;
    }
  }

  const latOut = [], keyOut = [], idOut = [], statusOut = [];
  const stats = { total: 0, found: 0, fallback2: 0, review: 0 };
  let stoppedByGuard = false;

  for (let rowIndex = 0; rowIndex < all.length; rowIndex++) {
    const row = all[rowIndex];
    // [v5.4.7 F-004 FIX] log TIME_GUARD แค่ครั้งเดียวเมื่อยิงครั้งแรก — กัน log spam ทุกแถวที่เหลือ
    if (!stoppedByGuard && (Date.now() - startedAt > DAILY_MAX_MS)) {
      stoppedByGuard = true;
      logRun_('runDailyMatch', 'TIME_GUARD หยุดที่แถว ' + (rowIndex + 2) + '/' + lastRow);
    }

    if (stoppedByGuard) {
      latOut.push([row[cols['LatLong_Actual']]]);
      keyOut.push([row[cols['MATCH_KEY']]]);
      idOut.push([row[cols['MD_ID']]]);
      statusOut.push([row[cols['LatLong_Actual_Status']]]);
      continue;
    }

    const name = row[cols['ShipToName']];
    const addr = row[cols['ShipToAddress']];
    const owner = row[cols['SoldToName']];
    // ใช้ MATCH_KEY จากตอนโหลด SCG ก่อน — ถ้าไม่มี (ข้อมูลเก่า) ค่อยสร้างด้วย makeKey ชุดเดียวกับปุ่ม 1
    let key = String(row[cols['MATCH_KEY']] || '').trim();
    if (!key && (name || addr || owner)) {
      key = makeKey(name, addr, owner);
    }
    let latlng = '', mdId = '', status = '';

    if (key || name || addr || owner) {
      stats.total++;
      const exact = key ? map3[key] : null;
      const alias = map3a[makeKeyAlias(name, addr, owner)];
      // exact จาก MATCH_KEY ที่มีอยู่ / alias เป็น fallback
      const hit = exact || alias;
      if (hit) {
        mdId = hit[MASTER_IDX.MD_ID];
        latlng = fmtLatLng_(hit[MASTER_IDX.LAT], hit[MASTER_IDX.LNG]);
        status = latlng ? 'FOUND' : 'REVIEW';
        if (!key) key = String(hit[MASTER_IDX.MATCH_KEY] || key);
        if (latlng) stats.found++; else stats.review++;
      } else {
        status = 'REVIEW';
        stats.review++;
      }
    }

    // [v5.4.3 BUG-007 FIX] ถ้าไม่ใช่ FOUND → คงค่าเดิม ไม่ overwrite ด้วย ''
    if (status === 'FOUND') {
      latOut.push([latlng]);
      keyOut.push([key]);
      idOut.push([mdId]);
      statusOut.push([status]);
    } else {
      latOut.push([row[cols['LatLong_Actual']]]);
      // ถ้ามี key จากโหลด SCG แต่ยัง REVIEW — คง/เติม key ไว้ให้ debug ได้
      keyOut.push([key || row[cols['MATCH_KEY']]]);
      idOut.push([row[cols['MD_ID']]]);
      statusOut.push([row[cols['LatLong_Actual_Status']] || status]);
    }
  }

  // คอลัมน์ผลลัพธ์ไม่ติดกัน จึงเขียนแยก 4 ช่วงอย่างตั้งใจ แต่ยังเป็น batch ต่อคอลัมน์
  sh.getRange(2, cols['LatLong_Actual'] + 1, latOut.length, 1).setValues(latOut);
  sh.getRange(2, cols['MATCH_KEY'] + 1, keyOut.length, 1).setValues(keyOut);
  sh.getRange(2, cols['MD_ID'] + 1, idOut.length, 1).setValues(idOut);
  sh.getRange(2, cols['LatLong_Actual_Status'] + 1, statusOut.length, 1).setValues(statusOut);

  // [v5.4.1 P0 FIX] const msg + msg += -> TypeError เมื่อ TIME_GUARD fire
  // [v5.5.2] คืน timeGuard + indexSource ให้ UI แจ้งเมื่อรันไม่ครบ / ใช้ fallback
  stats.timeGuard = stoppedByGuard;
  stats.indexSource = indexSource;
  let msg = 'total=' + stats.total + ' FOUND=' + stats.found + ' REVIEW=' + stats.review +
    ' index=' + indexSource;
  if (stoppedByGuard) msg += ' TIME_GUARD=true';
  logRun_('runDailyMatch', msg);
  return stats;
  } finally {
    lock.releaseLock();  // [v5.4.1 P1-3] release lock
  }
}

function fmtLatLng_(lat, lng) {
  const a = parseNum_(lat), b = parseNum_(lng);
  if (a === null || b === null) return '';
  return String(Math.round(a * 100000) / 100000) + ', ' + String(Math.round(b * 100000) / 100000);
}

function resetDailyMatch() {
  // [v5.4.9 AUDIT FIX] role guard บน operation ที่ล้างข้อมูล
  if (typeof assertRole_ === 'function') assertRole_('editor');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WL_SHEET);
  if (!sh) throw new Error('ไม่พบชีต: ' + WL_SHEET);
  const last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (last < 2) return;
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); });
  const cols = headerMap_(headers);
  DAILY_WRITE_HEADERS.forEach(function (h) { requireHeader_(cols, h, WL_SHEET); });

  // RangeList ล้างหลายคอลัมน์ด้วยคำสั่งเดียว แทนการเรียก getRange().clearContent() ซ้ำทีละคอลัมน์
  const a1Ranges = DAILY_WRITE_HEADERS.map(function (h) {
    return sh.getRange(2, cols[h] + 1, last - 1, 1).getA1Notation();
  });
  sh.getRangeList(a1Ranges).clearContent();
  logRun_('resetDailyMatch', 'ล้างเฉพาะผลแมชต์ 4 คอลัมน์แล้ว');
}
