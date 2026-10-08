/**
 * SetupService — ตรวจสอบโครงสร้างเท่านั้น (audit)
 * สำคัญ: ไฟล์นี้ไม่มีคำสั่งเขียน/แก้/ลบหัวคอลัมน์ลงชีต
 *
 * v5.3.1+ : ใช้ SHEETS.* จาก 00_Config.gs
 * v5.4.4  : ตรวจชีตครบ + เทียบ header สำคัญ (รายงานอย่างเดียว)
 */

/** หัวคอลัมน์ที่จำเป็นต่อชีตหลัก — ขาดแล้ว logic ปุ่มอาจพัง */
var SETUP_REQUIRED_HEADERS_ = {};
SETUP_REQUIRED_HEADERS_[SHEETS.SOURCE] = [
  'ชื่อปลายทาง', 'ที่อยู่ปลายทาง', 'ชื่อเจ้าของสินค้า', 'LAT', 'LONG',
  'MD_LINK', 'MATCH_KEY', 'POINTS_AT_TIME', 'STATUS'
];
SETUP_REQUIRED_HEADERS_[SHEETS.DAILY] = [
  'ShipToName', 'ShipToAddress', 'SoldToName',
  'LatLong_Actual', 'MATCH_KEY', 'MD_ID', 'LatLong_Actual_Status'
];
SETUP_REQUIRED_HEADERS_[SHEETS.MASTER] = [
  'MD_ID', 'MATCH_KEY', 'NAME_CLEAN', 'ADDR_CLEAN', 'OWNER_CLEAN',
  'LAT', 'LNG', 'POINTS', 'FIRST_SEEN', 'LAST_SEEN', 'STATUS',
  'PROVINCE', 'AMPHOE', 'CONFIRMED_BY', 'REVIEW_NOTE',
  'Rahatpraisanee', 'Changwat', 'Amphoe_Khet', 'Tambon_Kwaeng',
  'Reversegeocode', 'Calculatedistances', 'GEO_LAYER'
];
// GEO_DICT: ตรวจจำนวนคอลัมน์อย่างน้อย 32 (ไม่ผูกชื่อ header ไทย/EN ทั้งหมด)

/**
 * runSetup — audit ทุกชีตใน SHEETS + เทียบ header สำคัญ
 * @returns {{ok:boolean, sheets:Array, missingHeaders:Array, infos:Array}}
 */
function runSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = {
    ok: true,
    sheets: [],
    missingHeaders: [],
    infos: []
  };

  Object.keys(SHEETS).forEach(function (key) {
    const name = SHEETS[key];
    const sh = ss.getSheetByName(name);
    if (!sh) {
      // SYS_MASTER_IDX ยังไม่มีได้ — ปุ่ม 1 / เมนูซ่อมดัชนี จะสร้างให้
      if (name === SHEETS.MASTER_IDX) {
        result.sheets.push({ name: name, exists: false, columns: 0, headers: [], missing: [] });
        result.infos.push('⚠️ ยังไม่มีชีต: ' + name + ' (จะถูกสร้างเมื่อรันปุ่ม 1 หรือเมนูซ่อมดัชนี)');
        return;
      }
      result.ok = false;
      result.sheets.push({ name: name, exists: false, columns: 0, headers: [] });
      result.infos.push('❌ ไม่พบชีต: ' + name);
      return;
    }

    const lastCol = sh.getLastColumn();
    const headers = lastCol >= 1
      ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); })
      : [];
    const headerSet = {};
    headers.forEach(function (h) { if (h) headerSet[h] = true; });

    const entry = {
      name: name,
      exists: true,
      columns: headers.length,
      headers: headers,
      missing: []
    };

    const required = SETUP_REQUIRED_HEADERS_[name];
    if (required) {
      required.forEach(function (h) {
        if (!headerSet[h]) {
          entry.missing.push(h);
          result.missingHeaders.push(name + ' → ขาด "' + h + '"');
          result.ok = false;
        }
      });
    }

    // GEO_DICT: อย่างน้อย 32 คอลัมน์
    if (name === SHEETS.GEO_DICT && headers.length < 32) {
      entry.missing.push('(ต้องการอย่างน้อย 32 คอลัมน์, มี ' + headers.length + ')');
      result.missingHeaders.push(name + ' → คอลัมน์ไม่ครบ 32 (มี ' + headers.length + ')');
      result.ok = false;
    }

    // SYS_MASTER_IDX: ถ้ามีแล้ว ตรวจหัว 5 คอลัมน์ (ยังไม่มี = เตือน ไม่ fail — ปุ่ม 1 จะสร้างให้)
    if (name === SHEETS.MASTER_IDX) {
      const need = MASTER_IDX_SHEET_HEADERS;
      need.forEach(function (h) {
        if (!headerSet[h]) {
          entry.missing.push(h);
          result.missingHeaders.push(name + ' → ขาด "' + h + '"');
          result.ok = false;
        }
      });
    }

    // DAILY: แนะนำ 32 คอลัมน์ (ไม่ fail ถ้ามี header สำคัญครบ)
    if (name === SHEETS.DAILY && headers.length < 32) {
      result.infos.push('⚠️ ' + name + ': มี ' + headers.length + ' คอลัมน์ (คาดหวัง 32)');
    }

    result.sheets.push(entry);
    if (entry.missing.length) {
      result.infos.push('❌ ' + name + ': ขาด header → ' + entry.missing.join(', '));
    } else {
      result.infos.push('✅ ' + name + ' (' + sh.getLastRow() + ' × ' + headers.length + ')');
    }
  });

  logRun_('auditSetup', result.ok
    ? 'ตรวจโครงสร้าง OK — ชีตครบ + header สำคัญครบ (ไม่ได้แก้หัวคอลัมน์)'
    : 'ตรวจโครงสร้างพบปัญหา: ' + result.missingHeaders.join(' | '));
  return result;
}

function uiRunSetup() {
  const r = runSetup();
  let msg = r.ok
    ? '✅ ตรวจสอบโครงสร้างเสร็จ — พร้อมใช้งาน\n\n'
    : '❌ ตรวจสอบโครงสร้างพบปัญหา\n\n';
  msg += r.infos.join('\n');
  if (r.missingHeaders.length) {
    msg += '\n\nรายการที่ขาด:\n- ' + r.missingHeaders.join('\n- ');
  }
  msg += '\n\nไม่มีการสร้าง เปลี่ยน หรือลบหัวคอลัมน์ครับ';
  SpreadsheetApp.getUi().alert(msg);
}
