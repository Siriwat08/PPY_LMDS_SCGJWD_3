/**
 * MasterService — สะสมฐาน MASTER_PLACE จากชีต SCGนครหลวงJWDภูมิภาค
 * Safe Mode: ไม่แก้หัวคอลัมน์เดิม และไม่สร้างหัวคอลัมน์อัตโนมัติ
 * เขียนเฉพาะ MD_LINK, MATCH_KEY, POINTS_AT_TIME และ STATUS
 *
 * v5.3.1+ : ใช้ SHEETS.* และ MASTER_COLS_LEGACY จาก 00_Config.gs
 *           เพื่อ centralize config (ลบ hard-coded)
 */

// Alias สำหรับ backward compat — ชี้ไปที่ SHEETS.* ใน 00_Config.gs
const DR_SHEET    = SHEETS.SOURCE;     // 'SCGนครหลวงJWDภูมิภาค'
const MASTER_SHEET = SHEETS.MASTER;    // 'MASTER_PLACE'
const MASTER_COLS = MASTER_COLS_LEGACY; // 20 (คอลัมน์ที่ปุ่ม 1 ใช้)
const RAW_HELPER_HEADERS = ['MD_LINK', 'MATCH_KEY', 'POINTS_AT_TIME', 'STATUS'];
const MASTER_MAX_MS = 5 * 60 * 1000;

function getDriverRows_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(DR_SHEET);
  if (!sh) throw new Error('ไม่พบชีตต้นทาง: ' + DR_SHEET);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { rows: [], sh: sh, cols: {} };

  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function (v) { return String(v || '').trim(); });
  const cols = headerMap_(headers);
  ['ชื่อปลายทาง', 'ที่อยู่ปลายทาง', 'ชื่อเจ้าของสินค้า', 'LAT', 'LONG']
    .concat(RAW_HELPER_HEADERS)
    .forEach(function (h) { requireHeader_(cols, h, DR_SHEET); });

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i].slice();
    row._sheetRow = i + 1;
    rows.push(row);
  }
  return { rows: rows, sh: sh, cols: cols };
}

function runMaster(maxRows, maxMs) {
  // [v5.4.1 P1-3 FIX] LockService — กัน race condition สร้าง MD_ID ซ้ำ
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('runMaster: มีคนกดปุ่ม 1 ค้างอยู่ — รอ 20s แล้วยังไม่ว่าง');
  }
  try {
  maxRows = maxRows || Infinity;
  // v5.1 NEW-001: รับ maxMs จาก caller (เช่น uiRunMasterAndGeo ใช้ shared budget) — ถ้าไม่ส่งมาใช้ MASTER_MAX_MS ปกติ
  const timeBudgetMs = (typeof maxMs === 'number' && maxMs > 0) ? maxMs : MASTER_MAX_MS;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const info = getDriverRows_();
  const rows = info.rows, sh = info.sh, cols = info.cols;
  if (!rows.length) return { processed: 0, newMaster: 0, updated: 0 };
  const msh = ss.getSheetByName(MASTER_SHEET);
  if (!msh) throw new Error('ไม่พบชีต: ' + MASTER_SHEET);
  validateMasterHeaders_(msh);

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const mLast = msh.getLastRow();
  let masterData = mLast >= 2 ? msh.getRange(2, 1, mLast - 1, MASTER_COLS).getValues() : [];
  const map3 = {}, map3a = {};
  let maxId = 0;

  // map3Index: MATCH_KEY → index ใน masterData (สำหรับ F-007 dirty write)
  const map3Index = {};
  masterData.forEach(function (r, idx) {
    const key = String(r[MASTER_IDX.MATCH_KEY] || '');
    if (key) {
      map3[key] = r;
      map3Index[key] = idx;
      const parts = key.split('|');
      if (parts.length === 3) {
        const ak = makeKeyAlias(parts[0], parts[1], parts[2]);
        if (!map3a[ak]) {
          map3a[ak] = r;
          map3Index[ak] = idx;
        }
      }
    }
    maxId = Math.max(maxId, parseMasterId_(r[MASTER_IDX.MD_ID]));
  });

  // [v5.4.8 M-12 FIX] maxId ต้องสูงสุดระหว่าง MASTER กับ SYS_MASTER_IDX
  // กันกรณีล้าง MASTER แต่ SYS_MASTER_IDX ยังมี MD-0001..MD-N → MD ใหม่จะเริ่ม MD-0001 ทับของเก่า
  try {
    const idxSh = ss.getSheetByName(SHEETS.MASTER_IDX);
    if (idxSh && idxSh.getLastRow() >= 2) {
      const idxIds = idxSh.getRange(2, 1, idxSh.getLastRow() - 1, 1).getValues();
      for (let i = 0; i < idxIds.length; i++) {
        maxId = Math.max(maxId, parseMasterId_(idxIds[i][0]));
      }
    }
  } catch (e) {
    // SYS_MASTER_IDX อาจยังไม่มี — ไม่ critical
  }

  const stats = { processed: 0, newMaster: 0, updated: 0, skipped: 0 };
  const byStatus = { exact3: 0, alias3: 0, newm: 0 };
  const startedAt = Date.now();
  let stoppedByGuard = false;
  const helperStart = cols['MD_LINK'] + 1;
  const helperData = sh.getRange(2, helperStart, rows.length, RAW_HELPER_HEADERS.length).getValues();
  // [v5.4.4] partial-write guard: เขียนเป็นชุดทุก MASTER_FLUSH_EVERY แถวที่ process
  // กันกรณี timeout ตอน setValues ท้ายสุดแล้วงานที่ทำไปหาย
  const MASTER_FLUSH_EVERY = 200;
  let processedSinceFlush = 0;
  let dirty = false;
  // [v5.4.4] ดัชนี SYS_MASTER_IDX — upsert ตาม MD_ID (ไม่ลบทั้งชีต)
  const idxPending = {}; // mdId -> [MD_ID, MATCH_KEY, ALIAS_KEY, LAT, LNG]
  // [v5.4.9 F-007] จำ index ใน masterData ที่เปลี่ยน — ลดการ setValues ทั้งแผ่นซ้ำทุก flush
  const dirtyMasterIdx = {}; // 0-based index in masterData → true

  function flushMasterAndHelpers_() {
    if (!dirty) return;
    const dirtyKeys = Object.keys(dirtyMasterIdx);
    if (dirtyKeys.length) {
      // [v5.5.1 AUDIT F-004] รวมแถว dirty ที่ติดกันเป็นช่วง → setValues ทีละช่วง (ลด write amplification)
      const indices = [];
      for (let di = 0; di < dirtyKeys.length; di++) {
        const mi = parseInt(dirtyKeys[di], 10);
        if (!isNaN(mi) && mi >= 0 && mi < masterData.length) indices.push(mi);
      }
      indices.sort(function (a, b) { return a - b; });
      let runStart = 0;
      while (runStart < indices.length) {
        let runEnd = runStart;
        while (runEnd + 1 < indices.length && indices[runEnd + 1] === indices[runEnd] + 1) {
          runEnd++;
        }
        const from = indices[runStart];
        const to = indices[runEnd];
        const n = to - from + 1;
        const block = [];
        for (let mi = from; mi <= to; mi++) {
          const copy = masterData[mi].slice();
          while (copy.length < MASTER_COLS) copy.push('');
          block.push(copy.slice(0, MASTER_COLS));
        }
        msh.getRange(from + 2, 1, n, MASTER_COLS).setValues(block);
        runStart = runEnd + 1;
      }
      Object.keys(dirtyMasterIdx).forEach(function (k) { delete dirtyMasterIdx[k]; });
    }
    if (helperData.length) {
      sh.getRange(2, helperStart, helperData.length, RAW_HELPER_HEADERS.length).setValues(helperData);
    }
    const pendingRows = Object.keys(idxPending).map(function (k) { return idxPending[k]; });
    if (pendingRows.length) {
      upsertMasterIdxRows_(pendingRows);
      Object.keys(idxPending).forEach(function (k) { delete idxPending[k]; });
    }
    SpreadsheetApp.flush();
    dirty = false;
    processedSinceFlush = 0;
  }

  for (let i = 0; i < rows.length && stats.processed < maxRows; i++) {
    if (Date.now() - startedAt > timeBudgetMs) {
      stoppedByGuard = true;
      logRun_('runMaster', 'TIME_GUARD หยุดที่แถว ' + (i + 2) + '/' + (rows.length + 1) + ' (budget ' + Math.round(timeBudgetMs / 1000) + 's)');
      break;
    }
    const row = rows[i];
    const name = row[cols['ชื่อปลายทาง']];
    const addr = row[cols['ที่อยู่ปลายทาง']];
    const owner = row[cols['ชื่อเจ้าของสินค้า']];
    if (!name && !addr) continue;

    // ข้ามแถวที่ process แล้ว (MD_LINK + MATCH_KEY มีอยู่) — กัน POINTS เพิ่มซ้ำจากการรันข้อมูลชุดเดิม
    const existingMdLink = String(row[cols['MD_LINK']] || '').trim();
    const existingMatchKey = String(row[cols['MATCH_KEY']] || '').trim();
    if (existingMdLink && existingMatchKey) {
      stats.skipped++;
      continue;
    }

    stats.processed++;
    const key = makeKey(name, addr, owner);
    const exact = map3[key];
    const alias = map3a[makeKeyAlias(name, addr, owner)];
    // ใช้คีย์ครบ 3 คอลัมน์เท่านั้น ห้ามนำชื่อ+เจ้าของไปผูกกับที่อยู่คนละแห่ง
    let hit = exact || alias;
    let matchStatus = 'KNOWN';
    const lat = parseNum_(row[cols['LAT']]);
    const lng = parseNum_(row[cols['LONG']]);

    // เทียบ "ที่อยู่ปลายทาง" กับ SYS_TH_GEO เพื่อเอาคำที่ถูกต้องมาใส่ 4 คอลัมน์:
    //   N (PROVINCE), O (AMPHOE) - ข้อมูลราชการ
    //   P (CONFIRMED_BY), Q (REVIEW_NOTE) - metadata บอกที่มา (v5: ย้ายมาจากปุ่ม 3)
    // - ใส่เฉพาะเมื่อ SYS_TH_GEO แมชต์ได้ (geoLayer != '') เท่านั้น ห้ามเดาค่า
    // - ถ้าไม่แมชต์ ทุกคอลัมน์จะเว้นว่าง (ไม่ปล่อยให้ค่าหลอก)
    const addrGeo = geoParse_(String(addr || ''), '');
    const provinceFromGeo = addrGeo.geoLayer ? addrGeo.changwat : '';
    const amphoeFromGeo = addrGeo.geoLayer ? addrGeo.amphoe_khet : '';
    const confirmedByFromAddr = addrGeo.geoLayer ? 'SYS_TH_GEO' : '';
    const reviewNoteFromAddr = addrGeo.geoLayer ? ('แมชต์ด้วย ' + addrGeo.geoLayer + ' (จาก ที่อยู่ปลายทาง)') : '';

    if (hit) {
      // [v5.5.2 FIX — ปุ่ม 1 KEY ซ้ำไม่นับ POINTS]
      // เดิม: ถ้า LAST_SEEN เป็นวันนี้แล้ว จะไม่ ++POINTS
      // ผลเสีย: แถวต้นทางหลายแถว KEY เดียวกันในรอบเดียว (หรืองานหลายใบในวันเดียวกัน)
      //        ระบบแมชต์/เขียน MD_LINK ได้ แต่ POINTS ค้างไม่บวก → "เหมือนทำแต่ไม่นับรวม"
      // กันรันซ้ำชุดเดิม: ใช้เงื่อนไขข้ามแถวที่มี MD_LINK+MATCH_KEY ด้านบนแล้ว ไม่ใช้ isNewDay ล็อก POINTS
      let points = parseNum_(hit[MASTER_IDX.POINTS]) || 0;
      points++;
      if (lat !== null && lng !== null) {
        const oldPoints = points - 1;
        hit[MASTER_IDX.LAT] = oldPoints > 0
          ? ((parseNum_(hit[MASTER_IDX.LAT]) || 0) * oldPoints + lat) / points
          : lat;
        hit[MASTER_IDX.LNG] = oldPoints > 0
          ? ((parseNum_(hit[MASTER_IDX.LNG]) || 0) * oldPoints + lng) / points
          : lng;
      }
      hit[MASTER_IDX.POINTS] = points;
      hit[MASTER_IDX.LAST_SEEN] = today;
      hit[MASTER_IDX.UPDATED_AT] = today;  // ไม่ทับ FIRST_LAT/FIRST_LNG
      // อัปเดต PROVINCE/AMPHOE/CONFIRMED_BY/REVIEW_NOTE เมื่อแมชต์ได้ — ไม่ลบค่าเดิมถ้าไม่แมชต์
      // ปุ่ม 1 เขียนแค่คอลัมน์ 1-20 | ปุ่ม 3 เขียนเฉพาะ U-AA — ไม่ทับกัน
      if (addrGeo.geoLayer) {
        hit[MASTER_IDX.PROVINCE] = provinceFromGeo;
        hit[MASTER_IDX.AMPHOE] = amphoeFromGeo;
        hit[MASTER_IDX.CONFIRMED_BY] = confirmedByFromAddr;
        hit[MASTER_IDX.REVIEW_NOTE] = reviewNoteFromAddr;
      }
      if (exact) byStatus.exact3++;
      else byStatus.alias3++;
      stats.updated++;
    } else {
      const newId = 'MD-' + zeroPad_(++maxId, 4);
      // newR: 20 elements (0-19) ตรงกับ MASTER_COLS และ 20 คอลัมน์หลักของ MASTER_PLACE (เอกสาร Section 8)
      // [0-4]   MD_ID..OWNER_CLEAN
      // [5-10]  LAT..STATUS
      // [11-12] RAW_NAMES, RAW_ADDRS
      // [13-14] PROVINCE, AMPHOE  (จาก SYS_TH_GEO เมื่อแมชต์, มิเช่นนั้นเว้นว่าง)
      // [15-16] CONFIRMED_BY, REVIEW_NOTE  (v5: ปุ่ม 1 เขียนเอง จาก [ที่อยู่ปลายทาง] - ไม่รอปุ่ม 3)
      // [17-19] FIRST_LAT, FIRST_LNG, UPDATED_AT
      // คอลัมน์ 21-27 (Rahatpraisanee..GEO_LAYER) เป็นของปุ่ม 3 (runMasterGeo)
      const newR = [newId, key, cleanName(name), cleanAddr(addr), cleanOwner(owner),
        lat === null ? '' : lat, lng === null ? '' : lng, 1, today, today, 'ACTIVE',
        name ? String(name).trim() : '', addr ? String(addr).trim() : '',
        provinceFromGeo, amphoeFromGeo, // N=PROVINCE, O=AMPHOE
        confirmedByFromAddr, reviewNoteFromAddr, // v5: P=CONFIRMED_BY, Q=REVIEW_NOTE จาก [ที่อยู่ปลายทาง]
        lat === null ? '' : lat, lng === null ? '' : lng, today]; // R=FIRST_LAT, S=FIRST_LNG, T=UPDATED_AT
      masterData.push(newR);
      map3[key] = newR;
      map3a[makeKeyAlias(name, addr, owner)] = newR;
      map3Index[key] = masterData.length - 1;
      map3Index[makeKeyAlias(name, addr, owner)] = masterData.length - 1;
      hit = newR;
      matchStatus = 'NEW';
      byStatus.newm++;
      stats.newMaster++;
      dirtyMasterIdx[masterData.length - 1] = true;
    }

    if (matchStatus === 'KNOWN') {
      const mi2 = (typeof map3Index[key] === 'number')
        ? map3Index[key]
        : map3Index[makeKeyAlias(name, addr, owner)];
      if (typeof mi2 === 'number') dirtyMasterIdx[mi2] = true;
    }

    helperData[row._sheetRow - 2] = [hit[MASTER_IDX.MD_ID], key, parseNum_(hit[MASTER_IDX.POINTS]) || 1, matchStatus];
    // เก็บรายการ upsert ดัชนี (key ที่ใช้แมชต์รอบนี้ + พิกัดล่าสุดจาก MASTER)
    const mdIdHit = String(hit[MASTER_IDX.MD_ID] || '').trim();
    if (mdIdHit) {
      const masterKey = String(hit[MASTER_IDX.MATCH_KEY] || key || '').trim();
      const parts = masterKey.split('|');
      const aliasKey = (parts.length === 3)
        ? makeKeyAlias(parts[0], parts[1], parts[2])
        : makeKeyAlias(name, addr, owner);
      idxPending[mdIdHit] = [
        mdIdHit,
        masterKey,
        aliasKey,
        hit[MASTER_IDX.LAT],
        hit[MASTER_IDX.LNG]
      ];
    }
    dirty = true;
    processedSinceFlush++;
    // เขียนเป็นชุดเมื่อครบ BATCH — งานที่ทำแล้วไม่หายถ้า timeout ทีหลัง
    if (processedSinceFlush >= MASTER_FLUSH_EVERY) {
      flushMasterAndHelpers_();
    }
  }

  // [v5.4.4] flush รอบสุดท้าย (รวมกรณี TIME_GUARD หลัง batch ล่าสุด)
  flushMasterAndHelpers_();

  // [v5.4.1 P0 FIX] const msg + msg += -> TypeError เมื่อ TIME_GUARD fire
  // [v5.5.2] คืน timeGuard ให้ UI แจ้งผู้ใช้ — กัน error เงียบเมื่อรันไม่ครบ
  stats.timeGuard = stoppedByGuard;
  stats.exact3 = byStatus.exact3;
  stats.alias3 = byStatus.alias3;
  let msg = 'processed=' + stats.processed + ' NEW=' + stats.newMaster + ' UPDATED=' + stats.updated +
    ' SKIPPED=' + stats.skipped + ' exact3=' + byStatus.exact3 + ' alias3=' + byStatus.alias3;
  if (stoppedByGuard) msg += ' TIME_GUARD=true';
  logRun_('runMaster', msg);
  return stats;
  } finally {
    lock.releaseLock();  // [v5.4.1 P1-3] release lock
  }
}

function validateMasterHeaders_(msh) {
  if (msh.getLastColumn() < MASTER_COLS) {
    throw new Error('ชีต MASTER_PLACE มีคอลัมน์ไม่ครบ ' + MASTER_COLS + ' คอลัมน์ จึงหยุดเพื่อความปลอดภัย');
  }
  const headers = msh.getRange(1, 1, 1, MASTER_COLS).getValues()[0].map(function (v) { return String(v || '').trim(); });
  ['MD_ID', 'MATCH_KEY', 'NAME_CLEAN', 'ADDR_CLEAN', 'OWNER_CLEAN', 'LAT', 'LNG', 'POINTS'].forEach(function (h) {
    if (headers.indexOf(h) < 0) throw new Error('ชีต MASTER_PLACE ไม่มีหัวคอลัมน์ระบบ: ' + h);
  });
}

function headerMap_(headers) {
  const cols = {};
  headers.forEach(function (h, i) { if (h) cols[h] = i; });
  return cols;
}

function requireHeader_(cols, header, sheetName) {
  if (cols[header] === undefined) throw new Error('ชีต ' + sheetName + ' ไม่มีหัวคอลัมน์ที่จำเป็น: ' + header + ' กรุณาเพิ่มตามแบบที่กำหนด แล้วลองใหม่');
}

function parseMasterId_(v) {
  const m = String(v || '').match(/MD-(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  // [v5.4.8 L-6 FIX] รองรับ comma หลายตัว — "1,234.56" → 1234.56 (เดิม ".replace(',', '.')" → "1.234.56")
  // ใช้: ลบ comma ทั้งหมดก่อน (1,234.56 → 1234.56) แล้ว parse
  const cleaned = String(v).replace(/,/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function zeroPad_(n, len) {
  let s = String(n);
  while (s.length < len) s = '0' + s;
  return s;
}

function logRun_(fn, msg) {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SETTINGS);
    if (!sh) return;
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    sh.appendRow([ts, fn, msg]);
  } catch (e) {
    console.warn('logRun_ ล้มเหลว: ' + (e && e.message ? e.message : e));
  }
}

/**
 * บันทึกประวัติการแก้โค้ด (ไม่ใช่ผลรันปุ่ม)
 * กติกา: ทุกครั้งที่แก้ .gs ต้องเรียก recordCodeChange('เวอร์ชัน', 'สรุปสิ่งที่แก้')
 * เก็บในไฟล์ Drive: Phaopanya_CodeChangelog.txt (โฟลเดอร์เดียวกับ Spreadsheet)
 * รูปแบบ: [ts] vX.Y.Z | สรุป | user
 */
function recordCodeChange(version, summary) {
  if (!version || !summary) {
    throw new Error('recordCodeChange: ต้องใส่ version และ summary ทุกครั้ง');
  }
  try {
    const LOG_NAME = 'Phaopanya_CodeChangelog.txt';
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const user = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
    const line = '[' + ts + '] ' + version + ' | ' + summary + ' | ' + user + '\n';

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const parents = DriveApp.getFileById(ss.getId()).getParents();
    const folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

    const it = folder.getFilesByName(LOG_NAME);
    if (it.hasNext()) {
      const file = it.next();
      file.setContent(file.getBlob().getDataAsString() + line);
    } else {
      folder.createFile(LOG_NAME, line, MimeType.PLAIN_TEXT);
    }
    logRun_('CODE_CHANGE', version + ' | ' + summary);
  } catch (e) {
    console.warn('recordCodeChange ล้มเหลว: ' + (e && e.message ? e.message : e));
    throw e;
  }
}

function resetMasterLinks() {
  // [v5.5.0 M-3] role guard บน destructive op
  if (typeof assertRole_ === 'function') assertRole_('editor');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(DR_SHEET);
  if (!sh) throw new Error('ไม่พบชีตต้นทาง: ' + DR_SHEET);
  const last = sh.getLastRow();
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v || '').trim(); });
  const cols = headerMap_(headers);
  RAW_HELPER_HEADERS.forEach(function (h) { requireHeader_(cols, h, DR_SHEET); });
  if (last >= 2) sh.getRange(2, cols['MD_LINK'] + 1, last - 1, RAW_HELPER_HEADERS.length).clearContent();
  // [v5.4.8 M-11 FIX] ล้าง MASTER.POINTS ด้วย (atomic) เพื่อกัน POINTS inflation หลังรันใหม่
  const msh = ss.getSheetByName(MASTER_SHEET);
  let mPoints = 0, mRows = 0;
  if (msh && msh.getLastRow() >= 2) {
    const mHeaders = msh.getRange(1, 1, 1, msh.getLastColumn()).getValues()[0].map(function (v) { return String(v || '').trim(); });
    const mIdx = headerMap_(mHeaders);
    if (mIdx['POINTS'] !== undefined) {
      const pointsCol = msh.getRange(2, mIdx['POINTS'] + 1, msh.getLastRow() - 1, 1).getValues();
      mPoints = pointsCol.reduce(function (s, r) { return s + (parseNum_(r[0]) || 0); }, 0);
      mRows = pointsCol.length;
      // [v5.4.8 M-11 FIX] ล้าง POINTS เป็น 0 — กัน BUG-006 inflation
      msh.getRange(2, mIdx['POINTS'] + 1, mRows, 1).setValue(0);
    }
  }
  logRun_('resetMasterLinks', 'BUG-006 fix: ล้าง Source Helper + MASTER.POINTS=' + mPoints + ' → 0 (' + mRows + ' แถว)');
  SpreadsheetApp.getUi().alert(
    '✅ resetMasterLinks — BUG-006 fix\n\n' +
    '• ล้าง Source Helper (MD_LINK..STATUS) ใน "' + DR_SHEET + '"\n' +
    '• ล้าง MASTER.POINTS = 0 (' + mRows + ' แถว, ค่ารวม ' + mPoints + ')\n\n' +
    'ถ้าจะล้าง MASTER ทั้งชีต + SYS_MASTER_IDX + ตารางงานประจำวัน:\n' +
    '→ ใช้เมนู 🗑️ Reset All Master Refs'
  );
}

/**
 * resetAllMasterRefs_ — ล้าง MASTER + SYS_MASTER_IDX + DAILY.MD_LINK/MATCH_KEY/LatLong_Actual (atomic)
 * [v5.4.8 M-12 FIX] กัน MD_ID reuse ทับ SYS_MASTER_IDX เก่า
 * เรียกจากเมนู "🗑️ Reset All Master Refs (DANGER)" ใน 03_Menu.gs
 * @returns {{master:number, idx:number, daily:number}}
 */
function resetAllMasterRefs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // [v5.5.1 AUDIT F-001] ต้องล้าง SOURCE helper ด้วย — ไม่งั้น runMaster() ข้ามแถวเพราะ
  // still has MD_LINK+MATCH_KEY ขณะ MASTER ว่าง → rebuild ไม่เกิด
  const stats = { master: 0, idx: 0, daily: 0, source: 0 };

  // 0) ล้าง SOURCE helper (MD_LINK, MATCH_KEY, POINTS_AT_TIME, STATUS)
  const srcSh = ss.getSheetByName(DR_SHEET);
  if (srcSh && srcSh.getLastRow() >= 2) {
    const headers = srcSh.getRange(1, 1, 1, srcSh.getLastColumn()).getValues()[0].map(function (v) {
      return String(v || '').trim();
    });
    const cols = headerMap_(headers);
    let cleared = 0;
    RAW_HELPER_HEADERS.forEach(function (h) {
      if (cols[h] !== undefined) {
        srcSh.getRange(2, cols[h] + 1, srcSh.getLastRow() - 1, 1).clearContent();
        cleared++;
      }
    });
    stats.source = cleared;
  }

  // 1) ล้าง MASTER (ยกเว้น header)
  const msh = ss.getSheetByName(MASTER_SHEET);
  if (msh && msh.getLastRow() >= 2) {
    stats.master = msh.getLastRow() - 1;
    msh.getRange(2, 1, stats.master, msh.getLastColumn()).clearContent();
  }

  // 2) ล้าง SYS_MASTER_IDX
  const idxSh = ss.getSheetByName(SHEETS.MASTER_IDX);
  if (idxSh && idxSh.getLastRow() >= 2) {
    stats.idx = idxSh.getLastRow() - 1;
    idxSh.getRange(2, 1, stats.idx, idxSh.getLastColumn()).clearContent();
  }

  // 3) ล้าง ตารางงานประจำวัน: MD_LINK, MATCH_KEY, LatLong_Actual, MD_ID, Status
  const dataSh = ss.getSheetByName(SHEETS.DAILY);
  if (dataSh && dataSh.getLastRow() >= 2) {
    const headers = dataSh.getRange(1, 1, 1, dataSh.getLastColumn()).getValues()[0].map(function (h) {
      return String(h || '').trim();
    });
    const targetCols = ['MD_LINK', 'MATCH_KEY', 'LatLong_Actual', 'MD_ID', 'LatLong_Actual_Status'];
    const lastDataRow = dataSh.getLastRow();
    let firstCol = -1;
    for (let c = 0; c < headers.length; c++) {
      if (targetCols.indexOf(headers[c]) >= 0) {
        if (firstCol < 0) firstCol = c;
        dataSh.getRange(2, c + 1, lastDataRow - 1, 1).clearContent();
        stats.daily++;
      }
    }
  }

  logRun_('resetAllMasterRefs_', 'ล้าง SOURCE helper cols=' + (stats.source || 0) + ', MASTER=' + stats.master + ' แถว, IDX=' + stats.idx + ' แถว, DAILY=' + stats.daily + ' cols');
  return stats;
}

// ============================================
//  SYS_MASTER_IDX — ดัชนีเบาสำหรับปุ่ม 2
//  กติกา: upsert ตาม MD_ID เท่านั้น — ไม่ลบ/เคลียร์ทั้งชีต
// ============================================

/** สร้างชีตดัชนีถ้ายังไม่มี (ใส่หัวคอลัมน์อย่างเดียว) */
function ensureMasterIdxSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEETS.MASTER_IDX);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.MASTER_IDX);
    sh.getRange(1, 1, 1, MASTER_IDX_SHEET_HEADERS.length)
      .setValues([MASTER_IDX_SHEET_HEADERS])
      .setFontWeight('bold');
    logRun_('ensureMasterIdxSheet_', 'สร้างชีต ' + SHEETS.MASTER_IDX + ' ใหม่');
  } else if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) {
    sh.getRange(1, 1, 1, MASTER_IDX_SHEET_HEADERS.length)
      .setValues([MASTER_IDX_SHEET_HEADERS])
      .setFontWeight('bold');
  }
  return sh;
}

/**
 * โหลดดัชนีที่มีอยู่ → map ตาม MD_ID เพื่อรู้แถวที่จะอัปเดต
 * @returns {{sh:Sheet, byMdId:Object}} byMdId[mdId] = sheetRow (1-based)
 */
function loadMasterIdxByMdId_() {
  const sh = ensureMasterIdxSheet_();
  const byMdId = {};
  const last = sh.getLastRow();
  if (last >= 2) {
    const data = sh.getRange(2, 1, last - 1, MASTER_IDX_SHEET.TOTAL_COLS).getValues();
    for (let i = 0; i < data.length; i++) {
      const mdId = String(data[i][MASTER_IDX_SHEET.MD_ID] || '').trim();
      if (mdId) byMdId[mdId] = i + 2; // sheet row
    }
  }
  return { sh: sh, byMdId: byMdId };
}

/**
 * upsert หลายแถวลง SYS_MASTER_IDX
 * - มี MD_ID อยู่แล้ว → อัปเดต MATCH_KEY/ALIAS/LAT/LNG ที่แถวนั้น
 * - ยังไม่มี → append ท้ายชีต
 * - ไม่ลบแถวอื่นที่มีอยู่
 * @param {Array<Array>} rows แต่ละแถว [MD_ID, MATCH_KEY, ALIAS_KEY, LAT, LNG]
 */
function upsertMasterIdxRows_(rows) {
  if (!rows || !rows.length) return { updated: 0, appended: 0 };
  const state = loadMasterIdxByMdId_();
  const sh = state.sh;
  const byMdId = state.byMdId;
  let updated = 0;
  const toAppend = [];

  rows.forEach(function (r) {
    const mdId = String(r[0] || '').trim();
    if (!mdId) return;
    const out = [
      mdId,
      String(r[1] || ''),
      String(r[2] || ''),
      r[3] === null || r[3] === undefined ? '' : r[3],
      r[4] === null || r[4] === undefined ? '' : r[4]
    ];
    // [v5.5.7 AUDIT FIX-4] เดิม: if (byMdId[mdId]) — sentinel ที่จองแถวใหม่คือ -1 ซึ่งเป็น truthy
    //   → MD_ID ซ้ำใน batch เดียว (เช่น rebuild จาก MASTER ที่ MD_ID เสีย) จะเรียก getRange(-1,...) แล้ว crash
    //   แก้: เช็ค !== undefined → แถวที่อยู่ใน sheet จริง (เลขแถว >= 2) อัปเดต / sentinel -1 ข้าม (กันซ้ำใน batch)
    if (byMdId[mdId] !== undefined && byMdId[mdId] > 0) {
      sh.getRange(byMdId[mdId], 1, 1, MASTER_IDX_SHEET.TOTAL_COLS).setValues([out]);
      updated++;
    } else if (byMdId[mdId] === undefined) {
      toAppend.push(out);
      // จอง mdId กันซ้ำใน batch เดียวกัน
      byMdId[mdId] = -1;
    }
  });

  if (toAppend.length) {
    const startRow = Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(startRow, 1, toAppend.length, MASTER_IDX_SHEET.TOTAL_COLS).setValues(toAppend);
  }
  return { updated: updated, appended: toAppend.length };
}

/**
 * สร้าง/ซ่อมดัชนีจาก MASTER_PLACE ทั้งแผ่น (upsert ทุกแถว)
 * ไม่ลบแถวในดัชนีที่มีอยู่ — แค่เพิ่มของที่ขาด + อัปเดตของที่มี MD_ID ตรงกัน
 * ใช้เมื่อดัชนีว่างหรือต้องการ sync ครั้งใหญ่
 */
function rebuildMasterIdxFromMaster() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('rebuildMasterIdxFromMaster: มีการรันอื่นค้างอยู่');
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const msh = ss.getSheetByName(SHEETS.MASTER);
    if (!msh) throw new Error('ไม่พบชีต: ' + SHEETS.MASTER);
    const mLast = msh.getLastRow();
    if (mLast < 2) {
      ensureMasterIdxSheet_();
      logRun_('rebuildMasterIdxFromMaster', 'MASTER ว่าง — สร้างหัวดัชนีอย่างเดียว');
      return { updated: 0, appended: 0, total: 0 };
    }
    const master = msh.getRange(2, 1, mLast - 1, MASTER_COLS).getValues();
    const rows = [];
    master.forEach(function (r) {
      const mdId = String(r[MASTER_IDX.MD_ID] || '').trim();
      const key = String(r[MASTER_IDX.MATCH_KEY] || '').trim();
      if (!mdId || !key) return;
      const parts = key.split('|');
      const aliasKey = (parts.length === 3)
        ? makeKeyAlias(parts[0], parts[1], parts[2])
        : '';
      rows.push([mdId, key, aliasKey, r[MASTER_IDX.LAT], r[MASTER_IDX.LNG]]);
    });
    const result = upsertMasterIdxRows_(rows);
    logRun_('rebuildMasterIdxFromMaster',
      'total=' + rows.length + ' updated=' + result.updated + ' appended=' + result.appended);
    return { updated: result.updated, appended: result.appended, total: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function uiRebuildMasterIdx() {
  const r = rebuildMasterIdxFromMaster();
  SpreadsheetApp.getUi().alert(
    'ซ่อมดัชนี SYS_MASTER_IDX เสร็จแล้ว\n\n' +
    'จาก MASTER: ' + r.total + ' แถว\n' +
    'อัปเดต: ' + r.updated + ' | เพิ่มใหม่: ' + r.appended + '\n\n' +
    'ไม่มีการลบแถวเดิมในดัชนี (upsert ตาม MD_ID เท่านั้น)'
  );
}

/**
 * โหลดดัชนีสำหรับปุ่ม 2 → map3 / map3a
 * คืนแถวเสมือนที่เข้าถึงด้วย MASTER_IDX.MD_ID / MATCH_KEY / LAT / LNG ได้
 * ถ้าดัชนีว่าง → คืน null (ให้ caller fallback ไป MASTER)
 */
function loadMapsFromMasterIdx_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEETS.MASTER_IDX);
  if (!sh || sh.getLastRow() < 2) return null;

  const data = sh.getRange(2, 1, sh.getLastRow() - 1, MASTER_IDX_SHEET.TOTAL_COLS).getValues();
  if (!data.length) return null;

  const map3 = {};
  const map3a = {};
  let n = 0;
  data.forEach(function (r) {
    const mdId = String(r[MASTER_IDX_SHEET.MD_ID] || '').trim();
    const key = String(r[MASTER_IDX_SHEET.MATCH_KEY] || '').trim();
    if (!mdId || !key) return;
    // แถวเสมือน — ใส่ค่าที่ตำแหน่ง MASTER_IDX เพื่อให้ปุ่ม 2 ใช้โค้ดเดิมได้
    const virtual = [];
    virtual[MASTER_IDX.MD_ID] = mdId;
    virtual[MASTER_IDX.MATCH_KEY] = key;
    virtual[MASTER_IDX.LAT] = r[MASTER_IDX_SHEET.LAT];
    virtual[MASTER_IDX.LNG] = r[MASTER_IDX_SHEET.LNG];
    if (!map3[key]) map3[key] = virtual;
    const aliasKey = String(r[MASTER_IDX_SHEET.ALIAS_KEY] || '').trim();
    if (aliasKey && !map3a[aliasKey]) map3a[aliasKey] = virtual;
    n++;
  });
  if (n === 0) return null;
  return { map3: map3, map3a: map3a, count: n, source: 'IDX' };
}
