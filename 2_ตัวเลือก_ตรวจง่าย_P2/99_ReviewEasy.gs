/**
 * FILE: 99_ReviewEasy.gs
 * PURPOSE: สร้างแท็บ "ตรวจง่าย" จาก P2_FIX — อ่านง่าย ภาษาไทย ช่องเดิม/เสนอติดกัน
 *
 * หลักฐานจากชีตจริง (P2_FIX 22 คอลัมน์):
 *   ROW, MD_ID, LAT, LNG, MAPS_URL, N_TH(now), O_TH(now),
 *   U_OLD, V_OLD, W_OLD, X_OLD, GEO_LAYER_OLD,
 *   V_NEW, W_NEW, X_NEW, U_NEW, GEO_LAYER_NEW,
 *   X_VOTES, U_VOTES, KNN_VOTES_O, KNN_MED_M, FLAGS
 *
 * ธงจริงที่พบในข้อมูล: KNN_THIN(n/15), NV_CONFLICT(...)
 * MAPS_URL ในชีตเป็นสูตร =HYPERLINK(...) — getValues อ่านได้แค่คำว่า "แผนที่"
 * จึงสร้างลิงก์ใหม่จาก LAT/LNG
 *
 * ความปลอดภัย: อ่าน P2_FIX อย่างเดียว · ไม่แตะ MASTER_PLACE
 * รันซ้ำ: เก็บผลตรวจ/หมายเหตุเดิมด้วย MD_ID แล้วคืนหลังสร้างแท็บใหม่
 *
 * วิธีใช้:
 *   1) วางไฟล์นี้ใน Apps Script (ถ้ามีร่างเก่า ให้ลบแล้ววางใหม่ทั้งไฟล์)
 *   2) เลือกฟังก์ชัน createEasyReview → Run
 *   3) เปิดแท็บ "ตรวจง่าย" — เรียงเสี่ยงสูงบนสุด
 */
function createEasyReview() {
  var ss = SpreadsheetApp.getActive();
  var src = ss.getSheetByName('P2_FIX');
  if (!src) {
    return eaAlert_('ยังไม่พบแท็บ P2_FIX\n\nสร้างได้จากเมนู cleanup → เฟส 2 ตรวจอย่างเดียว (dry-run)');
  }

  var data = src.getDataRange().getValues();
  if (!data || data.length < 1) {
    return eaAlert_('P2_FIX ว่าง');
  }

  // ---- หาคอลัมน์จากชื่อหัว (ไม่ hard-code index) ----
  var heads = data[0].map(function (x) { return eaS_(x); });
  // รองรับทั้ง KNN_MED_M (ของจริง) และชื่อเก่าที่อาจพิมพ์ผิด
  var NEED = ['ROW', 'MD_ID', 'LAT', 'LNG', 'V_OLD', 'W_OLD', 'X_OLD',
              'V_NEW', 'W_NEW', 'X_NEW', 'KNN_VOTES_O', 'FLAGS'];
  var ix = {};
  for (var n = 0; n < NEED.length; n++) {
    ix[NEED[n]] = heads.indexOf(NEED[n]);
  }
  // ระยะ: ชื่อจริงคือ KNN_MED_M
  ix.DIST = heads.indexOf('KNN_MED_M');
  if (ix.DIST < 0) ix.DIST = heads.indexOf('KNN_MED_KM');

  var missing = NEED.filter(function (k) { return ix[k] < 0; });
  if (ix.DIST < 0) missing.push('KNN_MED_M');
  if (missing.length) {
    return eaAlert_('P2_FIX ขาดคอลัมน์: ' + missing.join(', ') +
      '\n\nหัวที่มีอยู่:\n' + heads.join(' | '));
  }
  if (data.length < 2) {
    return eaAlert_('P2_FIX ยังไม่มีแถวข้อมูล (มีแต่หัวตาราง)');
  }

  // ---- เก็บผลตรวจเดิมก่อนลบแท็บ ----
  var saved = eaHarvestOld_(ss);

  // ---- สร้างแถว + จัดความเสี่ยงจากธง/ข้อมูลจริง ----
  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var v = data[r];
    var mdId = eaS_(v[ix['MD_ID']]);
    var vo = eaS_(v[ix['V_OLD']]), vn = eaS_(v[ix['V_NEW']]);
    var wo = eaS_(v[ix['W_OLD']]), wn = eaS_(v[ix['W_NEW']]);
    var xo = eaS_(v[ix['X_OLD']]), xn = eaS_(v[ix['X_NEW']]);
    var flags = eaS_(v[ix['FLAGS']]);
    var votes = Number(v[ix['KNN_VOTES_O']]) || 0;
    var med = Number(v[ix.DIST]) || 0;
    var vChg = vo !== '' && vn !== '' && vo !== vn;
    var wChg = wo !== '' && wn !== '' && wo !== wn;
    var risk = eaRisk_(flags, vChg, wChg, votes, med);

    rows.push({
      // เสี่ยงสูงขึ้นก่อน · ในชั้นเดียวกันเอาระยะไกลก่อน
      score: risk.tier * 10000 - Math.round(med * 10) - votes,
      mdId: mdId,
      lat: eaS_(v[ix['LAT']]),
      lng: eaS_(v[ix['LNG']]),
      v: [
        eaS_(v[ix['ROW']]),
        mdId,
        '-', // คอลัมน์แผนที่ ใส่ลิงก์ทีหลัง
        vo, vn, vChg ? 'เปลี่ยน' : '—',
        wo, wn,
        xo, xn,
        votes,
        med,
        risk.txt,
        '', ''
      ]
    });
  }
  rows.sort(function (a, b) { return a.score - b.score; });

  // ---- สร้างแท็บ ----
  var oldSh = ss.getSheetByName('ตรวจง่าย');
  if (oldSh) ss.deleteSheet(oldSh);
  var sh = ss.insertSheet('ตรวจง่าย');

  var HEAD = [
    'แถวใน MASTER', 'รหัสร้าน (MD_ID)', 'เปิดแผนที่',
    'จังหวัด (เดิมในชีต)', 'จังหวัด (ระบบเสนอ)', 'จังหวัดเปลี่ยนไหม',
    'อำเภอ/เขต (เดิมในชีต)', 'อำเภอ/เขต (ระบบเสนอ)',
    'ตำบล/แขวง (เดิมในชีต)', 'ตำบล/แขวง (ระบบเสนอ)',
    'โหวตอำเภอเพื่อนบ้าน (เต็ม 15)', 'ระยะมัธยฐานเพื่อนบ้าน (กม.)',
    'ระดับความเสี่ยง', 'ผลตรวจ (เลือกจากลิสต์)', 'หมายเหตุ (พิมพ์อิสระ)'
  ];

  var nHigh = 0, nMid = 0, nSafe = 0, nDone = 0;
  rows.forEach(function (x) {
    if (x.v[12].indexOf('เสี่ยงสูง') === 0) nHigh++;
    else if (x.v[12].indexOf('เสี่ยงกลาง') === 0) nMid++;
    else nSafe++;
    if (saved[x.mdId] && saved[x.mdId][0]) nDone++;
  });

  sh.getRange(1, 1, 1, HEAD.length).merge();
  sh.getRange(1, 1).setValue(
    'อ่านจากบนลงล่าง — เรียงเสี่ยงสูงก่อน · เทียบ "เดิม" กับ "ระบบเสนอ" ที่อยู่ติดกัน · ' +
    'ช่องสี = ค่าที่ระบบจะเปลี่ยน · กด "เปิดแผนที่" แล้วเลือกผลตรวจทางขวา · ' +
    'รันซ้ำผลตรวจไม่หาย (จับคู่ MD_ID) · ทั้งหมด ' + rows.length +
    ' แถว (สูง ' + nHigh + ' · กลาง ' + nMid + ' · ปลอดภัย ' + nSafe +
    ' · ตรวจแล้ว ' + nDone + ') · หมายเหตุ: งานนี้เป็นชั้นคุณภาพชื่อเขต ไม่ใช่แกนพิกัดปุ่ม 1/2'
  ).setFontSize(9).setFontColor('#666666').setWrap(true);
  sh.setRowHeight(1, 48);

  sh.getRange(2, 1, 1, HEAD.length).setValues([HEAD])
    .setFontWeight('bold').setBackground('#1f3864').setFontColor('#ffffff')
    .setWrap(true).setVerticalAlignment('middle').setFontSize(10);

  var body = rows.map(function (x) { return x.v; });
  if (body.length) {
    sh.getRange(3, 1, body.length, HEAD.length).setValues(body);
  }

  // ---- ลิงก์แผนที่จาก LAT/LNG (ไม่พึ่ง MAPS_URL ที่เป็นสูตร) ----
  for (var k = 0; k < rows.length; k++) {
    var url = eaMapsUrl_(rows[k].lat, rows[k].lng);
    if (url) {
      sh.getRange(3 + k, 3).setRichTextValue(
        SpreadsheetApp.newRichTextValue().setText('เปิดแผนที่').setLinkUrl(url).build()
      );
    }
  }

  // ---- ความกว้าง / freeze / จัดรูปแบบ ----
  var w = [85, 105, 90, 130, 130, 85, 140, 140, 140, 140, 105, 110, 230, 120, 170];
  for (var cw = 0; cw < w.length; cw++) sh.setColumnWidth(cw + 1, w[cw]);
  sh.setFrozenRows(2);
  sh.setFrozenColumns(3);
  if (body.length) {
    sh.getRange(3, 1, body.length, HEAD.length).setFontSize(10);
    sh.getRange(3, 11, body.length, 2).setHorizontalAlignment('center');
    sh.getRange(3, 12, body.length, 1).setNumberFormat('0.0');
  }

  // ---- ไฮไลต์ช่องที่ระบบจะเปลี่ยน ----
  for (var k2 = 0; k2 < body.length; k2++) {
    var rr = k2 + 3;
    if (body[k2][3] !== '' && body[k2][4] !== '' && body[k2][3] !== body[k2][4]) {
      sh.getRange(rr, 5).setBackground('#ffc7ce');
      sh.getRange(rr, 6).setFontColor('#990000').setFontWeight('bold');
    }
    if (body[k2][6] !== '' && body[k2][7] !== '' && body[k2][6] !== body[k2][7]) {
      sh.getRange(rr, 8).setBackground('#fff2cc');
    }
    if (body[k2][8] !== '' && body[k2][9] !== '' && body[k2][8] !== body[k2][9]) {
      sh.getRange(rr, 10).setBackground('#fff2cc');
    }
  }

  // ---- สีระดับความเสี่ยง ----
  if (body.length) {
    var rk = sh.getRange(3, 13, body.length, 1);
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('เสี่ยงสูง')
        .setBackground('#f4cccc').setFontColor('#990000').setRanges([rk]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('เสี่ยงกลาง')
        .setBackground('#fce5cd').setFontColor('#b45f06').setRanges([rk]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('ปลอดภัย')
        .setBackground('#d9ead3').setFontColor('#38761d').setRanges([rk]).build()
    ]);

    sh.getRange(3, 14, body.length, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(
          ['ถูกทั้งหมด', 'อำเภอผิด', 'ตำบลผิด', 'จังหวัดผิด', 'ผิดหมด', 'ยังไม่ตรวจ'],
          true
        ).build()
    );
  }

  // ---- คืนผลตรวจเดิม ----
  var restored = 0;
  for (var k3 = 0; k3 < rows.length; k3++) {
    var sv = saved[rows[k3].mdId];
    if (sv && (sv[0] || sv[1])) {
      sh.getRange(3 + k3, 14, 1, 2).setValues([[sv[0], sv[1]]]);
      restored++;
    }
  }

  if (body.length) {
    sh.getRange(2, 1, body.length + 1, HEAD.length).createFilter();
  }

  eaAlert_('สร้างแท็บ "ตรวจง่าย" เสร็จ — ' + body.length + ' แถว' +
    (restored ? '\nคืนผลตรวจเดิม ' + restored + ' แถว (จับคู่ MD_ID)' : '') +
    '\n\nอ่านจากบนลงล่าง: เสี่ยงสูงอยู่บนสุด');
}

// ================= helpers =================

function eaS_(x) {
  return String(x === null || x === undefined ? '' : x).trim();
}

function eaAlert_(msg) {
  try {
    SpreadsheetApp.getUi().alert('ตรวจง่าย', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log(msg);
  }
}

function eaMapsUrl_(lat, lng) {
  var la = parseFloat(eaS_(lat));
  var lo = parseFloat(eaS_(lng));
  if (isNaN(la) || isNaN(lo)) return '';
  return 'https://www.google.com/maps?q=' + la + ',' + lo;
}

/**
 * ความเสี่ยงจากข้อมูลจริงใน FLAGS + การเปลี่ยนจังหวัด/อำเภอ + ระยะ
 * ธงจริงที่พบ: KNN_THIN(...), NV_CONFLICT(...)
 * ไม่สมมติชื่อธงที่ไม่มีในข้อมูล (เช่น V_MANUAL_QUEUE, KNN_FAR)
 */
function eaRisk_(flags, vChg, wChg, votes, med) {
  var f = flags || '';
  var high = [];
  var mid = [];

  if (vChg) high.push('จังหวัดเปลี่ยน → ดูมือ');
  if (med > 3) high.push('เพื่อนบ้านไกล >3 กม.');
  if (f.indexOf('NV_CONFLICT') >= 0) high.push('NV_CONFLICT');

  if (f.indexOf('KNN_THIN') >= 0) mid.push('โหวตบาง (KNN_THIN)');
  if (votes > 0 && votes < 10) mid.push('โหวต <10/15');
  if (votes >= 10 && votes <= 11) mid.push('โหวตคาบเส้น 10–11');
  if (wChg) mid.push('อำเภอ/เขตเปลี่ยน');

  if (high.length) return { tier: 1, txt: 'เสี่ยงสูง · ' + high.join(' + ') };
  if (mid.length) return { tier: 2, txt: 'เสี่ยงกลาง · ' + mid.join(' + ') };
  return { tier: 3, txt: 'ปลอดภัย · ไม่มีธงหนัก เปลี่ยนน้อย' };
}

/** เก็บผลตรวจ/หมายเหตุจากแท็บตรวจง่ายเดิม — จับคู่ด้วย MD_ID */
function eaHarvestOld_(ss) {
  var out = {};
  var oldSh = ss.getSheetByName('ตรวจง่าย');
  if (!oldSh) return out;
  try {
    var v = oldSh.getDataRange().getValues();
    var hRow = -1, cId = -1, cVerdict = -1, cNote = -1;
    for (var r = 0; r < Math.min(4, v.length); r++) {
      if (String(v[r].join('|')).indexOf('รหัสร้าน') >= 0) {
        hRow = r;
        break;
      }
    }
    if (hRow < 0) return out;
    for (var c = 0; c < v[hRow].length; c++) {
      var t = String(v[hRow][c] || '');
      if (t.indexOf('รหัสร้าน') >= 0) cId = c;
      if (t.indexOf('ผลตรวจ') >= 0) cVerdict = c;
      if (t.indexOf('หมายเหตุ') >= 0) cNote = c;
    }
    if (cId < 0 || cVerdict < 0) return out;
    for (var r2 = hRow + 1; r2 < v.length; r2++) {
      var md = eaS_(v[r2][cId]);
      var verdict = eaS_(v[r2][cVerdict]);
      var note = cNote >= 0 ? eaS_(v[r2][cNote]) : '';
      if (md && (verdict || note)) out[md] = [verdict, note];
    }
  } catch (e) {
    // แท็บเก่าอ่านไม่ได้ = เริ่มใหม่
  }
  return out;
}
