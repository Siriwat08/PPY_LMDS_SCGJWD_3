/**
 * ============================================================================
 *  Service_SCG.gs — ปุ่ม "โหลดข้อมูลจาก SCG API"
 *  Phaopanya Master Data — SCG/JWD Logistics Matching
 * ----------------------------------------------------------------------------
 *  จุดประสงค์: โหลดข้อมูลจาก SCG API → แปลง → เขียนลง "ตารางงานประจำวัน"
 *  ทำงาน 8 ข้อตามที่ผู้ใช้สั่ง:
 *    1. ทำงานต่อเนื่อง (LockService + Retry)
 *    2. โหลดข้อมูลจาก API
 *    3. แปลงข้อมูลใส่คอลัมน์:
 *       - จำนวนปลายทาง_System
 *       - รายชื่อปลายทาง_System
 *       - จำนวนสินค้ารวมของร้านนี้
 *       - น้ำหนักสินค้ารวมของร้านนี้
 *       - จำนวน_Invoice_ที่ต้องสแกน
 *       - ชื่อเจ้าของสินค้า_Invoice_ที่ต้องสแกน
 *       - ShopKey
 *    4. ดูชื่อพนักงาน (DriverName) → เอา Email จากชีต "ข้อมูลพนักงาน"
 *    5. แปลงข้อมูลจาก "ตารางงานประจำวัน" ไปยัง "สรุป_เจ้าของสินค้า" และ "สรุป_Shipment"
 *    6. ใส่ค่าตายตัว ScanStatus = "รอสแกน", DeliveryStatus = "ยังไม่ได้ส่ง"
 *    7. ฟังก์ชันลบข้อมูล (clear)
 *    8. สร้าง MATCH_KEY ตอนโหลด (makeKey ชุดเดียวกับปุ่ม 1)
 *       เว้น LatLong_Actual / MD_ID / LatLong_Actual_Status ให้ปุ่ม 2
 *
 *  ⚠️ สิ่งที่ไม่ทำ (ให้ปุ่ม 2):
 *    - ไม่เติม LatLong_Actual / MD_ID / LatLong_Actual_Status
 *      (ปุ่ม 2 = runDailyMatch() lookup MATCH_KEY → MASTER)
 *    - MATCH_KEY สร้างตอนโหลดด้วย makeKey() ชุดเดียวกับปุ่ม 1
 * ============================================================================
 */

// ============================================
//  1. MAIN: โหลดข้อมูลจาก API + แปลง + เขียน
// ============================================

/**
 * โหลด Shipment จาก SCG API
 * - อ่าน Shipment จากชีต Input
 * - ดึงข้อมูลผ่าน API (มี retry)
 * - แปลงเป็น flat rows 1 แถวต่อ 1 Item
 * - เติม aggregation: จำนวนปลายทาง, รายชื่อปลายทาง, ยอดรวมร้านค้า
 * - เติม Email พนักงาน (lookup จากชีต "ข้อมูลพนักงาน")
 * - เติมค่าตายตัว ScanStatus, DeliveryStatus
 * - สร้าง ShopKey
 * - เขียนลงชีต "ตารางงานประจำวัน"
 * - อัปเดตชีต "สรุป_เจ้าของสินค้า" + "สรุป_Shipment"
 */
function fetchDataFromSCGJWD() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let ui = SpreadsheetApp.getUi();

  // [ข้อ 1] LockService — กันผู้ใช้หลายคนรันพร้อมกัน
  let lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    ui.alert('⚠️ ระบบคิวทำงาน',
      'มีผู้ใช้งานอื่นกำลังโหลดข้อมูล Shipment อยู่\nกรุณารอสักครู่แล้วลองใหม่ครับ',
      ui.ButtonSet.OK);
    return;
  }

  try {
    // [validate] เช็คว่ามีชีตครบ
    validateSCGConfig_();

    let inputSheet  = ss.getSheetByName(SCG_CONFIG.SHEET_INPUT);
    let dataSheet   = ss.getSheetByName(SCG_CONFIG.SHEET_DATA);
    let empSheet    = ss.getSheetByName(SCG_CONFIG.SHEET_EMPLOYEE);

    if (!inputSheet || !dataSheet || !empSheet) {
      throw new Error('CRITICAL: ไม่พบชีต Input / ตารางงานประจำวัน / ข้อมูลพนักงาน');
    }

    // [1] อ่าน Cookie
    // [v5.4.8 H-2 FIX] ลองอ่านจาก PropertiesService ก่อน (ปลอดภัยกว่า)
    // Fallback: ชีต Input!B1 (backward compat)
    let cookie = '';
    if (typeof getScgCookie_ === 'function') {
      cookie = getScgCookie_();
    } else {
      cookie = String(inputSheet.getRange(SCG_CONFIG.COOKIE_CELL).getValue() || '').trim();
    }
    if (!cookie) {
      throw new Error('❌ ไม่พบ SCG Cookie\n' +
        'กรุณาใช้เมนู 🔐 Security & Maintenance → 🔑 Set SCG Cookie\n' +
        '(เก็บใน PropertiesService แทนชีต — ปลอดภัยกว่า)');
    }

    // [2] อ่าน Shipment Numbers จากชีต Input (ตั้งแต่ INPUT_START_ROW ลงไป)
    let lastInputRow = inputSheet.getLastRow();
    if (lastInputRow < SCG_CONFIG.INPUT_START_ROW) {
      throw new Error('ℹ️ ไม่พบเลข Shipment ในชีต Input (เริ่มที่แถว ' + SCG_CONFIG.INPUT_START_ROW + ')');
    }

    let shipmentNumbers = inputSheet
      .getRange(SCG_CONFIG.INPUT_START_ROW, 1,
                lastInputRow - SCG_CONFIG.INPUT_START_ROW + 1, 1)
      .getValues()
      .flat()
      .map(function (v) { return String(v || '').trim(); })
      .filter(function (v) { return v.length > 0; });

    if (shipmentNumbers.length === 0) {
      throw new Error('ℹ️ รายการ Shipment ว่างเปล่า — กรุณาวางเลข Shipment ในชีต Input');
    }

    let shipmentString = shipmentNumbers.join(',');
    inputSheet.getRange(SCG_CONFIG.SHIPMENT_STRING_CELL)
      .setValue(shipmentString)
      .setHorizontalAlignment('left');

    // [3] เรียก API
    let payload = {
      DeliveryDateFrom: '', DeliveryDateTo: '',
      TenderDateFrom:   '', TenderDateTo:   '',
      CarrierCode: '', CustomerCode: '', OriginCodes: '',
      ShipmentNos: shipmentString
    };
    let options = {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true,
      headers: { cookie: cookie }
    };

    ss.toast('กำลังเชื่อมต่อ SCG Server...', 'System', 10);
    console.log('[SCG API] Fetching ' + shipmentNumbers.length + ' shipments...');

    let responseText = fetchWithRetry_(SCG_CONFIG.API_URL, options, SCG_CONFIG.API_MAX_RETRIES);
    let json;
    try {
      json = JSON.parse(responseText);
    } catch (e) {
      throw new Error('❌ API ตอบกลับไม่ใช่ JSON ที่ถูกต้อง\n' +
        'Response: ' + responseText.substring(0, 200) + '...');
    }

    let shipments = json.data || [];
    if (shipments.length === 0) {
      throw new Error('API ตอบ Success แต่ไม่พบข้อมูล Shipment (Data Empty)');
    }

    ss.toast('กำลังแปลงข้อมูล ' + shipments.length + ' Shipments...', 'Processing', 5);
    logRun_('fetchDataFromSCGJWD', 'API OK: ' + shipments.length + ' shipments');

    // [4] แปลง Shipment → flat rows (1 item = 1 row)
    let allFlatData = [];
    let runningRow = 2;

    shipments.forEach(function (shipment) {
      // เก็บ ShipToName ทั้งหมดใน Shipment นี้ (สำหรับ จำนวนปลายทาง + รายชื่อปลายทาง)
      let destSet = new Set();
      (shipment.DeliveryNotes || []).forEach(function (n) {
        if (n.ShipToName) destSet.add(String(n.ShipToName).trim());
      });
      let destListStr = Array.from(destSet).join(', ');

      (shipment.DeliveryNotes || []).forEach(function (note) {
        (note.Items || []).forEach(function (item) {
          let dailyJobId = String(note.PurchaseOrder || '') + '-' + runningRow;
          let row = new Array(DATA_IDX.TOTAL_COLS).fill('');

          row[DATA_IDX.JOB_ID]        = dailyJobId;
          row[DATA_IDX.PLAN_DELIVERY] = note.PlanDelivery ? new Date(note.PlanDelivery) : '';
          row[DATA_IDX.INVOICE_NO]    = String(note.PurchaseOrder || '');
          row[DATA_IDX.SHIPMENT_NO]   = String(shipment.ShipmentNo || '');
          row[DATA_IDX.DRIVER_NAME]   = String(shipment.DriverName || '');
          row[DATA_IDX.TRUCK_LICENSE] = String(shipment.TruckLicense || '');
          row[DATA_IDX.CARRIER_CODE]  = String(shipment.CarrierCode || '');
          row[DATA_IDX.CARRIER_NAME]  = String(shipment.CarrierName || '');
          row[DATA_IDX.SOLD_TO_CODE]  = String(note.SoldToCode || '');
          row[DATA_IDX.SOLD_TO_NAME]  = String(note.SoldToName || '');
          row[DATA_IDX.SHIP_TO_NAME]  = String(note.ShipToName || '');
          row[DATA_IDX.SHIP_TO_ADDR]  = String(note.ShipToAddress || '');
          // [v5.4.8 L-7/L-8 FIX] validate lat/lng range ก่อนสร้าง LatLong_SCG
          const lat = parseFloat(note.ShipToLatitude);
          const lng = parseFloat(note.ShipToLongitude);
          if (!isNaN(lat) && !isNaN(lng) && lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106) {
            row[DATA_IDX.LATLNG_SCG] = note.ShipToLatitude + ', ' + note.ShipToLongitude;
          } else {
            // out of range — เว้นว่างแทนเขียน "13.5, " หรือค่าเพี้ยน
            if (note.ShipToLatitude || note.ShipToLongitude) {
              // log เฉพาะกรณีที่ API ส่งมาแต่ผิด — ไม่ log ถ้า API ไม่ส่ง (เยอะ)
              Logger.log('LatLong_SCG out of range: lat=' + lat + ', lng=' + lng + ' (invoice=' + (note.PurchaseOrder || '') + ')');
            }
            row[DATA_IDX.LATLNG_SCG] = '';
          }
          row[DATA_IDX.MATERIAL]      = String(item.MaterialName || '');
          row[DATA_IDX.QTY]           = Number(item.ItemQuantity) || 0;
          row[DATA_IDX.QTY_UNIT]      = String(item.QuantityUnit || '');
          row[DATA_IDX.WEIGHT]        = Number(item.ItemWeight) || 0;
          row[DATA_IDX.DELIVERY_NO]   = String(note.DeliveryNo || '');
          row[DATA_IDX.DEST_COUNT]    = destSet.size;
          row[DATA_IDX.DEST_LIST]     = destListStr;
          row[DATA_IDX.SCAN_STATUS]     = DEFAULT_SCAN_STATUS;       // [ข้อ 6] ค่าตายตัว
          row[DATA_IDX.DELIVERY_STATUS] = DEFAULT_DELIVERY_STATUS;   // [ข้อ 6] ค่าตายตัว
          // DATA_IDX.EMAIL (22)  — เติมทีหลัง (ดูข้อ 4)
          // DATA_IDX.TOT_QTY/... (23-25) — เติมทีหลัง (aggregate)
          // DATA_IDX.LATLNG_ACTUAL (26) — เว้นว่าง (ปุ่ม 2 เติม)
          // DATA_IDX.OWNER_LABEL (27) — เติมทีหลัง
          row[DATA_IDX.SHOP_KEY]      = String(shipment.ShipmentNo || '') + '|' + String(note.ShipToName || '');
          // MATCH_KEY ตอนโหลด — สูตรเดียวกับปุ่ม 1 (makeKey จาก 00_CleanService.gs)
          row[DATA_IDX.MATCH_KEY]     = makeKey(note.ShipToName, note.ShipToAddress, note.SoldToName);

          allFlatData.push(row);
          runningRow++;
        });
      });
    });

    if (allFlatData.length === 0) {
      throw new Error('⚠️ API ตอบมาแต่ไม่มี Item ใน Shipment เลย');
    }

    // [5] Aggregate ต่อร้าน (ใช้ ShopKey เป็น key)
    //     - จำนวนสินค้ารวม
    //     - น้ำหนักรวม
    //     - จำนวน Invoice ที่ต้องสแกน (ไม่รวม E-POD)
    //     - ชื่อเจ้าของ + จำนวนบิลที่เหลือสแกน
    let shopAgg = {};
    allFlatData.forEach(function (r) {
      let key = r[DATA_IDX.SHOP_KEY];
      if (!key) return;
      if (!shopAgg[key]) {
        shopAgg[key] = {
          qty: 0, weight: 0,
          invoices: new Set(),
          // [v5.4.3 BUG-003 FIX] เก็บ Set ของ InvoiceNo ที่เป็น EPOD (ไม่ใช่ count ต่อ item)
          epodInvoices: new Set()
        };
      }
      let agg = shopAgg[key];
      agg.qty    += Number(r[DATA_IDX.QTY])     || 0;
      agg.weight += Number(r[DATA_IDX.WEIGHT])  || 0;
      if (r[DATA_IDX.INVOICE_NO]) agg.invoices.add(String(r[DATA_IDX.INVOICE_NO]));
      if (checkIsEPOD(r[DATA_IDX.SOLD_TO_NAME], r[DATA_IDX.INVOICE_NO])) {
        // [v5.4.3 BUG-003 FIX] เก็บ InvoiceNo ที่เป็น EPOD (Set เลือก unique อัตโนมัติ)
        if (r[DATA_IDX.INVOICE_NO]) agg.epodInvoices.add(String(r[DATA_IDX.INVOICE_NO]));
      }
    });

    allFlatData.forEach(function (r) {
      let key = r[DATA_IDX.SHOP_KEY];
      let agg = shopAgg[key];
      if (!agg) return;
      // [v5.4.3 BUG-003 FIX] scanInv = invoices.size - epodInvoices.size (Set ไม่ซ้ำ)
      let scanInv = Math.max(agg.invoices.size - agg.epodInvoices.size, 0);
      r[DATA_IDX.TOT_QTY]     = agg.qty;
      r[DATA_IDX.TOT_WEIGHT]  = Number(agg.weight.toFixed(2));
      r[DATA_IDX.SCAN_INV]    = scanInv;
      r[DATA_IDX.OWNER_LABEL] =
        (r[DATA_IDX.SOLD_TO_NAME] || '') + ' / รวม ' + scanInv + ' บิล';
    });

    // [6] เติม Email พนักงาน (จากชีต "ข้อมูลพนักงาน") [ข้อ 4]
    let empMap = buildEmployeeMap_(empSheet);
    allFlatData.forEach(function (r) {
      let driver = String(r[DATA_IDX.DRIVER_NAME] || '').trim();
      if (driver && empMap[driver]) {
        r[DATA_IDX.EMAIL] = empMap[driver];
      } else {
        r[DATA_IDX.EMAIL] = '';
      }
    });

    // [7] เขียนลงชีต "ตารางงานประจำวัน"
    // ใช้ DATA_HEADERS จาก Config (32 cols) — รวม MATCH_KEY / MD_ID / Status
    let headers = DATA_HEADERS;

    // ล้างข้อมูลเก่าทั้ง 32 cols — โหลด API = ชุดข้อมูลใหม่ทั้งหมด
    // (LatLong_Actual / MD_ID / Status ของรอบก่อนถูกล้างด้วย เพราะแถวถูกแทนที่)
    let oldLastRow = dataSheet.getLastRow();
    if (oldLastRow > 1) {
      dataSheet.getRange(2, 1, oldLastRow - 1, DATA_IDX.TOTAL_COLS).clearContent();
    }

    // เขียน Header ครบ 32 คอลัมน์
    dataSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

    // เขียนข้อมูล — ข้ามคอลัมน์ของปุ่ม 2: LatLong_Actual(26), MD_ID(30), Status(31)
    // ช่วง 1: index 0-25 (A-Z) ของ Service_SCG
    // ช่วง 2: index 27-29 (AB-AD) = OWNER_LABEL, ShopKey, MATCH_KEY
    // เว้น 26, 30, 31 ว่าง ให้ปุ่ม 2 เติม
    // [v5.4.9 F-008] เขียน 2 ช่วงแบบ all-or-nothing — ถ้าช่วงใดล้ม ให้ล้างข้อมูลที่เขียนไปแล้ว แล้ว throw
    if (allFlatData.length > 0) {
      const n = allFlatData.length;
      try {
        const chunk1 = allFlatData.map(function (r) { return r.slice(0, 26); });
        dataSheet.getRange(2, 1, n, 26).setValues(chunk1);
        const chunk2 = allFlatData.map(function (r) { return r.slice(27, 30); }); // 27,28,29
        dataSheet.getRange(2, 28, n, 3).setValues(chunk2);
      } catch (writeErr) {
        try {
          if (dataSheet.getLastRow() > 1) {
            dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, DATA_IDX.TOTAL_COLS).clearContent();
          }
        } catch (clearErr) {
          console.warn('[SCG API] rollback clear failed: ' + clearErr.message);
        }
        throw new Error('เขียนตารางงานประจำวันไม่ครบ (all-or-nothing) — ล้างแถวข้อมูลแล้ว กรุณาโหลดใหม่: ' +
          (writeErr && writeErr.message ? writeErr.message : writeErr));
      }
    }

    // Format
    dataSheet.getRange(2, DATA_IDX.PLAN_DELIVERY + 1, allFlatData.length, 1)
      .setNumberFormat('dd/mm/yyyy');
    dataSheet.getRange(2, DATA_IDX.INVOICE_NO + 1, allFlatData.length, 1)
      .setNumberFormat('@');
    dataSheet.getRange(2, DATA_IDX.DELIVERY_NO + 1, allFlatData.length, 1)
      .setNumberFormat('@');
    dataSheet.getRange(2, DATA_IDX.QTY + 1, allFlatData.length, 1)
      .setNumberFormat('#,##0');
    dataSheet.getRange(2, DATA_IDX.WEIGHT + 1, allFlatData.length, 1)
      .setNumberFormat('#,##0.00');

    console.log('[SCG API] Wrote ' + allFlatData.length + ' rows to ' + SCG_CONFIG.SHEET_DATA);
    logRun_('fetchDataFromSCGJWD',
      'เขียน ' + allFlatData.length + ' แถวลง ' + SCG_CONFIG.SHEET_DATA);

    // [8] อัปเดต Summary [ข้อ 5]
    buildOwnerSummary();
    buildShipmentSummary();

    // สรุปผล
    let uniqueShops = Object.keys(shopAgg).length;
    let empMatched = allFlatData.filter(function (r) { return r[DATA_IDX.EMAIL]; }).length;
    let msg = '✅ ดึงข้อมูลสำเร็จ!\n\n' +
      '- Shipments: ' + shipments.length + '\n' +
      '- รายการทั้งหมด: ' + allFlatData.length + ' แถว\n' +
      '- ร้านค้า (ShopKey): ' + uniqueShops + ' ร้าน\n' +
      '- พนักงานที่จับคู่ Email: ' + empMatched + '/' + allFlatData.length + ' คน\n\n' +
      '💡 ขั้นต่อไป: กดปุ่ม "2) รันแมชต์งานวันนี้" เพื่อเติม LatLong_Actual / MD_ID';
    ui.alert(msg);
    logRun_('fetchDataFromSCGJWD', 'OK — rows=' + allFlatData.length);

  } catch (e) {
    console.error('[SCG API Error] ' + e.message);
    logRun_('fetchDataFromSCGJWD', 'ERROR — ' + e.message);
    ui.alert('❌ เกิดข้อผิดพลาด:\n' + e.message);
  } finally {
    lock.releaseLock();
  }
}

// ============================================
//  2. UTILITIES
// ============================================

/**
 * fetchWithRetry_ — เรียก API พร้อม exponential backoff
 * [ข้อ 1] ทำงานต่อเนื่อง — ไม่ล้มทันที ลองใหม่ 3 ครั้ง
 */
function fetchWithRetry_(url, options, maxRetries) {
  maxRetries = maxRetries || 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      let response = UrlFetchApp.fetch(url, options);
      let code = response.getResponseCode();
      if (code === 200) {
        return response.getContentText();
      }
      // [v5.4.1 P1-2 FIX] Fail-fast 401/403 — re-throw ทันที ไม่ retry
      if (code === 401 || code === 403) {
        throw new Error('Cookie หมดอายุ (HTTP ' + code + ') — กรุณาวาง Cookie ใหม่');
      }
      throw new Error('HTTP ' + code + ': ' + response.getContentText().substring(0, 200));
    } catch (e) {
      // [v5.4.1 P1-2 FIX] ตรวจ auth error → re-throw ทันที (ไม่ retry)
      if (e.message && e.message.indexOf('Cookie หมดอายุ') >= 0) {
        throw e;  // fail-fast ไม่ retry
      }
      if (i === maxRetries - 1) throw e;
      let wait = 1000 * Math.pow(2, i);  // 1s, 2s, 4s
      console.warn('[SCG API] Retry ' + (i + 1) + '/' + maxRetries +
        ' failed: ' + e.message + ' — รอ ' + (wait / 1000) + 's');
      Utilities.sleep(wait);
    }
  }
  throw new Error('[SCG API] ลอง ' + maxRetries + ' ครั้งแล้วยังไม่สำเร็จ');
}

/**
 * buildEmployeeMap_ — โหลด Name → Email จากชีต "ข้อมูลพนักงาน"
 * [ข้อ 4] คืน key = ชื่อ (trim, case-sensitive) → email
 */
function buildEmployeeMap_(empSheet) {
  let map = {};
  if (!empSheet) return map;
  let lastRow = empSheet.getLastRow();
  if (lastRow < 2) return map;

  let data = empSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  data.forEach(function (r) {
    let name  = String(r[EMPLOYEE_IDX.NAME]  || '').trim();
    let email = String(r[EMPLOYEE_IDX.EMAIL] || '').trim();
    if (name && email) {
      // ถ้าชื่อซ้ำ → เก็บค่าแรกที่เจอ (ไม่ overwrite)
      if (!map[name]) map[name] = email;
    }
  });
  return map;
}

/**
 * checkIsEPOD — ตรวจว่า Invoice นี้เป็น E-POD หรือไม่
 * (คัดลอกมาจาก LMDS ต้นฉบับ — เพราะ business rule ต้องตรงกัน)
 */
function checkIsEPOD(ownerName, invoiceNo) {
  if (!ownerName || !invoiceNo) return false;
  let owner = String(ownerName).toUpperCase();
  let inv   = String(invoiceNo);

  let epodOwners = ['BETTERBE', 'SCG EXPRESS', 'เบทเตอร์แลนด์', 'JWD TRANSPORT'];
  for (var i = 0; i < epodOwners.length; i++) {
    if (owner.indexOf(epodOwners[i].toUpperCase()) >= 0) return true;
  }

  if (owner.indexOf('DENSO') >= 0 || owner.indexOf('เด็นโซ่') >= 0) {
    if (inv.indexOf('_DOC') >= 0) return false;
    if (/^\d+(-.*)?$/.test(inv)) return true;
    return false;
  }

  return false;
}

// ============================================
//  3. SUMMARY BUILDERS [ข้อ 5]
// ============================================

/**
 * buildOwnerSummary — สรุปยอดตาม "ชื่อเจ้าของสินค้า" (SoldToName)
 * เขียนลงชีต "สรุป_เจ้าของสินค้า"
 */
function buildOwnerSummary() {
  let ss        = SpreadsheetApp.getActiveSpreadsheet();
  let dataSheet = ss.getSheetByName(SCG_CONFIG.SHEET_DATA);
  if (!dataSheet || dataSheet.getLastRow() < 2) return;

  let lastRow  = dataSheet.getLastRow();
  let data     = dataSheet.getRange(2, 1, lastRow - 1, DATA_IDX.TOTAL_COLS).getValues();
  let ownerMap = {};

  data.forEach(function (r) {
    let soldTo  = String(r[DATA_IDX.SOLD_TO_NAME] || '').trim();
    let invNo   = String(r[DATA_IDX.INVOICE_NO]   || '').trim();
    if (!soldTo) return;
    if (!ownerMap[soldTo]) {
      ownerMap[soldTo] = { all: new Set(), epod: new Set() };
    }
    if (!invNo) return;
    if (checkIsEPOD(soldTo, invNo)) {
      ownerMap[soldTo].epod.add(invNo);
    } else {
      ownerMap[soldTo].all.add(invNo);
    }
  });

  let summarySheet = ss.getSheetByName(SCG_CONFIG.SHEET_SUMMARY_OWNER);
  if (!summarySheet) {
    SpreadsheetApp.getUi().alert('❌ ไม่พบชีต "' + SCG_CONFIG.SHEET_SUMMARY_OWNER + '"');
    return;
  }

  // ล้างข้อมูลเก่า (เก็บ Header ไว้)
  let sumLast = summarySheet.getLastRow();
  if (sumLast > 1) {
    summarySheet.getRange(2, 1, sumLast - 1, 6).clearContent().setBackground(null);
  }

  let rows = [];
  Object.keys(ownerMap).sort().forEach(function (owner) {
    let o = ownerMap[owner];
    rows.push(['', owner, '', o.all.size, o.epod.size, new Date()]);
  });

  if (rows.length > 0) {
    summarySheet.getRange(2, 1, rows.length, 6).setValues(rows);
    summarySheet.getRange(2, 4, rows.length, 2).setNumberFormat('#,##0');
    summarySheet.getRange(2, 6, rows.length, 1).setNumberFormat('dd/mm/yyyy HH:mm');
  }
  console.log('[SCG Summary] Owner summary: ' + rows.length + ' owners');
}

/**
 * buildShipmentSummary — สรุปยอดตาม Shipment + ทะเบียนรถ
 * เขียนลงชีต "สรุป_Shipment"
 */
function buildShipmentSummary() {
  let ss        = SpreadsheetApp.getActiveSpreadsheet();
  let dataSheet = ss.getSheetByName(SCG_CONFIG.SHEET_DATA);
  if (!dataSheet || dataSheet.getLastRow() < 2) return;

  let lastRow     = dataSheet.getLastRow();
  let data        = dataSheet.getRange(2, 1, lastRow - 1, DATA_IDX.TOTAL_COLS).getValues();
  let shipmentMap = {};

  data.forEach(function (r) {
    let shipmentNo = String(r[DATA_IDX.SHIPMENT_NO]   || '').trim();
    let truck      = String(r[DATA_IDX.TRUCK_LICENSE] || '').trim();
    let soldTo     = String(r[DATA_IDX.SOLD_TO_NAME]  || '').trim();
    let invNo      = String(r[DATA_IDX.INVOICE_NO]    || '').trim();
    if (!shipmentNo || !truck) return;
    let key = shipmentNo + '_' + truck;
    if (!shipmentMap[key]) {
      shipmentMap[key] = {
        shipmentNo: shipmentNo, truck: truck,
        all: new Set(), epod: new Set()
      };
    }
    if (!invNo) return;
    if (checkIsEPOD(soldTo, invNo)) {
      shipmentMap[key].epod.add(invNo);
    } else {
      shipmentMap[key].all.add(invNo);
    }
  });

  let summarySheet = ss.getSheetByName(SCG_CONFIG.SHEET_SUMMARY_SHIP);
  if (!summarySheet) {
    SpreadsheetApp.getUi().alert('❌ ไม่พบชีต "' + SCG_CONFIG.SHEET_SUMMARY_SHIP + '"');
    return;
  }

  // ล้างข้อมูลเก่า (เก็บ Header ไว้)
  let sumLast = summarySheet.getLastRow();
  if (sumLast > 1) {
    summarySheet.getRange(2, 1, sumLast - 1, 7).clearContent().setBackground(null);
  }

  let rows = [];
  Object.keys(shipmentMap).sort().forEach(function (key) {
    let s = shipmentMap[key];
    rows.push([key, s.shipmentNo, s.truck, '', s.all.size, s.epod.size, new Date()]);
  });

  if (rows.length > 0) {
    summarySheet.getRange(2, 1, rows.length, 7).setValues(rows);
    summarySheet.getRange(2, 5, rows.length, 2).setNumberFormat('#,##0');
    summarySheet.getRange(2, 7, rows.length, 1).setNumberFormat('dd/mm/yyyy HH:mm');
  }
  console.log('[SCG Summary] Shipment summary: ' + rows.length + ' shipments');
}

// ============================================
//  4. CLEAR FUNCTIONS [ข้อ 7]
// ============================================

/**
 * ล้างข้อมูลในชีต "ตารางงานประจำวัน" (เก็บ Header)
 */
function clearDataSheet() {
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCG_CONFIG.SHEET_DATA);
  if (!sheet) return;
  let lastRow = sheet.getLastRow();
  let lastCol = sheet.getLastColumn();
  if (lastRow > 1 && lastCol > 0) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent().setBackground(null);
  }
  logRun_('clearDataSheet', 'ล้างข้อมูล ' + SCG_CONFIG.SHEET_DATA);
}

function clearDataSheet_UI() {
  // [v5.5.0 M-3] role guard บน destructive op
  try {
    if (typeof assertRole_ === 'function') assertRole_('editor');
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ' + e.message);
    return;
  }
  let ui = SpreadsheetApp.getUi();
  let r = ui.alert('⚠️ ยืนยันการล้างข้อมูล',
    'ต้องการล้างข้อมูลในชีต "' + SCG_CONFIG.SHEET_DATA + '" ใช่ไหม?\n(Header ยังคงอยู่)',
    ui.ButtonSet.YES_NO);
  if (r === ui.Button.YES) {
    clearDataSheet();
    ui.alert('✅ ล้างข้อมูล "' + SCG_CONFIG.SHEET_DATA + '" เรียบร้อย');
  }
}

/**
 * ล้างข้อมูลในชีต "สรุป_เจ้าของสินค้า" (เก็บ Header)
 */
function clearSummaryOwnerSheet() {
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCG_CONFIG.SHEET_SUMMARY_OWNER);
  if (!sheet) return;
  let lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 6).clearContent().setBackground(null);
  }
  logRun_('clearSummaryOwnerSheet', 'ล้างข้อมูล ' + SCG_CONFIG.SHEET_SUMMARY_OWNER);
}

function clearSummaryOwnerSheet_UI() {
  // [v5.5.0 M-3] role guard บน destructive op
  try {
    if (typeof assertRole_ === 'function') assertRole_('editor');
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ' + e.message);
    return;
  }
  let ui = SpreadsheetApp.getUi();
  let r = ui.alert('⚠️ ยืนยันการล้างข้อมูล',
    'ต้องการล้างข้อมูลในชีต "' + SCG_CONFIG.SHEET_SUMMARY_OWNER + '" ใช่ไหม?\n(Header ยังคงอยู่)',
    ui.ButtonSet.YES_NO);
  if (r === ui.Button.YES) {
    clearSummaryOwnerSheet();
    ui.alert('✅ ล้างข้อมูลเรียบร้อย');
  }
}

/**
 * ล้างข้อมูลในชีต "สรุป_Shipment" (เก็บ Header)
 */
function clearSummaryShipmentSheet() {
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCG_CONFIG.SHEET_SUMMARY_SHIP);
  if (!sheet) return;
  let lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 7).clearContent().setBackground(null);
  }
  logRun_('clearSummaryShipmentSheet', 'ล้างข้อมูล ' + SCG_CONFIG.SHEET_SUMMARY_SHIP);
}

function clearSummaryShipmentSheet_UI() {
  // [v5.5.0 M-3] role guard บน destructive op
  try {
    if (typeof assertRole_ === 'function') assertRole_('editor');
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ' + e.message);
    return;
  }
  let ui = SpreadsheetApp.getUi();
  let r = ui.alert('⚠️ ยืนยันการล้างข้อมูล',
    'ต้องการล้างข้อมูลในชีต "' + SCG_CONFIG.SHEET_SUMMARY_SHIP + '" ใช่ไหม?\n(Header ยังคงอยู่)',
    ui.ButtonSet.YES_NO);
  if (r === ui.Button.YES) {
    clearSummaryShipmentSheet();
    ui.alert('✅ ล้างข้อมูลเรียบร้อย');
  }
}

/**
 * ล้างข้อมูลในชีต "Input" (Cookie + Shipment list)
 */
function clearInputSheet() {
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCG_CONFIG.SHEET_INPUT);
  if (!sheet) return;
  sheet.getRange(SCG_CONFIG.COOKIE_CELL).clearContent();
  sheet.getRange(SCG_CONFIG.SHIPMENT_STRING_CELL).clearContent();
  let lastRow = sheet.getLastRow();
  if (lastRow >= SCG_CONFIG.INPUT_START_ROW) {
    sheet.getRange(SCG_CONFIG.INPUT_START_ROW, 1,
      lastRow - SCG_CONFIG.INPUT_START_ROW + 1, 1).clearContent();
  }
  logRun_('clearInputSheet', 'ล้างข้อมูล ' + SCG_CONFIG.SHEET_INPUT);
}

function clearInputSheet_UI() {
  // [v5.5.0 M-3] role guard บน destructive op
  try {
    if (typeof assertRole_ === 'function') assertRole_('editor');
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ' + e.message);
    return;
  }
  let ui = SpreadsheetApp.getUi();
  let r = ui.alert('⚠️ ยืนยันการล้างข้อมูล',
    'ต้องการล้างข้อมูลในชีต "' + SCG_CONFIG.SHEET_INPUT +
    '" (Cookie + รายชื่อ Shipment) ใช่ไหม?',
    ui.ButtonSet.YES_NO);
  if (r === ui.Button.YES) {
    clearInputSheet();
    ui.alert('✅ ล้างข้อมูล "' + SCG_CONFIG.SHEET_INPUT + '" เรียบร้อย');
  }
}

/**
 * ล้างข้อมูลทั้ง 4 ชีต: Input + Data + สรุป_เจ้าของสินค้า + สรุป_Shipment
 */
function clearAllSCGSheets_UI() {
  // [v5.5.0 M-3] role guard บน destructive op
  try {
    if (typeof assertRole_ === 'function') assertRole_('editor');
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ' + e.message);
    return;
  }
  let ui = SpreadsheetApp.getUi();
  let r = ui.alert(
    '🔥 ยืนยันการล้างข้อมูล SCG ทั้งหมด',
    'ต้องการล้างข้อมูลใน:\n' +
    '- ' + SCG_CONFIG.SHEET_INPUT + '\n' +
    '- ' + SCG_CONFIG.SHEET_DATA + '\n' +
    '- ' + SCG_CONFIG.SHEET_SUMMARY_OWNER + '\n' +
    '- ' + SCG_CONFIG.SHEET_SUMMARY_SHIP + '\n\n' +
    'การกระทำนี้กู้คืนไม่ได้',
    ui.ButtonSet.YES_NO);

  if (r === ui.Button.YES) {
    clearInputSheet();
    clearDataSheet();
    clearSummaryOwnerSheet();
    clearSummaryShipmentSheet();
    ui.alert('✅ ล้างข้อมูล SCG ทั้งหมดเรียบร้อย');
  }
}

// ============================================
//  5. RE-AGGREGATE (เผื่อแก้เองภายหลัง)
// ============================================

/**
 * reAggregateFromData_ — คำนวณ 4 คอลัมน์ aggregate ใหม่
 *   - จำนวนสินค้ารวมของร้านนี้
 *   - น้ำหนักสินค้ารวมของร้านนี้
 *   - จำนวน_Invoice_ที่ต้องสแกน
 *   - ชื่อเจ้าของสินค้า_Invoice_ที่ต้องสแกน
 * ใช้ตอน user แก้ QTY/WEIGHT/Invoice เอง แล้วอยากให้ aggregate อัปเดตตาม
 */
function reAggregateFromData_() {
  let ss        = SpreadsheetApp.getActiveSpreadsheet();
  let dataSheet = ss.getSheetByName(SCG_CONFIG.SHEET_DATA);
  if (!dataSheet || dataSheet.getLastRow() < 2) return;

  let lastRow = dataSheet.getLastRow();
  let data    = dataSheet.getRange(2, 1, lastRow - 1, DATA_IDX.TOTAL_COLS).getValues();
  let shopAgg = {};

  // aggregate
  data.forEach(function (r) {
    let key = String(r[DATA_IDX.SHOP_KEY] || '').trim();
    if (!key) return;
    if (!shopAgg[key]) {
      // [v5.4.3 BUG-003 FIX] epodInvoices เป็น Set ของ InvoiceNo (unique) แทน count
      shopAgg[key] = { qty: 0, weight: 0, invoices: new Set(), epodInvoices: new Set() };
    }
    let agg = shopAgg[key];
    agg.qty    += Number(r[DATA_IDX.QTY])    || 0;
    agg.weight += Number(r[DATA_IDX.WEIGHT]) || 0;
    if (r[DATA_IDX.INVOICE_NO]) agg.invoices.add(String(r[DATA_IDX.INVOICE_NO]));
    if (checkIsEPOD(r[DATA_IDX.SOLD_TO_NAME], r[DATA_IDX.INVOICE_NO])) {
      if (r[DATA_IDX.INVOICE_NO]) agg.epodInvoices.add(String(r[DATA_IDX.INVOICE_NO]));
    }
  });

  // apply
  data.forEach(function (r, idx) {
    let key = String(r[DATA_IDX.SHOP_KEY] || '').trim();
    let agg = shopAgg[key];
    if (!agg) return;
    // [v5.4.3 BUG-003 FIX] scanInv = invoices.size - epodInvoices.size
    let scanInv = Math.max(agg.invoices.size - agg.epodInvoices.size, 0);
    r[DATA_IDX.TOT_QTY]     = agg.qty;
    r[DATA_IDX.TOT_WEIGHT]  = Number(agg.weight.toFixed(2));
    r[DATA_IDX.SCAN_INV]    = scanInv;
    r[DATA_IDX.OWNER_LABEL] =
      (r[DATA_IDX.SOLD_TO_NAME] || '') + ' / รวม ' + scanInv + ' บิล';
  });

  dataSheet.getRange(2, 1, data.length, DATA_IDX.TOTAL_COLS).setValues(data);
  logRun_('reAggregateFromData_', 're-aggregate ' + data.length + ' rows');
}

function reAggregateFromData_UI() {
  reAggregateFromData_();
  SpreadsheetApp.getUi().alert('✅ คำนวณ aggregate ใหม่เรียบร้อย');
}

// ============================================
//  6. RE-LOOKUP EMAIL (เผื่อแก้พนักงานภายหลัง)
// ============================================

/**
 * reLookupEmail_ — เติม Email พนักงานใหม่ทั้งหมด
 * ใช้ตอน user เพิ่ม/แก้ Email ในชีต "ข้อมูลพนักงาน"
 */
function reLookupEmail_() {
  let ss        = SpreadsheetApp.getActiveSpreadsheet();
  let dataSheet = ss.getSheetByName(SCG_CONFIG.SHEET_DATA);
  let empSheet  = ss.getSheetByName(SCG_CONFIG.SHEET_EMPLOYEE);
  if (!dataSheet || dataSheet.getLastRow() < 2 || !empSheet) return;

  let empMap = buildEmployeeMap_(empSheet);
  let lastRow = dataSheet.getLastRow();
  let data    = dataSheet.getRange(2, 1, lastRow - 1, DATA_IDX.TOTAL_COLS).getValues();

  let matched = 0;
  data.forEach(function (r) {
    let driver = String(r[DATA_IDX.DRIVER_NAME] || '').trim();
    if (driver && empMap[driver]) {
      r[DATA_IDX.EMAIL] = empMap[driver];
      matched++;
    }
  });

  dataSheet.getRange(2, 1, data.length, DATA_IDX.TOTAL_COLS).setValues(data);
  logRun_('reLookupEmail_', 'matched ' + matched + '/' + data.length);
  return matched;
}

function reLookupEmail_UI() {
  let matched = reLookupEmail_();
  SpreadsheetApp.getUi().alert('✅ ค้นหา Email ใหม่เรียบร้อย\n' +
    'จับคู่ได้ ' + matched + ' แถว');
}

// ============================================
//  7. STATUS DEFAULTS (ค่าตายตัว) [ข้อ 6]
// ============================================

/**
 * setStatusDefaults_ — เติม ScanStatus = "รอสแกน", DeliveryStatus = "ยังไม่ได้ส่ง"
 * ใช้ตอน user อยาก reset ค่า default ใหม่
 */
function setStatusDefaults_() {
  let ss        = SpreadsheetApp.getActiveSpreadsheet();
  let dataSheet = ss.getSheetByName(SCG_CONFIG.SHEET_DATA);
  if (!dataSheet || dataSheet.getLastRow() < 2) return;

  let lastRow = dataSheet.getLastRow();
  let n = lastRow - 1;
  let scanCol = dataSheet.getRange(2, DATA_IDX.SCAN_STATUS + 1, n, 1).getValues();
  let delCol  = dataSheet.getRange(2, DATA_IDX.DELIVERY_STATUS + 1, n, 1).getValues();
  for (var i = 0; i < n; i++) {
    if (!scanCol[i][0]) scanCol[i][0] = DEFAULT_SCAN_STATUS;
    if (!delCol[i][0])  delCol[i][0]  = DEFAULT_DELIVERY_STATUS;
  }
  dataSheet.getRange(2, DATA_IDX.SCAN_STATUS + 1, n, 1).setValues(scanCol);
  dataSheet.getRange(2, DATA_IDX.DELIVERY_STATUS + 1, n, 1).setValues(delCol);
  logRun_('setStatusDefaults_', 'set defaults for ' + n + ' rows');
}

function setStatusDefaults_UI() {
  setStatusDefaults_();
  SpreadsheetApp.getUi().alert('✅ ตั้งค่า default Status เรียบร้อย');
}
