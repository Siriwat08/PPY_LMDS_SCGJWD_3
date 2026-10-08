/**
 * 99_SelfTest.gs — v5.4.8
 *
 * Self-Test Infrastructure: กดปุ่มเดียวเช็คทั้งระบบ
 * รัน 8 assertions บน Sheet จริง + แสดงผล PASS/FAIL/WARN
 *
 * ใช้สำหรับ:
 *   - ตรวจสอบหลัง Deploy ทุกครั้ง (mandatory)
 *   - ตรวจหา Dead Layer / Schema drift / Cache invalid
 *   - ตรวจก่อน Production go-live
 *
 * เพิ่มเมนู "🧪 Self-Test" ใน 03_Menu.gs (กลุ่ม ดูผล / รีเซ็ต)
 *
 * [v5.4.8 NEW] สร้างใหม่ — เป็น root-cause fix ของ "ทำไมต้องมาแก้บั๊กซ้ำ":
 *   - ไม่มี Runtime Test ในอดีต → Dead Layer อยู่ได้หลายเวอร์ชันโดยไม่มีใครรู้
 *   - Self-Test นี้จับ Dead Layer / Schema mismatch / Cache invalid ได้ตั้งแต่ต้น
 */

// ============================================
// CONFIG — ตรวจให้ตรงกับ 00_Config.gs
// ============================================
const SELFTEST_SHEET_SETTINGS = SHEETS.SETTINGS;  // 'การตั้งค่า'
const SELFTEST_SHEET_MASTER   = SHEETS.MASTER;    // 'MASTER'
const SELFTEST_SHEET_GEO_DICT = SHEETS.GEO_DICT;  // 'SYS_TH_GEO'

// Threshold: แจ้งเตือนเมื่อ layer distribution ผิดปกติ
const SELFTEST_MIN_COVERAGE_PCT = 50;   // แมชต์ได้น้อยกว่า 50% → FAIL
const SELFTEST_LATLNG_OOR_PCT   = 5;    // out-of-range > 5% → FAIL
const SELFTEST_POSTAL_KEY_PIPE_PCT = 95; // pipe count ต้อง > 95% ของ rows with key

// ============================================
// MAIN ENTRY
// ============================================

/**
 * runSelfTest_ — รัน 8 assertions + return summary
 * ใช้ได้ทั้งจากเมนู และจาก trigger / time-based
 * @returns {{passed:number, failed:number, warned:number, results:Array, timestamp:string}}
 */
function runSelfTest_() {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  const results = [];

  // รายการ test เรียงตาม priority — เช็ค critical ก่อน
  const tests = [
    { name: 'testKeyAlignment_',     fn: testKeyAlignment_     },
    { name: 'testCacheState_',       fn: testCacheState_       },
    { name: 'testMasterIdUniqueness_', fn: testMasterIdUniqueness_ },
    { name: 'testHelperSchema_',     fn: testHelperSchema_     },
    { name: 'testPostalCoverage_',   fn: testPostalCoverage_   },
    { name: 'testLatLongRange_',     fn: testLatLongRange_     },
    { name: 'testPiiColumns_',       fn: testPiiColumns_       },
    { name: 'testRbacConfig_',       fn: testRbacConfig_       },
    { name: 'testPostalFormat_',     fn: testPostalFormat_     }  // [PATCH lang] Test 9
  ];

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const tStart = Date.now();
    let r;
    try {
      r = t.fn();
      if (!r || !r.status) {
        r = { name: t.name, status: 'FAIL', message: 'no result', duration_ms: 0 };
      }
    } catch (e) {
      r = { name: t.name, status: 'FAIL', message: 'EXCEPTION: ' + e.message, duration_ms: 0 };
    }
    r.name = t.name;
    r.duration_ms = Date.now() - tStart;
    results.push(r);
  }

  const passed = results.filter(function (r) { return r.status === 'PASS'; }).length;
  const failed = results.filter(function (r) { return r.status === 'FAIL'; }).length;
  const warned = results.filter(function (r) { return r.status === 'WARN'; }).length;

  const summary = {
    passed: passed,
    failed: failed,
    warned: warned,
    total: results.length,
    duration_ms: Date.now() - startedAt,
    timestamp: timestamp,
    results: results
  };

  Logger.log('SelfTest: ' + passed + ' PASS / ' + failed + ' FAIL / ' + warned + ' WARN');
  return summary;
}

/**
 * runSelfTestMenu_ — UI entry: รัน 8 tests + แสดงผล + เขียนลง การตั้งค่า
 */
function runSelfTestMenu_() {
  const summary = runSelfTest_();

  // เขียนลงชีต การตั้งค่า
  try {
    writeSelfTestToSettings_(summary);
  } catch (e) {
    Logger.log('SelfTest: cannot write to settings sheet: ' + e.message);
  }

  // สร้าง HTML dialog
  const html = buildSelfTestDialog_(summary);
  const ui = SpreadsheetApp.getUi();
  if (typeof HtmlService !== 'undefined' && HtmlService.createHtmlOutput) {
    const output = HtmlService.createHtmlOutput(html)
      .setWidth(720)
      .setHeight(540)
      .setTitle('🧪 Self-Test — ' + summary.passed + ' PASS / ' + summary.failed + ' FAIL / ' + summary.warned + ' WARN');
    ui.showModalDialog(output, '🧪 Self-Test v5.5.1');
  } else {
    // fallback (เช่น trigger ไม่มี UI)
    let msg = 'Self-Test:\n' + summary.passed + ' PASS / ' + summary.failed + ' FAIL / ' + summary.warned + ' WARN\n\n';
    summary.results.forEach(function (r) {
      const icon = r.status === 'PASS' ? '✅' : (r.status === 'FAIL' ? '❌' : '⚠️');
      msg += icon + ' ' + r.name + ' (' + r.duration_ms + 'ms): ' + r.message + '\n';
    });
    Logger.log(msg);
  }
}

// ============================================
// 8 ASSERTIONS
// ============================================

/**
 * Test 1: Key alignment
 * ตรวจ SYS_TH_GEO postal_key delimiter (pipe vs space)
 * ถ้า data ใช้ space แต่ code ค้นด้วย pipe → Dead Layer
 */
function testKeyAlignment_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SELFTEST_SHEET_GEO_DICT);
  if (!sh) {
    return { status: 'FAIL', message: 'ไม่พบชีต ' + SELFTEST_SHEET_GEO_DICT };
  }
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { status: 'WARN', message: 'ชีต ' + SELFTEST_SHEET_GEO_DICT + ' ว่างเปล่า' };
  }
  // POSTAL_KEY อยู่ที่ col N (index 13) จาก GEO_DICT_IDX.POSTAL_KEY
  const pkCol = (typeof GEO_DICT_IDX !== 'undefined' ? GEO_DICT_IDX.POSTAL_KEY : 13) + 1;
  const data = sh.getRange(2, pkCol, lastRow - 1, 1).getValues();

  let pipeCount = 0, spaceCount = 0, withKeyCount = 0;
  for (let i = 0; i < data.length; i++) {
    const v = String(data[i][0] || '').trim();
    if (!v) continue;
    withKeyCount++;
    if (v.indexOf('|') >= 0) pipeCount++;
    if (v.indexOf(' ') >= 0) spaceCount++;
  }

  if (withKeyCount === 0) {
    return { status: 'WARN', message: 'ไม่มี postal_key ในชีต' };
  }
  const pipePct = (pipeCount / withKeyCount) * 100;
  if (spaceCount > 0) {
    return {
      status: 'FAIL',
      message: 'postal_key delimiter mismatch: pipe=' + pipeCount + ' space=' + spaceCount +
               ' (' + pipePct.toFixed(1) + '% pipe) — code ค้นด้วย | แต่ data มี space'
    };
  }
  if (pipePct < SELFTEST_POSTAL_KEY_PIPE_PCT) {
    return {
      status: 'WARN',
      message: 'pipe เพียง ' + pipePct.toFixed(1) + '% (threshold ' + SELFTEST_POSTAL_KEY_PIPE_PCT +
               '%) — ตรวจ SYS_TH_GEO postal_key column'
    };
  }
  return {
    status: 'PASS',
    message: 'pipe=' + pipeCount + ' space=0 (' + pipePct.toFixed(1) + '% pipe) — keys ตรงกับ Logic'
  };
}

/**
 * Test 2: Cache state
 * ตรวจ CacheService state + size
 * ถ้า > 90KB → cache ตาย (write ถูก skip)
 */
function testCacheState_() {
  let cache;
  try {
    cache = CacheService.getScriptCache();
  } catch (e) {
    return { status: 'WARN', message: 'CacheService unavailable: ' + e.message };
  }
  // ลอง key ทั้งเก่าและใหม่
  const keys = [
    typeof TH_GEO_CACHE_KEY_TH !== 'undefined' ? TH_GEO_CACHE_KEY_TH : 'geo_v548_th_idx',
    typeof TH_GEO_CACHE_KEY_EN !== 'undefined' ? TH_GEO_CACHE_KEY_EN : 'geo_v548_en_idx',
    'geo_v53_th_idx',
    'geo_v53_en_idx',
    'geo_v52_idx_32col_en'
  ];
  let found = null;
  for (let i = 0; i < keys.length; i++) {
    try {
      const v = cache.get(keys[i]);
      if (v) { found = { key: keys[i], value: v }; break; }
    } catch (e) {}
  }
  if (!found) {
    return { status: 'WARN', message: 'ไม่มี cache (cold start) — รันครั้งแรกจะ rebuild ในหน่วยความจำ' };
  }
  const size = found.value.length;
  if (size > 90000) {
    return {
      status: 'FAIL',
      message: 'cache "' + found.key + '" ขนาด ' + size + ' chars > 90KB — cache.put() ถูก skip! ' +
               '(in-memory เท่านั้น)'
    };
  }
  return {
    status: 'PASS',
    message: 'cache "' + found.key + '" = ' + size + ' chars (< 90KB OK)'
  };
}

/**
 * Test 3: MD_ID + MATCH_KEY uniqueness
 * [v5.5.2 FIX] นับครบทุกแถวข้อมูล (numRows = lastRow-1 เริ่มแถว 2)
 * และตรวจทั้ง MD_ID และ MATCH_KEY — เดิมตรวจแค่ MD_ID จึง "ดูเหมือนผ่านแต่ KEY ซ้ำไม่ถูกรายงาน"
 */
function testMasterIdUniqueness_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SELFTEST_SHEET_MASTER);
  if (!sh) {
    return { status: 'FAIL', message: 'ไม่พบชีต ' + SELFTEST_SHEET_MASTER };
  }
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { status: 'WARN', message: 'ชีต MASTER ว่าง' };
  }
  // Sheet.getRange(row, column, numRows, numColumns) — ต้องส่งจำนวนแถว ไม่ใช่เลขแถวสุดท้าย
  const numData = lastRow - 1;
  // อ่าน MD_ID (col A) + MATCH_KEY (col B) พร้อมกัน ทุกแถวข้อมูล
  const rows = sh.getRange(2, 1, numData, 2).getValues();
  const idCounts = {};
  const keyCounts = {};
  let blankId = 0;
  let blankKey = 0;
  for (let i = 0; i < rows.length; i++) {
    const id = String(rows[i][0] || '').trim();
    const key = String(rows[i][1] || '').trim();
    if (!id) {
      blankId++;
    } else {
      idCounts[id] = (idCounts[id] || 0) + 1;
    }
    if (!key) {
      blankKey++;
    } else {
      keyCounts[key] = (keyCounts[key] || 0) + 1;
    }
  }

  const idDupes = [];
  for (const k in idCounts) {
    if (idCounts[k] > 1) idDupes.push(k + ' (×' + idCounts[k] + ')');
  }
  const keyDupes = [];
  for (const k in keyCounts) {
    if (keyCounts[k] > 1) keyDupes.push(k.substring(0, 40) + (k.length > 40 ? '…' : '') + ' (×' + keyCounts[k] + ')');
  }

  if (idDupes.length > 0) {
    return {
      status: 'FAIL',
      message: 'MD_ID ซ้ำ ' + idDupes.length + ' ค่า: ' + idDupes.slice(0, 5).join(', ') +
               (idDupes.length > 5 ? ' (+' + (idDupes.length - 5) + ' อื่น ๆ)' : '') +
               ' | สแกน ' + numData + ' แถว'
    };
  }
  if (keyDupes.length > 0) {
    return {
      status: 'FAIL',
      message: 'MATCH_KEY ซ้ำ ' + keyDupes.length + ' ค่า: ' + keyDupes.slice(0, 3).join(', ') +
               (keyDupes.length > 3 ? ' (+' + (keyDupes.length - 3) + ' อื่น ๆ)' : '') +
               ' | สแกน ' + numData + ' แถว — ปุ่ม 2 อาจชี้ MD ผิดตัว'
    };
  }

  const totalIds = Object.keys(idCounts).length;
  const totalKeys = Object.keys(keyCounts).length;
  if (totalIds === 0) {
    return { status: 'WARN', message: 'MASTER มี ' + numData + ' แถวแต่ไม่มี MD_ID' };
  }
  // heuristic: ถ้า MD-0001 มี และ MD-0002 ไม่มี ทั้งที่จำนวนมาก → น่าสงสัยเรื่อง reset
  if (idCounts['MD-0001'] && !idCounts['MD-0002'] && totalIds > 100) {
    return {
      status: 'WARN',
      message: totalIds + ' MD_ID / ' + totalKeys + ' KEY ไม่ซ้ำ — แต่ไม่มี MD-0002 (ตรวจประวัติ reset) | สแกน ' + numData + ' แถว'
    };
  }
  let msg = totalIds + ' MD_ID + ' + totalKeys + ' MATCH_KEY ไม่ซ้ำ (สแกน ' + numData + ' แถว';
  if (blankId > 0 || blankKey > 0) {
    msg += ', ว่าง ID=' + blankId + ' KEY=' + blankKey;
  }
  msg += ')';
  return { status: 'PASS', message: msg };
}

/**
 * Test 4: Helper schema (SOURCE) + U-AA (MASTER)
 * [v5.5.2 FIX] helper 4 คอลัมน์ (MD_LINK..STATUS) อยู่ที่ชีตต้นทาง SCGนครหลวงJWDภูมิภาค
 * ไม่ได้อยู่ที่ MASTER_PLACE — เดิมเช็คผิดชีตจึง FAIL ทั้งที่ต้นทางอาจครบ
 */
function testHelperSchema_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceName = (typeof SHEETS !== 'undefined' && SHEETS.SOURCE)
    ? SHEETS.SOURCE
    : 'SCGนครหลวงJWDภูมิภาค';
  const srcSh = ss.getSheetByName(sourceName);
  if (!srcSh) {
    return { status: 'FAIL', message: 'ไม่พบชีตต้นทาง "' + sourceName + '"' };
  }
  const srcLastCol = srcSh.getLastColumn();
  if (srcLastCol < 1) {
    return { status: 'FAIL', message: 'ชีตต้นทางไม่มีคอลัมน์' };
  }
  const srcHeaders = srcSh.getRange(1, 1, 1, srcLastCol).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });

  // helper ต้องครบ 4 ชื่อบน SOURCE (ลำดับควรติดกันตาม RAW_HELPER_HEADERS)
  const need = ['MD_LINK', 'MATCH_KEY', 'POINTS_AT_TIME', 'STATUS'];
  const missing = [];
  const positions = [];
  for (let i = 0; i < need.length; i++) {
    const idx = srcHeaders.indexOf(need[i]);
    if (idx < 0) missing.push(need[i]);
    else positions.push(idx);
  }
  if (missing.length > 0) {
    return {
      status: 'FAIL',
      message: 'ชีตต้นทาง "' + sourceName + '" ไม่มีหัวคอลัมน์: ' + missing.join(', ') +
               ' — เพิ่มแถว 1 ให้ครบ 4 ช่องนี้'
    };
  }
  // ตรวจว่า 4 คอลัมน์เรียงติดกัน (MD_LINK แล้วตามด้วยอีก 3)
  positions.sort(function (a, b) { return a - b; });
  let contiguous = true;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] !== positions[0] + i) contiguous = false;
  }
  // ยืนยันลำดับชื่อตรง RAW_HELPER_HEADERS ถ้าเริ่มที่ MD_LINK
  const start = srcHeaders.indexOf('MD_LINK');
  let orderOk = true;
  for (let i = 0; i < need.length; i++) {
    if (srcHeaders[start + i] !== need[i]) orderOk = false;
  }
  if (!contiguous || !orderOk) {
    return {
      status: 'FAIL',
      message: 'helper บนต้นทางไม่เรียงติดกันตาม MD_LINK,MATCH_KEY,POINTS_AT_TIME,STATUS (เริ่ม col ' +
               (start + 1) + ') — ปุ่ม 1 เขียนผิดช่องได้'
    };
  }

  // U-AA อยู่บน MASTER (ไม่ใช่ SOURCE)
  const msh = ss.getSheetByName(SELFTEST_SHEET_MASTER);
  if (!msh) {
    return {
      status: 'WARN',
      message: 'helper ต้นทางครบ 4 cols (col ' + (start + 1) + '-' + (start + 4) +
               ') แต่ไม่พบชีต MASTER สำหรับเช็ค U-AA'
    };
  }
  const mLastCol = msh.getLastColumn();
  if (mLastCol < 2) {
    return {
      status: 'WARN',
      message: 'helper ต้นทางครบ 4 cols (col ' + (start + 1) + '-' + (start + 4) +
               ') | MASTER ยังไม่มีคอลัมน์พอ (อาจยังไม่รันปุ่ม 1)'
    };
  }
  const mHeaders = msh.getRange(1, 1, 1, mLastCol).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });
  const uStart = mHeaders.indexOf('Rahatpraisanee');
  const uEnd = mHeaders.indexOf('GEO_LAYER');
  if (uStart < 0 || uEnd < 0) {
    return {
      status: 'WARN',
      message: 'helper ต้นทางครบ 4 cols (col ' + (start + 1) + '-' + (start + 4) +
               ') | MASTER ยังไม่มี U-AA (Rahatpraisanee..GEO_LAYER) — ปกติถ้ายังไม่เตรียมหัวคอลัมน์ปุ่ม 3'
    };
  }
  const actualULen = uEnd - uStart + 1;
  if (actualULen !== 7) {
    return {
      status: 'FAIL',
      message: 'U-AA บน MASTER ไม่ contiguous: Rahatpraisanee@' + (uStart + 1) +
               ' → GEO_LAYER@' + (uEnd + 1) + ' (ได้ ' + actualULen + ' ต้องเป็น 7)'
    };
  }
  return {
    status: 'PASS',
    message: 'SOURCE helper=4 cols (col ' + (start + 1) + '-' + (start + 4) +
             '), MASTER U-AA=7 cols (col ' + (uStart + 1) + '-' + (uEnd + 1) + ')'
  };
}

/**
 * Test 5: Postal coverage
 * ตรวจ EXACT3/POSTAL_RHSTB ใช้งานได้ (sample 100 แถว)
 */
/**
 * [PATCH lang] เลือก matcher ตามภาษาของข้อความ Y
 * แก้ false alarm: ตัวอย่าง 100 แถวแรกเป็น EN แต่เรียกแค่ geoMatch_ เส้นไทย
 */
function pickGeoMatcher_(geoText) {
  const isThai = /[\u0e00-\u0e4e]/.test(geoText);
  if (isThai && typeof geoMatch_ === 'function') return geoMatch_;
  if (!isThai && typeof geoMatchEn_ === 'function') return geoMatchEn_;
  return (typeof geoMatch_ === 'function') ? geoMatch_ : geoMatchEn_;
}

function testPostalCoverage_() {
  try {
    // เรียก loadGeoIdx_() — ต้องมีจาก 04_GeoService.gs
    if (typeof loadGeoIdx_ !== 'function') {
      return { status: 'FAIL', message: 'loadGeoIdx_() ไม่มี — ไฟล์ 04_GeoService.gs ไม่ได้โหลด' };
    }
    const idx = loadGeoIdx_();
    if (!idx || !idx.bySearch) {
      return { status: 'FAIL', message: 'loadGeoIdx_() return invalid index' };
    }
    const totalKeys = Object.keys(idx.bySearch).length + Object.keys(idx.bySearch_EN || {}).length;
    if (totalKeys === 0) {
      return { status: 'WARN', message: 'SYS_TH_GEO index ว่างเปล่า' };
    }

    // Sample MASTER 100 แถว
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SELFTEST_SHEET_MASTER);
    if (!sh || sh.getLastRow() < 2) {
      return { status: 'WARN', message: 'MASTER ว่าง — ไม่สามารถ sample' };
    }
    const sampleN = Math.min(100, sh.getLastRow() - 1);
    const sample = sh.getRange(2, 1, sampleN, sh.getLastColumn()).getValues();

    // [v5.5.1 AUDIT F-003] geoMatch_(geoText) รับข้อความที่อยู่ ไม่ใช่ MASTER row array
    // ใช้คอลัมน์ Reversegeocode (Y) หรือ GEO_LAYER ที่บันทึกไว้แล้ว
    const layers = {};
    let matched = 0;
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) {
      return String(h || '').trim();
    });
    const revCol = headers.indexOf('Reversegeocode');
    const layerCol = headers.indexOf('GEO_LAYER');

    // [PATCH lang] ใช้ pickGeoMatcher_ — เลือกสาย TH/EN ตามข้อความ Y
    if ((typeof geoMatch_ === 'function' || typeof geoMatchEn_ === 'function') && revCol >= 0) {
      for (let i = 0; i < sample.length; i++) {
        const geoText = String(sample[i][revCol] || '').trim();
        if (!geoText) {
          layers['EMPTY_TEXT'] = (layers['EMPTY_TEXT'] || 0) + 1;
          continue;
        }
        try {
          const matcher = pickGeoMatcher_(geoText);
          const m = matcher ? matcher(geoText) : null;
          if (m && m.layer) {
            layers[m.layer] = (layers[m.layer] || 0) + 1;
            matched++;
          } else {
            layers['NONE'] = (layers['NONE'] || 0) + 1;
          }
        } catch (e) {
          layers['ERROR'] = (layers['ERROR'] || 0) + 1;
        }
      }
    } else if (layerCol >= 0) {
      // fallback: อ่าน GEO_LAYER ที่ปุ่ม 3 เขียนไว้แล้ว
      for (let i = 0; i < sample.length; i++) {
        const layer = String(sample[i][layerCol] || '').trim();
        if (layer) {
          layers[layer] = (layers[layer] || 0) + 1;
          matched++;
        } else {
          layers['NONE'] = (layers['NONE'] || 0) + 1;
        }
      }
    } else {
      return { status: 'WARN', message: 'ไม่พบ Reversegeocode/GEO_LAYER — ข้าม coverage' };
    }

    const coveragePct = (matched / sampleN) * 100;
    const layerSummary = Object.keys(layers).sort(function (a, b) {
      return layers[b] - layers[a];
    }).slice(0, 5).map(function (k) {
      return k + '=' + layers[k];
    }).join(', ');

    if (coveragePct < SELFTEST_MIN_COVERAGE_PCT) {
      return {
        status: 'FAIL',
        message: 'coverage ' + coveragePct.toFixed(1) + '% < ' + SELFTEST_MIN_COVERAGE_PCT + '% — ' + layerSummary
      };
    }
    if (!layers['EXACT3'] && !layers['EXACT3_EN']) {
      return {
        status: 'WARN',
        message: 'EXACT3 layer = 0 (อาจเป็น data issue) — ' + layerSummary
      };
    }
    if (!layers['POSTAL_RHSTB'] && !layers['POSTAL_RHSTB_EN']) {
      return {
        status: 'WARN',
        message: 'POSTAL_RHSTB layer = 0 (อาจเป็น data issue) — ' + layerSummary
      };
    }
    return {
      status: 'PASS',
      message: 'coverage ' + coveragePct.toFixed(1) + '% — top layers: ' + layerSummary
    };
  } catch (e) {
    return { status: 'FAIL', message: 'EXCEPTION: ' + e.message };
  }
}

/**
 * Test 6: LatLong range
 * [v5.5.7 AUDIT FIX-3] ตรวจ MASTER.LAT/LNG (คอลัมน์ที่มีจริงบน MASTER_PLACE)
 *   เดิม: หา column "LatLong_Actual" บน MASTER — คอลัมน์นั้นอยู่บน "ตารางงานประจำวัน" ไม่ใช่ MASTER
 *   ผลเดิม: test คืน WARN "ไม่พบ column" เสมอ → ไม่เคยตรวจอะไรเลย (dead test)
 *   หลักฐาน: ชีต การตั้งค่า ในแพ็กเกจ (SelfTest run จริง) บวก unit test บน mock
 */
function testLatLongRange_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SELFTEST_SHEET_MASTER);
  if (!sh || sh.getLastRow() < 2) {
    return { status: 'WARN', message: 'MASTER ว่าง' };
  }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });
  const latCol = headers.indexOf('LAT');
  const lngCol = headers.indexOf('LNG');
  if (latCol < 0 || lngCol < 0) {
    return { status: 'WARN', message: 'ไม่พบ column LAT/LNG บน MASTER' };
  }
  const lastRow = sh.getLastRow();
  const data = sh.getRange(2, latCol + 1, lastRow - 1, 2).getValues();

  let total = 0, oor = 0, examples = [];
  for (let i = 0; i < data.length; i++) {
    const latV = data[i][0], lngV = data[i][1];
    const latBlank = (latV === '' || latV === null || latV === undefined);
    const lngBlank = (lngV === '' || lngV === null || lngV === undefined);
    if (latBlank && lngBlank) continue;
    total++;
    const lat = parseFloat(latV);
    const lng = parseFloat(lngV);
    if (isNaN(lat) || isNaN(lng)) {
      oor++;
      if (examples.length < 3) examples.push('unparseable: lat=' + latV + ', lng=' + lngV + ' (row ' + (i + 2) + ')');
      continue;
    }
    if (lat < 5 || lat > 21 || lng < 97 || lng > 106) {
      oor++;
      if (examples.length < 3) examples.push(lat + ', ' + lng + ' (row ' + (i + 2) + ')');
    }
  }

  if (total === 0) {
    return { status: 'WARN', message: 'ไม่มี LAT/LNG ที่ไม่ว่างบน MASTER' };
  }
  const oorPct = (oor / total) * 100;
  if (oorPct > SELFTEST_LATLNG_OOR_PCT) {
    return {
      status: 'FAIL',
      message: oor + '/' + total + ' (' + oorPct.toFixed(1) + '%) out of range > ' + SELFTEST_LATLNG_OOR_PCT + '% — ' + examples.join('; ')
    };
  }
  if (oor > 0) {
    return {
      status: 'WARN',
      message: oor + '/' + total + ' (' + oorPct.toFixed(1) + '%) out of range — ' + examples.join('; ')
    };
  }
  return { status: 'PASS', message: total + ' rows — ทุกค่าอยู่ในช่วง lat 5-21, lng 97-106' };
}

/**
 * Test 7: PII columns
 * ตรวจชีต "ข้อมูลพนักงาน" ไม่มี PII columns
 */
function testPiiColumns_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const empSheet = typeof SHEETS !== 'undefined' && SHEETS.EMPLOYEE ? SHEETS.EMPLOYEE : 'ข้อมูลพนักงาน';
  const sh = ss.getSheetByName(empSheet);
  if (!sh) {
    return { status: 'WARN', message: 'ไม่พบชีต "' + empSheet + '" — ข้าม PII check' };
  }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });
  const piiKeywords = ['เลขบัตร', 'id_card', 'idcard', 'เบอร์โทร', 'phone', 'id card'];
  const found = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    for (let j = 0; j < piiKeywords.length; j++) {
      if (h.indexOf(piiKeywords[j].toLowerCase()) >= 0) {
        found.push(headers[i] + ' (col ' + (i + 1) + ')');
        break;
      }
    }
  }
  if (found.length > 0) {
    return {
      status: 'WARN',
      message: 'พบ PII columns: ' + found.join(', ') + ' — แนะนำใช้เมนู 🛡️ Trim PII'
    };
  }
  return { status: 'PASS', message: 'ไม่พบ PII columns ในชีต "' + empSheet + '"' };
}

/**
 * Test 8: RBAC config
 * ตรวจชีต "การตั้งค่า" มี ROLE column
 */
function testRbacConfig_() {
  // [v5.4.9] ตรวจว่า assertRole_ / ROLE_MAP มีในโค้ด และไม่พังจาก const-assign
  // (เดิมหาคำ "role" ในชีตการตั้งค่า ซึ่งเป็นชีต log — FAIL โดยไม่เกี่ยวกับ RBAC จริง)
  if (typeof assertRole_ !== 'function') {
    return { status: 'FAIL', message: 'ไม่พบ function assertRole_' };
  }
  if (typeof ROLE_MAP === 'undefined' || !ROLE_MAP) {
    return { status: 'FAIL', message: 'ไม่พบ ROLE_MAP' };
  }
  // เรียก viewer ต้องไม่ throw
  try {
    assertRole_('viewer');
  } catch (e) {
    return { status: 'FAIL', message: 'assertRole_(viewer) throw: ' + e.message };
  }
  const configured =
    (ROLE_MAP.admin && ROLE_MAP.admin.length > 0) ||
    (ROLE_MAP.editor && ROLE_MAP.editor.length > 0);
  if (!configured) {
    return {
      status: 'WARN',
      message: 'ROLE_MAP ว่าง — ยังไม่ enforce (ระบบใช้ได้; ใส่ email เมื่อต้องการล็อกเมนู)'
    };
  }
  return { status: 'PASS', message: 'ROLE_MAP มีรายการ — assertRole_ พร้อม enforce' };
}

// ============================================
// HELPERS
// ============================================

/**
 * writeSelfTestToSettings_ — เขียนผลลงชีต การตั้งค่า (overwrite A1)
 */
function writeSelfTestToSettings_(summary) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SELFTEST_SHEET_SETTINGS);
  if (!sh) return;

  // สร้าง output rows
  const rows = [['Test Name', 'Status', 'Message', 'Duration (ms)']];
  summary.results.forEach(function (r) {
    rows.push([r.name, r.status, r.message || '', String(r.duration_ms)]);
  });
  rows.push([]);
  rows.push(['SUMMARY', summary.passed + ' PASS / ' + summary.failed + ' FAIL / ' + summary.warned + ' WARN', '', String(summary.duration_ms)]);
  rows.push(['TIMESTAMP', summary.timestamp, '', '']);

  // ล้าง A1:D(header)
  sh.getRange(1, 1, rows.length, 4).setValues(rows);

  // format
  try {
    const headerRange = sh.getRange(1, 1, 1, 4);
    headerRange.setFontWeight('bold').setBackground('#cccccc');
    // color status column
    for (let i = 0; i < summary.results.length; i++) {
      const r = summary.results[i];
      const cell = sh.getRange(i + 2, 2);
      if (r.status === 'PASS') cell.setBackground('#d4edda');
      else if (r.status === 'FAIL') cell.setBackground('#f8d7da');
      else if (r.status === 'WARN') cell.setBackground('#fff3cd');
    }
  } catch (e) {
    // ignore formatting error
  }
}

/**
 * buildSelfTestDialog_ — สร้าง HTML สำหรับ modal dialog
 */
function buildSelfTestDialog_(summary) {
  const colorMap = { PASS: '#28a745', FAIL: '#dc3545', WARN: '#ffc107' };
  const iconMap = { PASS: '✅', FAIL: '❌', WARN: '⚠️' };

  let rowsHtml = '';
  summary.results.forEach(function (r) {
    const color = colorMap[r.status] || '#666';
    const icon = iconMap[r.status] || '?';
    rowsHtml += '<tr>' +
      '<td style="padding:6px 12px;font-family:monospace;">' + r.name + '</td>' +
      '<td style="padding:6px 12px;color:' + color + ';font-weight:bold;">' + icon + ' ' + r.status + '</td>' +
      '<td style="padding:6px 12px;font-size:13px;">' + escapeHtml_(r.message || '') + '</td>' +
      '<td style="padding:6px 12px;color:#888;font-size:12px;text-align:right;">' + r.duration_ms + 'ms</td>' +
      '</tr>';
  });

  const summaryColor = summary.failed > 0 ? '#dc3545' : (summary.warned > 0 ? '#ffc107' : '#28a745');
  const summaryIcon = summary.failed > 0 ? '❌' : (summary.warned > 0 ? '⚠️' : '✅');

  return '<!DOCTYPE html><html><head><style>' +
    'body{font-family:Arial,sans-serif;margin:20px;background:#fafafa;color:#333;}' +
    'h2{margin:0 0 16px 0;}' +
    '.summary{padding:16px;background:' + summaryColor + ';color:white;border-radius:8px;margin-bottom:16px;}' +
    'table{width:100%;border-collapse:collapse;background:white;box-shadow:0 1px 3px rgba(0,0,0,0.1);}' +
    'th{background:#333;color:white;padding:10px 12px;text-align:left;}' +
    'tr:nth-child(even){background:#f8f8f8;}' +
    '.meta{color:#888;font-size:12px;margin-top:16px;}' +
    '</style></head><body>' +
    '<h2>🧪 LMDS Self-Test v5.5.1</h2>' +
    '<div class="summary">' + summaryIcon + ' <strong>' + summary.passed + ' PASS</strong> / ' +
    '<strong>' + summary.failed + ' FAIL</strong> / <strong>' + summary.warned + ' WARN</strong>' +
    ' (รวม ' + summary.duration_ms + 'ms)</div>' +
    '<table><thead><tr><th>Test</th><th>Status</th><th>Message</th><th>Duration</th></tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody></table>' +
    '<div class="meta">Timestamp: ' + summary.timestamp + ' | Result เขียนลงชีต "' + SELFTEST_SHEET_SETTINGS + '" A1</div>' +
    '</body></html>';
}

/**
 * escapeHtml_ — escape HTML เพื่อกัน XSS ใน dialog
 */
function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Test 9 [PATCH lang]: Postal format — U (Rahatpraisanee) ต้องเป็นเลข 5 หลัก
 * แปลง String() ก่อนเทียบ (U บนชีตเป็น Number — COUNTIF "?????" ได้ 0 ไม่ใช่ข้อมูลเสีย)
 */
function testPostalFormat_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SELFTEST_SHEET_MASTER);
    if (!sh || sh.getLastRow() < 2) {
      return { status: 'WARN', message: 'MASTER ว่าง — ข้าม' };
    }
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });
    const uCol = headers.indexOf('Rahatpraisanee');
    if (uCol < 0) {
      return { status: 'WARN', message: 'ไม่พบคอลัมน์ Rahatpraisanee (U)' };
    }
    const lastRow = sh.getLastRow();
    const vals = sh.getRange(2, uCol + 1, lastRow - 1, 1).getValues();

    let empty = 0, bad = 0, ok = 0;
    const badSamples = [];
    for (let i = 0; i < vals.length; i++) {
      const v = String(vals[i][0] === null || vals[i][0] === undefined ? '' : vals[i][0]).trim();
      if (v === '') { empty++; continue; }
      if (/^\d{5}$/.test(v)) { ok++; }
      else {
        bad++;
        if (badSamples.length < 5) badSamples.push('แถว ' + (i + 2) + '=' + v);
      }
    }
    const total = vals.length;
    if (empty > 0) {
      return { status: 'FAIL', message: 'ไปรษณีย์ว่าง ' + empty + '/' + total + ' แถว' };
    }
    if (bad > 0) {
      return { status: 'FAIL', message: 'รูปแบบไม่ใช่ 5 หลัก ' + bad + '/' + total +
        ' — ' + badSamples.join(', ') };
    }
    return { status: 'PASS', message: 'ไปรษณีย์ 5 หลักครบ ' + ok + '/' + total +
      ' (ตรวจแบบ String กันปัญหา Number-type)' };
  } catch (e) {
    return { status: 'FAIL', message: 'EXCEPTION: ' + e.message };
  }
}
