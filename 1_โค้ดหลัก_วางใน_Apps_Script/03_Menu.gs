/**
 * Menu — เมนูระบบ SCG/JWD
 * เวอร์ชันปลอดภัย: ไม่สร้างหรือเปลี่ยนหัวคอลัมน์ของผู้ใช้
 *
 * [v5.5.6 PATCH-6] อัปเดตผลข้อความของปุ่ม 3 / 3b / 1+3 แสดงตัวชี้วัดใหม่จาก GeoService v5.5.6
 *   - Y แช่แข็ง (EN สะอาด ไม่ถูกทับ) = yFrozen | Y อัปเกรด (ขยะ→EN) = yUpgraded
 *   - ต้องวางคู่กับ 04_GeoService_v5.5.6.gs (PATCH-6 นโยบาย Upgrade-only)
 *   - ไม่เพิ่ม/ไม่ย้ายปุ่มใด ๆ จาก v5.5.4
 *
 * [v5.5.4 PATCH-5] เพิ่มปุ่ม "🧹 ล้างเฉพาะ 7 คอลัมน์ราชการ (U-AA)" ใน submenu "ดูผล / รีเซ็ต"
 *   - ไปทำงานกับฟังก์ชัน uiClearGeoColumnsOnly() ใน 04_GeoService_v5.5.4.gs
 *   - ใช้คู่กับปุ่ม 3/3b: ล้างก่อน → เติมใหม่ จะได้ค่าที่ถูกต้องตามตรรกะ v5.5.4 ทั้งชีต
 *   - นอกจากนี้ไม่มีการเปลี่ยนแปลงใด ๆ จาก v5.5.3
 */

function onOpen() {
  // เมนูเดิม (v5.3.1) — ไม่เปลี่ยนแปลง
  SpreadsheetApp.getUi().createMenu('🚚 SCG/JWD Master')
    .addItem('0) ตรวจสอบโครงสร้าง (ไม่แก้ชีต)', 'uiRunSetup')
    .addItem('1) สะสมฐาน MASTER', 'uiRunMaster')
    .addItem('3) เติม 7 คอลัมน์ราชการ (Geo)', 'uiRunMasterGeo')
    .addItem('3b) เติม 7 คอลัมน์ราชการ (English) [v5.3]', 'uiRunMasterGeoEn')
    .addItem('1+3) สะสม MASTER + เติม Geo (ต่อเนื่อง)', 'uiRunMasterAndGeo')
    .addSeparator()
    .addItem('2) รันแมชต์งานวันนี้ → เติม LatLong_Actual', 'uiRunDailyMatch')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('ดูผล / รีเซ็ต')
      .addItem('🧪 Self-Test (เช็คระบบ 8 จุด)', 'runSelfTestMenu_')
      .addSeparator()
      .addItem('🔍 ตรวจ Geo Key Alignment (กัน Dead Layer)', 'uiDiagnoseGeoKeys')
      .addItem('🧹 ล้างเฉพาะ 7 คอลัมน์ราชการ (U-AA)', 'uiClearGeoColumnsOnly')  // [v5.5.4 PATCH-5]
      .addItem('รีเซ็ตผลแมชต์งานประจำวัน', 'resetDailyMatch')
      .addItem('รีเซ็ตฐาน MASTER (ล้างเฉพาะข้อมูลฐาน)', 'resetMasterLinks')
      .addItem('🗑️ Reset All Master Refs (ล้าง MASTER + IDX + DAILY)', 'uiResetAllMasterRefs_')
      .addItem('ล้าง Cache SYS_TH_GEO', 'clearThGeoCache')
      .addItem('ซ่อมดัชนี SYS_MASTER_IDX จาก MASTER (ไม่ลบของเก่า)', 'uiRebuildMasterIdx')
      .addItem('แสดงผลล่าสุด', 'uiShowResult'))
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('🔐 Security & Maintenance')
      .addItem('🔑 Set SCG Cookie', 'uiSetScgCookie_')
      .addItem('🛡️ Trim PII (ลบ เลขบัตร/เบอร์โทร)', 'uiTrimPii_'))
    .addToUi();

  // เมนู SCG (ใหม่ — เพิ่มโดย Service_SCG.gs)
  // ฟีเจอร์: โหลดข้อมูลจาก API + แปลง + สรุป + ลบ
  // หมายเหตุ: ไม่ทำงานซ้ำกับปุ่ม 2 — เว้น LatLong_Actual/MD_ID/MATCH_KEY ไว้
  SpreadsheetApp.getUi().createMenu('📦 โหลดข้อมูล SCG')
    .addItem('🔑 ตั้ง / เปลี่ยน SCG Cookie', 'uiSetScgCookie_')
    .addSeparator()
    .addItem('📥 โหลดข้อมูลจาก API (Shipment → ตารางงานประจำวัน)', 'fetchDataFromSCGJWD')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('🔄 อัปเดตข้อมูล')
      .addItem('📊 สร้าง สรุป_เจ้าของสินค้า ใหม่', 'buildOwnerSummary')
      .addItem('📊 สร้าง สรุป_Shipment ใหม่', 'buildShipmentSummary')
      .addSeparator()
      .addItem('🔁 คำนวณ Aggregate ใหม่ (จำนวน/น้ำหนัก/Invoice)', 'reAggregateFromData_UI')
      .addItem('📧 ค้นหา Email พนักงานใหม่', 'reLookupEmail_UI')
      .addItem('🟡 ตั้งค่า default: รอสแกน / ยังไม่ได้ส่ง', 'setStatusDefaults_UI'))
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('🧹 ล้างข้อมูล (ระวัง!)')
      .addItem('⚠️ ล้างเฉพาะ "ตารางงานประจำวัน"', 'clearDataSheet_UI')
      .addItem('⚠️ ล้างเฉพาะ "สรุป_เจ้าของสินค้า"', 'clearSummaryOwnerSheet_UI')
      .addItem('⚠️ ล้างเฉพาะ "สรุป_Shipment"', 'clearSummaryShipmentSheet_UI')
      .addItem('⚠️ ล้างเฉพาะ "Input" (Cookie + Shipment)', 'clearInputSheet_UI')
      .addSeparator()
      .addItem('🔥 ล้าง SCG ทั้งหมด (4 ชีต)', 'clearAllSCGSheets_UI'))
    .addToUi();

  // เมนู Config (ใหม่ — เพิ่มโดย 00_Config.gs)
  // ฟีเจอร์: validate config + บันทึกประวัติแก้โค้ด
  SpreadsheetApp.getUi().createMenu('⚙️ Config')
    .addItem('🔍 ตรวจสอบ Config (ทุกชีตครบไหม)', 'uiRunValidateConfig')
    .addItem('📝 บันทึกประวัติแก้โค้ด (บังคับทุกครั้งที่แก้ .gs)', 'uiRecordCodeChange')
    .addToUi();

  // Google Maps tools (06_GoogleMapsService.gs) — อย่ามี onOpen แยก
  mapsInstallMenu_();

}

/** UI: บันทึกประวัติการแก้โค้ด — กติกาต้องเรียกทุกครั้งหลังแก้ .gs */
function uiRecordCodeChange() {
  const ui = SpreadsheetApp.getUi();
  const v = ui.prompt('เวอร์ชัน (เช่น v5.4.4)', ui.ButtonSet.OK_CANCEL);
  if (v.getSelectedButton() !== ui.Button.OK) return;
  const s = ui.prompt('สรุปสิ่งที่แก้ (สั้น ๆ)', ui.ButtonSet.OK_CANCEL);
  if (s.getSelectedButton() !== ui.Button.OK) return;
  recordCodeChange(v.getResponseText().trim(), s.getResponseText().trim());
  ui.alert('บันทึกแล้ว → ไฟล์ Phaopanya_CodeChangelog.txt');
}

let LAST_RESULT = null;
const LAST_RESULT_KEY = 'LMDS_LAST_RESULT';
const LAST_RESULT_TS_KEY = 'LMDS_LAST_RESULT_TS';
const LAST_RESULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * saveLastResult_ — เก็บ LAST_RESULT ใน ScriptProperty (24h TTL)
 * [v5.4.8 L-1 FIX] เดิมเก็บใน global var หายทุก execution
 */
function saveLastResult_(result) {
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty(LAST_RESULT_KEY, JSON.stringify(result));
    props.setProperty(LAST_RESULT_TS_KEY, String(Date.now()));
  } catch (e) {
    Logger.log('saveLastResult_: ' + e.message);
  }
}

/**
 * loadLastResult_ — อ่าน LAST_RESULT (ถ้ายังไม่หมดอายุ)
 */
function loadLastResult_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const ts = parseInt(props.getProperty(LAST_RESULT_TS_KEY) || '0', 10);
    if (!ts || (Date.now() - ts) > LAST_RESULT_TTL_MS) {
      return null;  // หมดอายุ
    }
    const raw = props.getProperty(LAST_RESULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function uiRunMaster() {
  // [v5.5.2] try/catch + แสดง skipped/TIME_GUARD — กัน error เงียบและรันไม่ครบโดยไม่รู้
  try {
    const stats = runMaster(Infinity);
    LAST_RESULT = stats;
    saveLastResult_(stats);
    let msg = 'สะสม MASTER เสร็จแล้ว\n' +
      'ประมวลผล ' + stats.processed + ' งาน | Master ใหม่ ' + stats.newMaster +
      ' | อัปเดต ' + stats.updated + ' | ข้าม ' + (stats.skipped || 0) +
      '\n\nไม่มีการเพิ่มหรือเปลี่ยนหัวคอลัมน์ในชีตต้นทาง';
    if (stats.timeGuard) {
      msg += '\n\n⚠️ TIME_GUARD: เวลาหมดก่อนจบ — กดปุ่ม 1 อีกครั้งเพื่อทำต่อ';
    } else if ((stats.skipped || 0) > 0 && stats.processed === 0) {
      msg += '\n\nℹ️ ข้ามทุกแถวเพราะมี MD_LINK+MATCH_KEY แล้ว — ถ้าต้องการรันใหม่ให้ใช้รีเซ็ตฐาน MASTER ก่อน';
    }
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ปุ่ม 1 ล้มเหลว:\n' + (e && e.message ? e.message : e));
    throw e;
  }
}

function uiRunMasterGeo() {
  try {
    const stats = runMasterGeo();
    LAST_RESULT = stats;
    saveLastResult_(stats);
    let msg = 'เติม 7 คอลัมน์ราชการเสร็จแล้ว\n' +
      'ประมวลผล ' + stats.processed + ' แถว | แมชต์ได้ ' + stats.filled +
      ' แถว | ข้าม ' + (stats.skipped || 0) +
      '\n• ที่อยู่ Y: แช่แข็ง (EN สะอาด) ' + (stats.yFrozen || 0) +
      ' | อัปเกรด (ขยะ→EN) ' + (stats.yUpgraded || 0) +   // [v5.5.6 PATCH-6]
      '\n(แถวที่ไม่แมชต์จะเว้นค่าว่างตามกฎ)';
    if (stats.timeGuard) {
      msg += '\n\n⚠️ TIME_GUARD: เวลาหมดก่อนจบ — กดปุ่ม 3 อีกครั้งเพื่อทำต่อ';
    } else if (stats.processed > 0 && stats.filled === 0) {
      msg += '\n\nℹ️ ไม่มีแถวแมชต์ได้ — ตรวจ SYS_TH_GEO / ข้อความที่อยู่ / กดล้าง Cache แล้วลองใหม่';
    }
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ปุ่ม 3 ล้มเหลว:\n' + (e && e.message ? e.message : e));
    throw e;
  }
}

/** [v5.3 ENGLISH] uiRunMasterGeoEn — รัน English version เขียนเฉพาะแถวที่ยังไม่มี layer (ทั้ง Thai/EN)
 * [v5.3.1 FIX] ลบ clearThGeoCache() ออก — ใช้ cache key ใหม่ (v53) ล้าง cache เก่าอัตโนมัติ
 */
function uiRunMasterGeoEn() {
  try {
    const stats = runMasterGeoEn();
    LAST_RESULT = stats;
    saveLastResult_(stats);
    let msg = 'เติม 7 คอลัมน์ราชการ (English) เสร็จแล้ว\n' +
      'ประมวลผล ' + stats.processed + ' แถว | แมชต์ได้ ' + stats.filled +
      ' แถว | ข้าม: ' + (stats.skipped || 0) +
      '\n• ที่อยู่ Y: แช่แข็ง (EN สะอาด) ' + (stats.yFrozen || 0) +
      ' | อัปเกรด (ขยะ→EN) ' + (stats.yUpgraded || 0) + '\n\n' +   // [v5.5.6 PATCH-6]
      'หมายเหตุ:\n' +
      '• ใช้เมื่อ [ชื่อที่อยู่จาก_LatLong] เป็นภาษาอังกฤษ\n' +
      '• GEO_LAYER ลงท้าย _EN\n' +
      '• ค่าใน U-AA เป็นภาษาไทยจาก SYS_TH_GEO';
    if (stats.timeGuard) {
      msg += '\n\n⚠️ TIME_GUARD: กดปุ่ม 3b อีกครั้งเพื่อทำต่อ';
    } else if (stats.processed > 0 && stats.filled === 0) {
      msg += '\n\nℹ️ ไม่มีแถวแมชต์ EN ได้ — ตรวจข้อความอังกฤษ / SYS_TH_GEO EN keys';
    }
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ปุ่ม 3b ล้มเหลว:\n' + (e && e.message ? e.message : e));
    throw e;
  }
}

/** 1+3 — รัน runMaster แล้วต่อด้วย runMasterGeo ใน Execution เดียว
 *  [v5.1 NEW-001 FIX] ใช้ shared time budget 4.5 นาที (ปลอดภัยกว่า 5+5=10 นาที ที่เกิน GAS hard limit 6 นาที)
 *  - runMaster: ให้ 2.5 นาที (เผื่อเวลาให้ runMasterGeo)
 *  - runMasterGeo: ใช้เวลาที่เหลือ (ถ้าเหลือ < 30 วิ → หยุด บังคับให้กดปุ่ม 3 แยก)
 */
function uiRunMasterAndGeo() {
  // GAS hard limit = 6 นาที — กันเผื่อด้วย 4.5 นาที (margin 1.5 นาที สำหรับ alert + cleanup)
  // [v5.5.2] try/catch + ใช้ flags timeGuard จาก stats โดยตรง
  const COMBINED_BUDGET_MS = 4.5 * 60 * 1000;
  const MASTER_BUDGET_MS = 2.5 * 60 * 1000;
  const MIN_REMAINING_MS = 30 * 1000;

  try {
    const wallStart = Date.now();
    const s1 = runMaster(Infinity, MASTER_BUDGET_MS);
    const elapsedMs = Date.now() - wallStart;
    const remainingMs = COMBINED_BUDGET_MS - elapsedMs;

    let s2, ranGeo = false;
    if (remainingMs < MIN_REMAINING_MS) {
      logRun_('uiRunMasterAndGeo', 'เวลาเหลือ ' + Math.round(remainingMs / 1000) + 's < 30s → ข้าม Geo ให้กดปุ่ม 3 แยก');
      s2 = { processed: 0, filled: 0, skipped: 0, skippedByTime: true, timeGuard: true };
    } else {
      s2 = runMasterGeo(remainingMs);
      ranGeo = true;
    }

    LAST_RESULT = { master: s1, geo: s2, combined: { budgetMs: COMBINED_BUDGET_MS, elapsedMs: elapsedMs, remainingMs: remainingMs } };
    saveLastResult_(LAST_RESULT);
    let msg = 'สะสม MASTER + เติม Geo เสร็จแล้ว\n' +
      '(ใช้เวลารวม ' + Math.round(elapsedMs / 1000) + 's จาก budget ' + Math.round(COMBINED_BUDGET_MS / 1000) + 's)\n\n' +
      '[ปุ่ม 1] ใหม่: ' + s1.newMaster + ' | อัปเดต: ' + s1.updated + ' | ข้าม: ' + (s1.skipped || 0) + '\n' +
      '[ปุ่ม 3] แมชต์: ' + (s2.filled || 0) + ' แถว | ข้าม: ' + (s2.skipped || 0) +
      ' | Y แช่แข็ง: ' + (s2.yFrozen || 0) + ' | Y อัปเกรด: ' + (s2.yUpgraded || 0);   // [v5.5.6 PATCH-6]
    if (s1.timeGuard) {
      msg += '\n\n⚠️ [ปุ่ม 1] TIME_GUARD — กดปุ่ม 1 อีกครั้งเพื่อทำต่อ';
    }
    if (!ranGeo) {
      msg += '\n\n⚠️ [ปุ่ม 3] ข้าม (เวลาไม่พอ) — กดปุ่ม 3 แยก';
    } else if (s2.timeGuard) {
      msg += '\n\n⚠️ [ปุ่ม 3] TIME_GUARD — กดปุ่ม 3 อีกครั้งเพื่อทำต่อ';
    }
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ปุ่ม 1+3 ล้มเหลว:\n' + (e && e.message ? e.message : e));
    throw e;
  }
}

function uiRunDailyMatch() {
  // [v5.5.2] try/catch + แสดง TIME_GUARD / index source / REVIEW สูง
  try {
    const stats = runDailyMatch();
    LAST_RESULT = stats;
    saveLastResult_(stats);
    let msg = 'แมชต์งานวันนี้เสร็จแล้ว\n' +
      'รวม ' + stats.total + ' งาน | FOUND ' + stats.found +
      ' | REVIEW ' + stats.review;
    if (stats.indexSource) {
      msg += '\nดัชนี: ' + stats.indexSource;
    }
    if (stats.timeGuard) {
      msg += '\n\n⚠️ TIME_GUARD: เวลาหมดก่อนจบ — กดปุ่ม 2 อีกครั้ง (แถวที่ยังไม่ทำจะคงค่าเดิม)';
    }
    if (stats.total > 0 && stats.found === 0 && stats.review > 0) {
      msg += '\n\nℹ️ ไม่มี FOUND — ตรวจว่าได้รันปุ่ม 1 สะสม MASTER แล้ว และ MATCH_KEY ตรงกัน';
    }
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ปุ่ม 2 ล้มเหลว:\n' + (e && e.message ? e.message : e));
    throw e;
  }
}

function uiShowResult() {
  // [v5.4.8 L-1 FIX] ลองอ่านจาก ScriptProperty ก่อน (คงอยู่ข้าม execution)
  const s = LAST_RESULT || loadLastResult_();
  if (!s) {
    SpreadsheetApp.getUi().alert('ยังไม่มีผลการรันล่าสุด (รันเลยครั้งแรก หรือหมดอายุ 24ชม.)');
    return;
  }
  let msg;
  if (s.master && s.geo) {
    msg = '1+3: ใหม่ ' + s.master.newMaster + ' | อัปเดต ' + s.master.updated +
      ' | ข้าม ' + (s.master.skipped || 0) + ' | แมชต์ Geo ' + s.geo.filled + ' แถว';
  } else if (s.processed !== undefined && s.newMaster !== undefined) {
    msg = 'Master: ประมวลผล ' + s.processed + ' | ใหม่ ' + s.newMaster + ' | อัปเดต ' + s.updated;
  } else if (s.filled !== undefined) {
    msg = 'Geo: ประมวลผล ' + s.processed + ' | เติมได้ ' + s.filled;
  } else {
    msg = 'Daily: รวม ' + s.total + ' | FOUND ' + s.found + ' | REVIEW ' + s.review;
  }
  SpreadsheetApp.getUi().alert('ผลล่าสุด:\n' + msg);
}

// ============================================
// [v5.4.8] New UI handlers
// ============================================

/**
 * uiSetScgCookie_ — ตั้ง SCG cookie ผ่าน UI → เก็บใน PropertiesService
 * [v5.4.8 H-2 FIX] เดิมเก็บใน Input!B1 (เปลือย) → ย้ายมา PropertiesService
 */
function uiSetScgCookie_() {
  // [v5.4.9] popup ใส่ cookie — ใช้เมื่อ cookie หมดอายุ / ต้องเปลี่ยนบ่อย (ไม่ใช้ Input!B1)
  const ui = SpreadsheetApp.getUi();
  try {
    if (typeof assertRole_ === 'function') assertRole_('editor');
  } catch (e) {
    ui.alert('❌ ' + e.message);
    return;
  }

  let statusLine = 'สถานะ: ยังไม่มี cookie';
  try {
    const cur = PropertiesService.getUserProperties().getProperty('SCG_COOKIE');
    if (cur && cur.length) {
      statusLine = 'สถานะ: มี cookie แล้ว (' + cur.length + ' ตัวอักษร) — วางอันใหม่เพื่อแทนที่';
    }
  } catch (e) {
    Logger.log('uiSetScgCookie_: status read failed: ' + (e && e.message ? e.message : e));
  }

  const v = ui.prompt(
    '🔑 SCG Cookie\n\n' +
    statusLine + '\n\n' +
    'วาง Cookie จาก Browser แล้วกด OK\n' +
    '• เก็บใน PropertiesService (เฉพาะบัญชีคุณ)\n' +
    '• ไม่เก็บในชีต Input!B1\n' +
    '• เว้นว่างแล้วกด OK = ลบ cookie ที่เก็บไว้\n' +
    '• เปลี่ยนใหม่ได้ทุกครั้งที่ session หมดอายุ',
    ui.ButtonSet.OK_CANCEL
  );
  if (v.getSelectedButton() !== ui.Button.OK) return;
  const cookie = String(v.getResponseText() || '').trim();

  if (typeof setScgCookie_ === 'function') {
    setScgCookie_(cookie);
  } else {
    const props = PropertiesService.getUserProperties();
    if (cookie) props.setProperty('SCG_COOKIE', cookie);
    else props.deleteProperty('SCG_COOKIE');
  }

  // ล้าง B1 ถ้ายังมีของเก่าค้าง
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const inputName = (typeof SCG_CONFIG !== 'undefined' && SCG_CONFIG.SHEET_INPUT)
      ? SCG_CONFIG.SHEET_INPUT
      : (SHEETS && SHEETS.INPUT ? SHEETS.INPUT : 'Input');
    const sh = ss.getSheetByName(inputName);
    if (sh) {
      const cell = (typeof SCG_CONFIG !== 'undefined' && SCG_CONFIG.COOKIE_CELL) ? SCG_CONFIG.COOKIE_CELL : 'B1';
      sh.getRange(cell).clearContent();
    }
  } catch (e) {
    Logger.log('uiSetScgCookie_: clear B1 residual failed: ' + (e && e.message ? e.message : e));
  }

  if (cookie) {
    ui.alert('✅ บันทึก SCG Cookie แล้ว (' + cookie.length + ' ตัวอักษร)\n\n' +
      'เมื่อหมดอายุ ให้เปิดเมนูนี้แล้ววาง cookie ใหม่');
  } else {
    ui.alert('✅ ลบ SCG Cookie แล้ว');
  }
}

/**
 * uiTrimPii_ — ลบ PII columns (เลขบัตร/เบอร์โทร) จากชีต "ข้อมูลพนักงาน"
 * [v5.4.8 M-4] manual operation — ไม่ auto-run
 */
function uiTrimPii_() {
  const ui = SpreadsheetApp.getUi();
  // [v5.5.1 AUDIT F-007] role guard
  try {
    if (typeof assertRole_ === 'function') assertRole_('editor');
  } catch (e) {
    ui.alert('❌ ' + e.message);
    return;
  }
  const confirm = ui.alert('🛡️ Trim PII\n\n' +
    'จะลบ columns ที่มีคำว่า: เลขบัตร, id_card, id card, เบอร์โทร, phone\n' +
    'จากชีต "' + (SHEETS && SHEETS.EMPLOYEE || 'ข้อมูลพนักงาน') + '"\n\n' +
    '⚠️ การลบไม่สามารถ undo ได้ — แนะนำ Backup ก่อน\n\n' +
    'ดำเนินการต่อ?',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  try {
    if (typeof trimPiiColumns_ === 'function') {
      const n = trimPiiColumns_();
      ui.alert('✅ ลบ PII columns แล้ว: ' + n + ' column(s)');
    } else {
      ui.alert('⚠️ trimPiiColumns_() ไม่มี — ยังไม่ implement');
    }
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}

/**
 * uiResetAllMasterRefs_ — ล้าง MASTER + SYS_MASTER_IDX + DAILY.MD_LINK (atomic)
 * [v5.4.8 M-12 FIX] เดิมล้าง MASTER แล้ว MD_ID เริ่ม MD-0001 → ทับ SYS_MASTER_IDX เก่า
 */
function uiResetAllMasterRefs_() {
  const ui = SpreadsheetApp.getUi();
  try {
    if (typeof assertRole_ === 'function') assertRole_('admin');
  } catch (e) {
    ui.alert('❌ ' + e.message);
    return;
  }
  const confirm = ui.alert('🗑️ Reset All Master Refs (DANGER)\n\n' +
    'จะล้าง:\n' +
    '• MASTER (ทั้งชีต ยกเว้น header)\n' +
    '• SYS_MASTER_IDX (ทั้งชีต)\n' +
    '• ตารางงานประจำวัน!MD_LINK / MATCH_KEY / LatLong_Actual\n\n' +
    '⚠️ การลบไม่สามารถ undo ได้ — แนะนำ Backup Sheet ทั้งหมดก่อน\n\n' +
    'ดำเนินการต่อ?',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  // ใช้ LockService กัน race
  let lock = null;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(30000);
  } catch (e) {
    ui.alert('❌ ไม่สามารถ lock ได้: ' + e.message);
    return;
  }

  try {
    if (typeof resetAllMasterRefs_ === 'function') {
      const r = resetAllMasterRefs_();
      ui.alert('✅ Reset All Master Refs แล้ว\n' +
        '• SOURCE helper: ' + (r.source || 0) + ' cols\n' +
        '• MASTER: ' + (r.master || 0) + ' แถว\n' +
        '• SYS_MASTER_IDX: ' + (r.idx || 0) + ' แถว\n' +
        '• ตารางงานประจำวัน: ' + (r.daily || 0) + ' cols');
    } else {
      ui.alert('⚠️ resetAllMasterRefs_() ไม่มี — ยังไม่ implement (ต้อง stub ใน 01_MasterService.gs)');
    }
  } catch (e) {
    ui.alert('❌ ' + e.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
