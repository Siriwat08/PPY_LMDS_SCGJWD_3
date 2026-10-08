/**
 * ============================================================================
 *  00_Config.gs — Central Configuration (10 SHEETS)
 *  Phaopanya Master Data — SCG/JWD Logistics Matching
 * ----------------------------------------------------------------------------
 *  รวมชื่อชีต + index คอลัมน์ + ค่าคงที่ทั้งหมดไว้ที่เดียว
 *
 *  โครงสร้าง:
 *    SHEETS          — รายชื่อ 10 ชีต (ที่ใช้จริงในสคริปต์)
 *    SHEET_INFO      — metadata ของแต่ละชีต (rows, cols, purpose)
 *    *_IDX           — index คอลัมน์ของแต่ละชีต (0-based)
 *
 *  หลักการ:
 *    - ชื่อชีตอ้างจาก SHEETS.*
 *    - Index ของ "ตารางงานประจำวัน" + "MASTER_PLACE" + "SCGนครหลวง..." ใช้
 *      dynamic header (headerMap_) เป็นหลักอยู่แล้ว เพราะผู้ใช้อาจแทรกคอลัมน์
 *    - *_IDX ด้านล่างเป็น "ค่า default" — verify ตอน validateConfig_() เท่านั้น
 *    - ไฟล์ 01-05 ยังใช้ hard-coded `r[5]` บางส่วน ซึ่ง "ดีอยู่แล้ว" ตามที่ผู้ใช้สั่ง
 *      (ถ้าจะ refactor ในอนาคต → ใช้ MASTER_IDX แทน r[5] ฯลฯ)
 *    - ประวัติแก้โค้ดเก็บในไฟล์ Drive Phaopanya_CodeChangelog.txt (ไม่ใช้ชีต)
 * ============================================================================
 */

// ============================================
//  1. SHEET NAMES (10 sheets)
// ============================================
const SHEETS = {
  // ต้นทาง + ปลายทางหลัก
  SOURCE:           'SCGนครหลวงJWDภูมิภาค',   // #1 ต้นทาง Appsheet
  DAILY:            'ตารางงานประจำวัน',         // #2 งานประจำวัน (32 cols)
  MASTER:           'MASTER_PLACE',              // #3 ฐานข้อมูลหลัก (27 cols)

  // ตั้งค่า + พจนานุกรม
  SETTINGS:         'การตั้งค่า',                // #4 Log (read-only)
  GEO_DICT:         'SYS_TH_GEO',                // #5 พจนานุกรม 7,537 × 32

  // สรุป
  SUMMARY_OWNER:    'สรุป_เจ้าของสินค้า',        // #6 (6 cols)
  SUMMARY_SHIP:     'สรุป_Shipment',             // #7 (7 cols)

  // Helper
  INPUT:            'Input',                     // #8 Cookie + Shipment
  EMPLOYEE:         'ข้อมูลพนักงาน',             // #9 RBAC
  MASTER_IDX:       'SYS_MASTER_IDX'             // #10 ดัชนีเบาสำหรับปุ่ม 2 (upsert ไม่ลบทั้งชีต)
};

// ============================================
//  2. SHEET INFO (metadata)
// ============================================
const SHEET_INFO = {
  SOURCE:        { num:  1, rows: 2001, cols: 41, purpose: 'ต้นทาง Appsheet (ฟอร์มคนขับ)' },
  DAILY:         { num:  2, rows:    1, cols: 32, purpose: 'งานประจำวัน (โหลดจาก API / ปุ่ม 2)' },
  MASTER:        { num:  3, rows: 1001, cols: 27, purpose: 'ฐานข้อมูลสถานที่มาตรฐาน' },
  SETTINGS:      { num:  4, rows:    7, cols:  6, purpose: 'Log การตั้งค่าระบบ (read-only)' },
  GEO_DICT:      { num:  5, rows: 7538, cols: 32, purpose: 'พจนานุกรมจังหวัด/อำเภอ/ตำบล (TH+EN)' },
  SUMMARY_OWNER: { num:  6, rows: 1000, cols:  6, purpose: 'สรุปตามชื่อเจ้าของสินค้า' },
  SUMMARY_SHIP:  { num:  7, rows:  999, cols:  7, purpose: 'สรุปตาม Shipment No' },
  INPUT:         { num:  8, rows: 1022, cols:  2, purpose: 'Cookie/session สำหรับดึงข้อมูล' },
  EMPLOYEE:      { num:  9, rows:   24, cols:  8, purpose: 'รายชื่อพนักงาน + บทบาท (RBAC)' },
  MASTER_IDX:    { num: 10, rows:    1, cols:  5, purpose: 'ดัชนี MATCH_KEY→MD_ID/LAT/LNG สำหรับปุ่ม 2' }
};

// ============================================
//  3. SCG (SCG/JWD API) CONFIG
//    ใช้กับปุ่ม "📦 โหลดข้อมูล SCG" — ดู Service_SCG.gs
// ============================================
const SCG_CONFIG = {
  // ---- API & input ----
  SHEET_INPUT:           SHEETS.INPUT,
  COOKIE_CELL:           'B1',
  SHIPMENT_STRING_CELL:  'B3',
  INPUT_START_ROW:       4,

  // ---- API endpoint ----
  API_URL:               'https://fsm.scgjwd.com/Monitor/SearchDelivery',
  API_MAX_RETRIES:       3,

  // ---- ชีตปลายทาง ----
  SHEET_DATA:            SHEETS.DAILY,           // 32 cols
  SHEET_EMPLOYEE:        SHEETS.EMPLOYEE,
  SHEET_DRIVER:          SHEETS.SOURCE,

  // ---- Summary sheets ----
  SHEET_SUMMARY_OWNER:   SHEETS.SUMMARY_OWNER,
  SHEET_SUMMARY_SHIP:    SHEETS.SUMMARY_SHIP,

  // ---- Log sheet ----
  SHEET_LOG:             SHEETS.SETTINGS
};

// ============================================
//  4. DATA SHEET INDEX — "ตารางงานประจำวัน" (32 คอลัมน์, 0-based)
//    ใช้กับ Service_SCG.gs + ปุ่ม 2
// ============================================
const DATA_IDX = {
  JOB_ID:           0,    // A  ID_งานประจำวัน
  PLAN_DELIVERY:    1,    // B  PlanDelivery
  INVOICE_NO:       2,    // C  InvoiceNo
  SHIPMENT_NO:      3,    // D  ShipmentNo
  DRIVER_NAME:      4,    // E  DriverName
  TRUCK_LICENSE:    5,    // F  TruckLicense
  CARRIER_CODE:     6,    // G  CarrierCode
  CARRIER_NAME:     7,    // H  CarrierName
  SOLD_TO_CODE:     8,    // I  SoldToCode
  SOLD_TO_NAME:     9,    // J  SoldToName
  SHIP_TO_NAME:     10,   // K  ShipToName
  SHIP_TO_ADDR:     11,   // L  ShipToAddress
  LATLNG_SCG:       12,   // M  LatLong_SCG
  MATERIAL:         13,   // N  MaterialName
  QTY:              14,   // O  ItemQuantity
  QTY_UNIT:         15,   // P  QuantityUnit
  WEIGHT:           16,   // Q  ItemWeight
  DELIVERY_NO:      17,   // R  DeliveryNo
  DEST_COUNT:       18,   // S  จำนวนปลายทาง_System
  DEST_LIST:        19,   // T  รายชื่อปลายทาง_System
  SCAN_STATUS:      20,   // U  ScanStatus
  DELIVERY_STATUS:  21,   // V  DeliveryStatus
  EMAIL:            22,   // W  Email พนักงาน
  TOT_QTY:          23,   // X  จำนวนสินค้ารวมของร้านนี้
  TOT_WEIGHT:       24,   // Y  น้ำหนักสินค้ารวมของร้านนี้
  SCAN_INV:         25,   // Z  จำนวน_Invoice_ที่ต้องสแกน
  LATLNG_ACTUAL:    26,   // AA LatLong_Actual (ปุ่ม 2 เติม)
  OWNER_LABEL:      27,   // AB ชื่อเจ้าของสินค้า_Invoice_ที่ต้องสแกน
  SHOP_KEY:         28,   // AC ShopKey
  // [v5.4.1+] 32 คอลัมน์ — MATCH_KEY สร้างตอนโหลด SCG / ปุ่ม 2 lookup + เติม MD_ID/Status
  MATCH_KEY:        29,   // AD MATCH_KEY (SCG โหลดเขียน / ปุ่ม 2 ใช้ lookup)
  MD_ID:            30,   // AE MD_ID (ปุ่ม 2 เขียน)
  STATUS:           31,   // AF LatLong_Actual_Status (ปุ่ม 2 เขียน)
  TOTAL_COLS:       32
};
const DATA_HEADERS = [
  'ID_งานประจำวัน', 'PlanDelivery', 'InvoiceNo', 'ShipmentNo', 'DriverName',
  'TruckLicense', 'CarrierCode', 'CarrierName', 'SoldToCode', 'SoldToName',
  'ShipToName', 'ShipToAddress', 'LatLong_SCG', 'MaterialName', 'ItemQuantity',
  'QuantityUnit', 'ItemWeight', 'DeliveryNo', 'จำนวนปลายทาง_System', 'รายชื่อปลายทาง_System',
  'ScanStatus', 'DeliveryStatus', 'Email พนักงาน',
  'จำนวนสินค้ารวมของร้านนี้', 'น้ำหนักสินค้ารวมของร้านนี้', 'จำนวน_Invoice_ที่ต้องสแกน',
  'LatLong_Actual', 'ชื่อเจ้าของสินค้า_Invoice_ที่ต้องสแกน', 'ShopKey',
  // [v5.4.1 P1-1 FIX] เพิ่ม 3 headers นี้ — เพื่อให้ runDailyMatch ไม่ throw missing header
  'MATCH_KEY', 'MD_ID', 'LatLong_Actual_Status'
];

// ============================================
//  5. MASTER_PLACE INDEX (27 คอลัมน์, 0-based)
//    ใช้เป็น default — ไฟล์ 01-05 ส่วนใหญ่อ่าน header แบบ dynamic
//    อยู่แล้ว (headerMap_) — *_IDX นี้ใช้ verify / เขียนเอกสาร
// ============================================
const MASTER_IDX = {
  MD_ID:              0,    // A  MD_ID
  MATCH_KEY:          1,    // B  MATCH_KEY
  NAME_CLEAN:         2,    // C  NAME_CLEAN
  ADDR_CLEAN:         3,    // D  ADDR_CLEAN
  OWNER_CLEAN:        4,    // E  OWNER_CLEAN
  LAT:                5,    // F  LAT
  LNG:                6,    // G  LNG
  POINTS:             7,    // H  POINTS
  FIRST_SEEN:         8,    // I  FIRST_SEEN
  LAST_SEEN:          9,    // J  LAST_SEEN
  STATUS:            10,    // K  STATUS
  RAW_NAMES:         11,    // L  RAW_NAMES
  RAW_ADDRS:         12,    // M  RAW_ADDRS
  PROVINCE:          13,    // N  PROVINCE (จากที่อยู่ปลายทาง)
  AMPHOE:            14,    // O  AMPHOE (จากที่อยู่ปลายทาง)
  CONFIRMED_BY:      15,    // P  CONFIRMED_BY
  REVIEW_NOTE:       16,    // Q  REVIEW_NOTE
  FIRST_LAT:         17,    // R  FIRST_LAT
  FIRST_LNG:         18,    // S  FIRST_LNG
  UPDATED_AT:        19,    // T  UPDATED_AT
  // ปุ่ม 3 เติม (U-AA)
  RAHATPRAISANEE:    20,    // U  Rahatpraisanee (รหัสไปรษณีย์)
  CHANGWAT:          21,    // V  Changwat (จังหวัด)
  AMPHOE_KHET:       22,    // W  Amphoe_Khet
  TAMBON_KWAENG:     23,    // X  Tambon_Kwaeng
  REVERSEGEOCODE:    24,    // Y  Reversegeocode
  CALCULATEDISTANCES:25,    // Z  Calculatedistances
  GEO_LAYER:         26,    // AA GEO_LAYER
  TOTAL_COLS:        27
};
const MASTER_HEADERS = [
  'MD_ID', 'MATCH_KEY', 'NAME_CLEAN', 'ADDR_CLEAN', 'OWNER_CLEAN',
  'LAT', 'LNG', 'POINTS', 'FIRST_SEEN', 'LAST_SEEN', 'STATUS',
  'RAW_NAMES', 'RAW_ADDRS', 'PROVINCE', 'AMPHOE', 'CONFIRMED_BY', 'REVIEW_NOTE',
  'FIRST_LAT', 'FIRST_LNG', 'UPDATED_AT',
  'Rahatpraisanee', 'Changwat', 'Amphoe_Khet', 'Tambon_Kwaeng',
  'Reversegeocode', 'Calculatedistances', 'GEO_LAYER'
];
// ⚠️ หมายเหตุ: 01_MasterService.gs ใช้ MASTER_COLS = 20 (แค่ 20 คอลัมน์แรก)
//    ส่วน U-AA เป็นของปุ่ม 3 (runMasterGeo) — ไม่นับรวมใน MASTER_COLS
const MASTER_COLS_LEGACY = 20;

// ============================================
//  5b. SYS_MASTER_IDX — ดัชนีเบาสำหรับปุ่ม 2 (5 คอลัมน์)
//      ปุ่ม 1 upsert แถว (อัปเดตตาม MD_ID / เพิ่มแถวใหม่) — ไม่ลบทั้งชีต
//      ปุ่ม 2 อ่านชีตนี้แทนการโหลด MASTER ทั้งแผ่น
// ============================================
const MASTER_IDX_SHEET_HEADERS = ['MD_ID', 'MATCH_KEY', 'ALIAS_KEY', 'LAT', 'LNG'];
const MASTER_IDX_SHEET = {
  MD_ID:      0,  // A  unique key สำหรับ upsert
  MATCH_KEY:  1,  // B  exact key
  ALIAS_KEY:  2,  // C  alias key (ลบช่องว่าง/-)
  LAT:        3,  // D
  LNG:        4,  // E
  TOTAL_COLS: 5
};


// ============================================
//  6. SOURCE INDEX — "SCGนครหลวงJWDภูมิภาค" (41 คอลัมน์, 0-based)
//    ไฟล์ 01_MasterService ใช้ dynamic header อยู่แล้ว
// ============================================
const SOURCE_IDX = {
  HEAD:           0,   // A
  ID:             1,   // B  ID_SCGนครหลวงJWDภูมิภาค
  DATE:           2,   // C  วันที่ส่งสินค้า
  TIME:           3,   // D  เวลาที่ส่งสินค้า
  SHIP_TO_NAME:   4,   // E  จุดส่งสินค้าปลายทาง (ชื่อร้าน)
  DRIVER_NAME:    5,   // F  ชื่อ - นามสกุล
  TRUCK:          6,   // G  ทะเบียนรถ
  SHIPMENT_NO:    7,   // H  Shipment No
  INVOICE_NO:     8,   // I  Invoice No
  // J-N: (รูปภาพ/รหัสลูกค้า/ชื่อเจ้าของ/ชื่อปลายทาง/Email)
  LAT:           14,   // O  LAT
  LONG:          15,   // P  LONG
  // Q-V: (เอกสาร/รูป/หมายเหตุ)
  MONTH:         22,   // W  เดือน
  DIST_KM:       23,   // X  ระยะทางจากคลัง_Km
  GEOG_ADDR:     24,   // Y  ชื่อที่อยู่จาก_LatLong
  // Z-AB: (SM_Link / ID_พนักงาน / พิกัดตอนกดบันทึก)
  // AC-AD: (เวลาเริ่ม/เวลาบันทึก)
  // AE-AG: (ระยะขยับ/เวลาใช้งาน/ความเร็ว)
  // AH-AI: (ผลตรวจ/เหตุผิดปกติ/เวลาถ่ายรูป)
  // AJ: (เวลาถ่ายรูปหน้าร้าน)
  SYNC_STATUS:   36,   // AK SYNC_STATUS
  MD_LINK:       37,   // AL MD_LINK
  MATCH_KEY:     38,   // AM MATCH_KEY
  POINTS_AT_TIME:39,   // AN POINTS_AT_TIME
  STATUS:        40,   // AO STATUS
  TOTAL_COLS:    41
};

// ============================================
//  7. GEO DICT INDEX — "SYS_TH_GEO" (32 คอลัมน์, 0-based)
//    ใช้ใน 04_GeoService.gs (เป็น source of truth แทน GEO_COL เก่า)
//
//    ⚠️ GEO_COL ใน 04_GeoService.gs ยังคงอยู่เพื่อ backward compat
//       แต่มี key subset เหมือนกับ GEO_DICT_IDX — ค่าตัวเลขตรงกัน 100%
//       ถ้าจะ refactor 04: เปลี่ยน GEO_COL.POSTAL → GEO_DICT_IDX.POSTAL
// ============================================
const GEO_DICT_IDX = {
  // Thai columns (A-P, 16 cols)
  POSTAL:                 0,   // A
  TAMBON_FULL:            1,   // B
  AMPHOE_RAW:             2,   // C
  PROVINCE_FULL:          3,   // D  (alias: PROVINCE_CLEAN ใน 04_GeoService)
  PROVINCE_CLEAN:         3,   // D  ★ alias สำหรับ 04_GeoService.gs (GEO_COL)
  NOTE:                   4,   // E
  TAMBON_CLEAN:           5,   // F
  AMPHOE_CLEAN:           6,   // G
  TAMBON_LABEL:           7,   // H
  AMPHOE_LABEL:           8,   // I
  TAMBON_NORM:            9,   // J
  AMPHOE_NORM:           10,   // K
  PROVINCE_NORM:         11,   // L
  SEARCH_KEY:            12,   // M
  POSTAL_KEY:            13,   // N
  NOTE_TYPE:             14,   // O  ★ CHECK_NOTE handling
  NOTE_SCOPE:            15,   // P
  // English columns (Q-AF, 16 cols)
  POSTCODE_EN:           16,   // Q
  SUBDISTRICT_EN:        17,   // R
  DISTRICT_EN:           18,   // S
  PROVINCE_EN:           19,   // T
  NOTE_EN:               20,   // U
  SUBDISTRICT_CLEAN_EN:  21,   // V
  DISTRICT_CLEAN_EN:     22,   // W
  SUBDISTRICT_LABEL_EN:  23,   // X
  DISTRICT_LABEL_EN:     24,   // Y
  TAMBON_NORM_EN:        25,   // Z
  AMPHOE_NORM_EN:        26,   // AA
  PROVINCE_NORM_EN:      27,   // AB
  SEARCH_KEY_EN:         28,   // AC
  POSTAL_KEY_EN:         29,   // AD
  NOTE_TYPE_EN:          30,   // AE ★ CHECK_NOTE_EN handling
  NOTE_SCOPE_EN:         31,   // AF
  TOTAL_COLS:            32
};

// ============================================
//  8. SUMMARY: เจ้าของสินค้า (6 คอลัมน์, 0-based)
// ============================================
const SUMMARY_OWNER_IDX = {
  KEY:          0,  // A  SummaryKey
  SOLD_TO_NAME: 1,  // B  SoldToName
  PLAN_DELIVERY:2,  // C  PlanDelivery
  TOTAL:        3,  // D  จำนวน_ทั้งหมด
  EPOD:         4,  // E  จำนวน_E-POD_ทั้งหมด
  LAST_UPDATED: 5   // F  LastUpdated
};

// ============================================
// 10. SUMMARY: Shipment (7 คอลัมน์, 0-based)
// ============================================
const SUMMARY_SHIP_IDX = {
  KEY:          0,  // A  ShipmentKey
  SHIPMENT_NO:  1,  // B
  TRUCK:        2,  // C
  PLAN_DELIVERY:3,  // D
  TOTAL:        4,  // E  จำนวน_ทั้งหมด
  EPOD:         5,  // F  จำนวน_E-POD_ทั้งหมด
  LAST_UPDATED: 6   // G
};

// ============================================
// 11. EMPLOYEE INDEX (8 คอลัมน์, 0-based)
// ============================================
const EMPLOYEE_IDX = {
  ID:        0,   // A
  NAME:      1,   // B  ★ map key
  PHONE:     2,   // C
  ID_CARD:   3,   // D
  TRUCK:     4,   // E
  CAR_TYPE:  5,   // F
  EMAIL:     6,   // G  ★ mapped value
  ROLE:      7    // H
};

// ============================================
// 12. INPUT INDEX (1 คอลัมน์, 0-based)
//    A1 = COOKIE  (B1 คือ cookie value, A4+ คือ Shipment No)
// ============================================
const INPUT_IDX = {
  SHIPMENT_NO:  0,   // A
  COOKIE:       1,   // B  (เซลล์ B1)
  TOTAL_COLS:   2
};

// ============================================
// 13. SETTINGS INDEX (3 คอลัมน์, 0-based)
//    ใช้สำหรับ log
// ============================================
const SETTINGS_IDX = {
  TIMESTAMP: 0,   // A  วันที่เวลา
  ITEM:      1,   // B  รายการ (function name)
  DETAIL:    2    // C  รายละเอียด
};

// ============================================
// 14. CONSTANTS
// ============================================
const FETCH_MAX_MS = 5 * 60 * 1000;
const DEFAULT_SCAN_STATUS     = 'รอสแกน';
const DEFAULT_DELIVERY_STATUS = 'ยังไม่ได้ส่ง';

const MASTER_TOTAL_COLS_PHASE1 = 20;  // 01_MasterService (A-T)
const MASTER_TOTAL_COLS_PHASE3 = 27;  // 04_GeoService (A-AA)

// Cache keys (กำหนดใน 04_GeoService.gs — ไม่ประกาศซ้ำที่นี่)
// TH_GEO_CACHE_KEY_TH = 'geo_v53_th_idx'
// TH_GEO_CACHE_KEY_EN = 'geo_v53_en_idx'

// ============================================
// 15. HEADER DYNAMIC READER
//    headerMap_() และ requireHeader_() ถูก define ไว้แล้วใน
//    01_MasterService.gs — ไม่ define ซ้ำ
//    readHeaderMap_() เป็น wrapper สำหรับอ่าน header row
// ============================================
function readHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    throw new Error('ชีต "' + sheet.getName() + '" ว่างเปล่า');
  }
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  return headerMap_(headers);
}

// ============================================
// 16. VALIDATE CONFIG
//    ตรวจว่าทุกชีตมีอยู่จริง + header ตรงตาม *_HEADERS ที่กำหนด
// ============================================
function validateConfig_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const errors = [];
  const infos = [];

  // ตรวจชีตครบ
  Object.keys(SHEETS).forEach(function (key) {
    const name = SHEETS[key];
    const sh = ss.getSheetByName(name);
    if (!sh) {
      errors.push('❌ ไม่พบชีต: "' + name + '"');
    } else {
      infos.push('✅ ' + name + ' (' + sh.getLastRow() + ' × ' + sh.getLastColumn() + ')');
    }
  });

  return {
    ok: errors.length === 0,
    errors: errors,
    infos: infos
  };
}

// validate เฉพาะ SCG (สำหรับ Service_SCG.gs)
function validateSCGConfig_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const missing = [];

  [SCG_CONFIG.SHEET_INPUT,
   SCG_CONFIG.SHEET_DATA,
   SCG_CONFIG.SHEET_EMPLOYEE,
   SCG_CONFIG.SHEET_SUMMARY_OWNER,
   SCG_CONFIG.SHEET_SUMMARY_SHIP,
   SCG_CONFIG.SHEET_LOG
  ].forEach(function (name) {
    if (!ss.getSheetByName(name)) missing.push(name);
  });

  if (missing.length > 0) {
    throw new Error('CRITICAL: ไม่พบชีต: ' + missing.join(', ') +
      '\nโปรดตรวจสอบ SHEETS_REFERENCE.md');
  }
  return true;
}

// ============================================
// 17. UI: แสดงผล validate
// ============================================
function uiRunValidateConfig() {
  const result = validateConfig_();
  let msg = '';
  if (result.ok) {
    msg = '✅ CONFIG OK — ทุกชีตพร้อมใช้งาน\n\n';
  } else {
    msg = '❌ CONFIG FAILED — มีปัญหา:\n\n';
  }
  msg = msg + result.infos.join('\n') + '\n';
  if (result.errors.length > 0) {
    msg = msg + '\n' + result.errors.join('\n');
  }
  SpreadsheetApp.getUi().alert(msg);
}

// (ไม่มีฟังก์ชัน CONFIG SNAPSHOT — ใช้ uiRunValidateConfig + SHEETS_REFERENCE.md แทน)

// ============================================
// [v5.4.8 NEW] RBAC + Security + PII helpers
// ============================================

/**
 * ROLE_MAP — map role name → list of allowed emails
 * [v5.4.8 M-3 FIX] เดิม RBAC มีแค่ในเอกสาร ไม่มี enforcement
 *
 * วิธีใช้: เพิ่ม email ของ admin/editor ใน role ที่ต้องการ
 * ถ้า ROLE_MAP ว่างทั้งก้อน → ยังไม่ enforce (ระบบใช้ได้)
 * พอใส่ email ใน admin/editor แล้ว → enforce จริง (deny คนนอก list)
 */
const ROLE_MAP = {
  admin:  [],  // เพิ่ม email admin ตรงนี้
  editor: [],  // เพิ่ม email editor ตรงนี้
  viewer: []   // default — ทุกคนที่ไม่ได้อยู่ใน admin/editor
};

/**
 * assertRole_ — ตรวจว่า user มี role ที่ต้องการหรือไม่
 * @param {string} requiredRole - 'admin' | 'editor' | 'viewer'
 * @throws ถ้า role ไม่ match
 */
function assertRole_(requiredRole) {
  if (!requiredRole) return;
  // [v5.5.1 AUDIT F-002] ROLE_MAP ว่าง = ยังไม่ enforce (ระบบใช้ได้)
  // เมื่อตั้ง ROLE_MAP แล้ว → fail-closed ถ้าไม่มี email / ไม่อยู่ใน list
  let email = '';
  try {
    const active = Session.getActiveUser();
    if (active) email = String(active.getEmail() || '').toLowerCase().trim();
  } catch (e) {
    Logger.log('assertRole_: cannot get active user: ' + e.message);
  }

  const admins = (ROLE_MAP && ROLE_MAP.admin) ? ROLE_MAP.admin : [];
  const editors = (ROLE_MAP && ROLE_MAP.editor) ? ROLE_MAP.editor : [];
  const rbacConfigured = (admins.length > 0) || (editors.length > 0);

  if (!rbacConfigured) {
    Logger.log('assertRole_: ROLE_MAP ว่าง — allowing ' + requiredRole +
      ' (ใส่ email ใน ROLE_MAP เมื่อต้องการ enforce)');
    return;
  }

  // RBAC เปิดแล้ว: ไม่มี email = DENY (fail-closed)
  if (!email) {
    throw new Error('Permission denied: requires role "' + requiredRole +
      '" — cannot identify active user email. Add your account to ROLE_MAP or check script sharing.');
  }

  if (admins.indexOf(email) >= 0) return;
  if (requiredRole === 'editor' && editors.indexOf(email) >= 0) return;
  if (requiredRole === 'viewer') return;

  const allowed = (ROLE_MAP && ROLE_MAP[requiredRole]) ? ROLE_MAP[requiredRole] : [];
  if (allowed.indexOf(email) < 0) {
    throw new Error('Permission denied: requires role "' + requiredRole +
      '" — current user "' + email + '" not in allowlist. ' +
      'Add email to ROLE_MAP.' + requiredRole + ' in 00_Config.gs');
  }
}

/**
 * setScgCookie_ — เก็บ SCG cookie ใน PropertiesService (per-user)
 * [v5.4.8 H-2 FIX] เดิมเก็บใน Input!B1 (ทุกคนเห็น) → ย้ายมา user properties
 * @param {string} cookie - cookie value (empty = delete)
 */
function setScgCookie_(cookie) {
  const props = PropertiesService.getUserProperties();
  if (!cookie) {
    props.deleteProperty('SCG_COOKIE');
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sh = ss.getSheetByName(SCG_CONFIG.SHEET_INPUT);
      if (sh) sh.getRange(SCG_CONFIG.COOKIE_CELL).clearContent();
    } catch (e) {
      // [v5.5.2] ไม่กลืนเงียบ — log ไว้ไล่ B1 ค้าง
      Logger.log('setScgCookie_: clear B1 failed: ' + (e && e.message ? e.message : e));
    }
    return false;
  }
  if (typeof cookie !== 'string' || cookie.length < 10) {
    throw new Error('SCG cookie ดูสั้นผิดปกติ (' + cookie.length + ' chars) — ตรวจอีกครั้ง');
  }
  props.setProperty('SCG_COOKIE', cookie);
  // ล้าง residual บนชีตเมื่อย้ายเข้า Properties แล้ว
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SCG_CONFIG.SHEET_INPUT);
    if (sh) sh.getRange(SCG_CONFIG.COOKIE_CELL).clearContent();
  } catch (e) {
    Logger.log('setScgCookie_: clear B1 after set failed: ' + (e && e.message ? e.message : e));
  }
  return true;
}

/**
 * getScgCookie_ — อ่าน SCG cookie (per-user, fallback ไปชีต)
 */
function getScgCookie_() {
  // [v5.4.9 F-003] PropertiesService ก่อน — ถ้ายังมีในชีต ให้ย้ายเข้า Properties แล้วล้าง B1 (ไม่เก็บ cookie บนชีต)
  try {
    const props = PropertiesService.getUserProperties();
    const v = props.getProperty('SCG_COOKIE');
    if (v) return v;
  } catch (e) {
    // [v5.5.2] log แทน catch ว่าง — ไล่ได้เมื่อ Properties พัง
    Logger.log('getScgCookie_: UserProperties read failed: ' + (e && e.message ? e.message : e));
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SCG_CONFIG.SHEET_INPUT);
    if (sh) {
      const v = String(sh.getRange(1, 2).getValue() || '').trim();
      if (v) {
        try {
          PropertiesService.getUserProperties().setProperty('SCG_COOKIE', v);
          sh.getRange(1, 2).clearContent();
          Logger.log('getScgCookie_: migrated from sheet B1 → UserProperties แล้วล้าง B1');
        } catch (e2) {
          Logger.log('getScgCookie_: migrate failed, use sheet value once: ' + e2.message);
        }
        return v;
      }
    }
  } catch (e) {
    Logger.log('getScgCookie_: sheet fallback failed: ' + (e && e.message ? e.message : e));
  }
  return '';
}

/**
 * trimPiiColumns_ — ลบ columns ที่มี PII keywords (เลขบัตร/เบอร์โทร) จากชีต "ข้อมูลพนักงาน"
 * [v5.4.8 M-4] manual operation — ไม่ auto-run
 * @returns {number} จำนวน columns ที่ลบ
 */
function trimPiiColumns_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEETS.EMPLOYEE);
  if (!sh) throw new Error('ไม่พบชีต "' + SHEETS.EMPLOYEE + '"');

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });
  const piiKeywords = ['เลขบัตร', 'id_card', 'idcard', 'เบอร์โทร', 'phone', 'id card'];
  const toDelete = [];  // indices เรียงจากมากไปน้อย (กัน index shift)
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    for (let j = 0; j < piiKeywords.length; j++) {
      if (h.indexOf(piiKeywords[j].toLowerCase()) >= 0) {
        toDelete.push(i + 1);  // 1-based
        break;
      }
    }
  }
  // ลบจากขวาไปซ้าย
  toDelete.sort(function (a, b) { return b - a; });
  toDelete.forEach(function (col) {
    sh.deleteColumn(col);
  });
  Logger.log('trimPiiColumns_: deleted ' + toDelete.length + ' columns: ' + toDelete.join(','));
  return toDelete.length;
}
