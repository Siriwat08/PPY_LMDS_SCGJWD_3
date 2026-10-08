/**
 * GeoService v5 — แยกพิกัดทางราชการ (รหัสไปรษณีย์ / จ. / อ.-ค. / ต.-ข.) จาก "ชื่อที่อยู่จาก_LatLong"
 * โดยเทียบกับพจนานุกรม SYS_TH_GEO (ฐานข้อมูลการปกครองไทย + รหัสไปรษณีย์)
 *
 * [v5.5.6 PATCH-6] นโยบาย Upgrade-only สำหรับ Y (Reversegeocode) แทน "latest snapshot"
 *   ปัญหา: ปุ่ม 3/3b กับแถวที่เติมแล้ว (มี GEO_LAYER) — U/V/W/X/AA แช่แข็ง แต่ Y/Z
 *   ถูกคัดลอกจาก SOURCE แถวล่าสุดทุกครั้งที่รัน → ที่อยู่ EN สะอาดโดนทับด้วยข้อความ
 *   ใหม่ที่อาจเป็นไทย/Plus Code/GeoErr และ X (ตำบล) กับ Y (ที่อยู่เต็ม) ขัดแย้งกัน
 *   หลักฐานจากข้อมูลจริง (PPY_LMDS_SCGJWD_test2): สถานที่ส่งซ้ำ 609/2,669 |
 *   Google คืนที่อยู่ต่างกันระหว่างการส่งแต่ละครั้ง 339 แห่ง | ตำบลต่างกันเลย 23 แห่ง
 *   กติกาใหม่ (B. Upgrade-only):
 *     - Y เป็น EN สะอาดอยู่แล้ว → ห้ามถูกทับเด็ดขาด (แช่แข็ง)
 *     - Y เป็นขยะ (ไทย/Plus Code/GeoErr/ว่าง) → อัปเกรดอัตโนมัติด้วย EN สะอาด "ล่าสุด"
 *       ของสถานที่นั้นจาก SOURCE (cleanEnByMdId ใน getGeoSourceIndex_)
 *       พร้อม Z จากแถว SOURCE เดียวกัน (คู่ Y-Z ตรงกันเสมอ)
 *     - Z (Calculatedistances) เติมเฉพาะช่องว่าง (fill-don't-destroy) ไม่ทับค่าเดิม
 *     - ช่องทางเติมใหม่ (layer ว่าง/NO_MATCH/ไทย) กันดาวน์เกรด Y สะอาดเช่นกัน (buildGeoFillRow_)
 *   ตัวชี้วัดใหม่ใน log และผลลัพธ์: yFrozen (แช่แข็ง) / yUpgraded (อัปเกรด ขยะ→EN)
 *   หมายเหตุ: ปุ่ม 1 (runMaster) เขียนเฉพาะ A-T ไม่เกี่ยวกับ PATCH นี้ — ตัวเขียนทับคือ 3/3b
 * [v5.5.4 PATCH-4] CHECK_NOTE + รหัสยืนยัน → CN_ZIP_OK / CN_ZIP_OK_EN
 *   ปัญหา: ตำบลที่มีหมายเหตุ (note_type=CHECK_NOTE เช่น มีหลายรหัสไปรษณีย์ตามหมู่)
 *   ถูกบล็อกทั้งหมด ทั้งที่ข้อความ reverse geocode ระบุรหัสไปรษณีย์มาเองแล้ว
 *   และรหัสนั้นตรงกับแถวใน SYS_TH_GEO ของตำบลนั้น (ผ่าน pickRowByPostal_ ชั้น 1-2)
 *   แก้: ถ้ารหัสในข้อความ == รหัสของแถว dict ที่แมชต์ → เติมได้ เลเยอร์ = CN_ZIP_OK(_EN)
 *   ผลทดสอบ (PPY_LMDS_SCGJWD_test 2,669 แถว): CHECK_NOTE 178 → เหลือ 20
 *   เติมสำเร็จ 92.8% → 98.7% | ที่ไม่ผ่าน (Google ให้รหัสไม่ตรงเซต 11 + ไม่มีชื่อตำบล 9) ยังบล็อกเหมือนเดิม
 * [v5.5.4 PATCH-5] เพิ่ม uiClearGeoColumnsOnly() — ล้างเฉพาะ 7 คอลัมน์ U-AA ทั้งชีต
 *   ใช้ก่อนรันปุ่ม 3/3b ใหม่ เพื่อให้แถวที่เคยเติมผิด (รอบรันเก่า) ได้ค่าใหม่
 *   (ปกติระบบ skip แถวที่มี GEO_LAYER อยู่แล้ว — ค่าเก่าผิดจะค้างถ้าไม่ล้าง)
 *
 * v5 = v4 + 2 Bug fixes + 1 logic change
 *   1) [v5 BUG A FIX] Fallback tambon: เปลี่ยนจาก "ใช้ amphoe name แทน" → "เว้นว่าง (ไม่เดา)"
 *   2) [v5 BUG B FIX] POSTAL_AMPHOE/AMPHOE_PROV: ค้นหา tambon ใน text ก่อนเลือกแถว
 *      - เปลี่ยน byPostalAmphoe/byAmphoeProv จาก key→first_row เป็น key→array
 *      - ใช้ findRowByTambonInText_() helper ค้นหาแถวที่ tambon ตรงกับ text
 *      - ถ้าไม่เจอ → return null (ไม่ fallback เป็น amphoe name)
 *   3) [v5 LOGIC] ปุ่ม 3 เขียนเฉพาะ 7 คอลัมน์ U-AA (Rahatpraisanee..GEO_LAYER) เท่านั้น
 *      CONFIRMED_BY (P) และ REVIEW_NOTE (Q) ย้ายไปเป็นของปุ่ม 1 (runMaster) เขียนจาก [ที่อยู่ปลายทาง]
 *
 * v4 = ยืมเทคนิคจาก ThGeoService ของโปรเจกต์อื่น + คง regex คำนำหน้าเป็นหลัก (improve ล้วน ถดถอย 0)
 *   1) scan จังหวัด/อำเภอ/ตำบล จากชื่อที่มีจริงใน SYS_TH_GEO (1-hit rule) ใช้เป็น fallback
 *      เมื่อข้อมูลไม่มีคำนำหน้า "จ./อ./ต." กำกับ (แก้ปัญหาแถว Plus Code/รหัสหาย — เช่น '60 เมือง นนทบุรี 11000')
 *   2) เพิ่มชั้น POSTAL_AMPHOE (รหัส + อำเภอ) — แมชต์เพิ่ม 242 แถว
 *   3) CacheService 6 ชม. + batch เขียนทีละ 500 แถว (กัน Timeout ชีตใหญ่)
 *   4) เพิ่มชั้น fuzzy TAMBON_FUZZY/AMPHOE_FUZZY (bigram >= 0.80) — แก้แถวสะกดเพี้ยน (เช่น "สำรีจชรใหญ่")
 *
 * เสริมคอลัมน์ 7 ตัวใน MASTER_PLACE (U–AA):
 *   U Rahatpraisanee    = รหัสไปรษณีย์ 5 หลักของพื้นที่ (มาตรฐานจาก SYS_TH_GEO col A)
 *   V Changwat          = จังหวัด (ไม่มีคำว่า "จังหวัด") (มาตรฐานจาก SYS_TH_GEO col D)
 *   W Amphoe_Khet       = อำเภอ/เขต (ไม่มีคำนำหน้า) (มาตรฐานจาก SYS_TH_GEO col G)
 *   X Tambon_Kwaeng     = ตำบล/แขวง (ไม่มีคำนำหน้า) (มาตรฐานจาก SYS_TH_GEO col F)
 *   Y Reversegeocode    = คัดลอก "ชื่อที่อยู่จาก_LatLong" ตรง ๆ
 *   Z Calculatedistances= คัดลอก "ระยะทางจากคลัง_Km" (col Y ของ MASTER_PLACE) ตรง ๆ
 *   AA GEO_LAYER        = ชั้นที่แมชต์ได้ (EXACT3/POSTAL_RHSTB/POSTAL_AMPHOE/TAMBON_PROV/AMPHOE_PROV/TAMBON_FUZZY/AMPHOE_FUZZY)
 *                        [v5.5.4] CN_ZIP_OK(_EN) = ตำบล CHECK_NOTE แต่รหัสในข้อความยืนยันแล้ว / CHECK_NOTE = ยังต้องตรวจมือ
 *
 * Logic เทียบ SYS_TH_GEO (7 ชั้น, หยุดทันทีที่เจอ):
 *   1) EXACT3        = ต.+อ.+จ. เทียบ search_key (col M)
 *   2) POSTAL_RHSTB  = รหัส + ตำบล เทียบ postal_key (col N)
 *   3) POSTAL_AMPHOE = รหัส + อำเภอ (ชั้นใหม่ v4)
 *   4) TAMBON_PROV   = ตำบล + จังหวัด
 *   5) AMPHOE_PROV   = อำเภอ + จังหวัด
 *   6) TAMBON_FUZZY  = fuzzy ตำบล (bigram >= 0.80 กรองตามจังหวัด) — แก้สะกดเพี้ยน
 *   7) AMPHOE_FUZZY  = fuzzy อำเภอ (bigram >= 0.80 กรองตามจังหวัด) — แก้สะกดเพี้ยน
 *
 * *** สำคัญ (ความต้องการจริง): ***
 *   1) แมชต์จากพจนานุกรมได้ → ใช้ข้อความมาตรฐานที่สะอาดแล้วจาก SYS_TH_GEO ลงฐานเสมอ
 *   2) ไม่แมชต์กับพจนานุกรม → 4 คอลัมน์ราชการเว้นว่าง ไม่บันทึกค่าผิดลงฐาน
 *   3) คอลัมน์ GEO_LAYER บันทึกชั้นที่แมชต์ได้ — ตรวจสอบกลับได้ว่าแต่ละค่ามาจากพจนานุกรมชั้นไหน
 *
 * ทดสอบด้วยข้อมูลจริง 13,935 แถว × SYS_TH_GEO ของจริง (7,536 แถว):
 *   v3: 99.4% (89 เว้นว่าง) → v4: 99.6% (แมชต์ 13,881 / เว้นว่าง 54 = 0.4%) / ถดถอย 0
 *   แถว 696 ที่ไม่มีคำนำหน้าตำบล/แขวง: v3=609 → v4=643 (92.4%)
 *
 * หมายเหตุจากการทดสอบจริง (15 ส.ค.):
 *   - search_key (col M) ใช้ตัวคั่น '|' — EXACT3 เทียบด้วย 'ต|อ|จ' (หลัง norm รายส่วน v5.5.0)
 *   - postal_key (col N) ใช้ตัวคั่น '|' — POSTAL_RHSTB เทียบด้วย 'รหัส|ตำบล' (หลัง norm รายส่วน v5.5.0)
 *   - [v5.5.0] key ทั้ง 2 ฝั่ง normalize ด้วย normArea_/normAreaEn_ ชุดเดียวกัน → ไม่มี dead zone กลุ่ม "เมือง..."
 */

// v5.3.1+ : ใช้ SHEETS.GEO_DICT และ GEO_DICT_IDX จาก 00_Config.gs
const TH_GEO_SHEET = SHEETS.GEO_DICT;  // 'SYS_TH_GEO'
// [v5.3 PERF] แยก cache เป็น 2 ก้อน (TH/EN) เพื่อหลีกเลี่ยง 90KB limit
// เดิม v5.2 ใช้ key เดียว 'geo_v52_idx_32col_en' → JSON เกิน 90KB → cache.put() ไม่ทำงาน
// [v5.5.0 FIX landmine] เปลี่ยนชื่อ key geo_v53_* → geo_v55_* + ฝังเวอร์ชันใน payload
//   เหตุผล: format key ใน index เปลี่ยนตั้งแต่ v5.4.5 (delimiter + norm) แต่ชื่อ cache ยังเดิม
//   วันนี้ put ถูก skip เสมอ (เกิน 90KB) จึงยังไม่เป็นอันตราย — แต่ถ้าอนาคตย่อ index จน put สำเร็จ
//   cache เก่ารุ่น space-delimiter จะทำให้ Dead Layer กลับมาโดยไม่รู้ตัว จึงตัดตอนนี้เสียก่อน
const TH_GEO_CACHE_KEY_TH = 'geo_v55_th_idx';
const TH_GEO_CACHE_KEY_EN = 'geo_v55_en_idx';
const GEO_IDX_VER = 2;               // เวอร์ชันโครงสร้าง index — บังคับเปลี่ยนทุกครั้งที่แก้ format key
const GEO_CACHE_MAX_ROWS = 120;      // ~120 แถว × ~850 chars/แถว ≈ 100KB > 90KB → เกินแน่นอน
const TH_GEO_CACHE_S = 6 * 3600; // cache 6 ชม. (ตาม pattern ThGeoService)

// [v5.5.0] Alias จังหวัด EN — Google reverse geocode คืน "Krung Thep Maha Nakhon"
// แต่พจนานุกรม SYS_TH_GEO ใช้ "Bangkok" → ลงทะเบียน index ทั้ง 2 ชื่อ (สองทิศทาง)
//   หลักฐาน: MASTER_PLACE แถวที่ 268 ข้อความ "...Khet Thung Khru, Krung Thep Maha Nakhon 10100"
//   เดิม layer EN 1/4/5 ไม่เคย match จังหวัดนี้ (รอดมาได้เพราะชั้น 2 รหัส+ตำบล ซึ่งไม่แตะจังหวัด)
const PROV_ALIAS_EN = { krungthepmahanakhon: 'bangkok', bangkok: 'krungthepmahanakhon' };

/** pattern regex ดึงชื่อพื้นที่ (ใช้ก่อน scan fallback เสมอ) */
const GEO_POSTAL_RE = /\b(\d{5})\b/;
const GEO_TAMBON_RE = /(?:ต\.|ตำบล|แขวง)\s*([^\s,]+)/;
const GEO_AMPHOE_RE = /(?:อ\.|อำเภอ|เขต(?!อุตสาหกรรม|นิคม))\s*([^\s,]+)/;  // [v5.5.0 L-9] negative lookahead
const GEO_PROVINCE_RE = /(?:จ\.|จังหวัด)\s*([\u0E00-\u0E7F]{2,})/;
const GEO_BKK_RE = /กรุงเทพ(?:มหานคร)?/;
/** fallback 1: คำไทย 2+ ตัวที่อยู่หน้ารหัสไปรษณีย์ 5 หลัก */
const GEO_PROV_FALLBACK_RE = /([\u0E00-\u0E7F]{2,})\s+\d{5}\b/;

/** ดัชนีพจนานุกรม (global per-run) */
let _GEO_IDX = null;
const GEO_MAX_MS = 5 * 60 * 1000;

/**
 * GEO_COL — alias สำหรับ backward compat
 * ใช้ GEO_DICT_IDX จาก 00_Config.gs เป็น source of truth
 * (ค่าตัวเลขตรงกัน 100% — GEO_COL เก็บไว้เพื่อไม่ break โค้ดเดิม)
 *
 * ถ้าจะ refactor ในอนาคต: เปลี่ยน GEO_COL.X → GEO_DICT_IDX.X
 */
const GEO_COL = GEO_DICT_IDX;

/**
 * loadGeoIdx_ — โหลด + build index จาก SYS_TH_GEO (ทำครั้งเดียวต่อรอบ run)
 * ดัชนี: bySearch[search_key], byPostal[postal_key], byTambonProv[ต.|จ.],
 *        byAmphoeProv[อ.|จ.], byPostalAmphoe[รหัส|อ.], scanAmphoe[จ.=set],
 *        scanTambon[จ.=set], scanTambonByAmphoe[จ.+อ.=set]
 * [v5.2 ENGLISH] เพิ่ม bySearch_EN, byPostal_EN, byTambonProv_EN,
 *        byAmphoeProv_EN, byPostalAmphoe_EN (parallel indexes)
 * บันทึก bySearch ลง CacheService 6 ชม. (ชุดเดียว <90KB)
 */
function loadGeoIdx_() {
  if (_GEO_IDX) return _GEO_IDX;
  let idx = { bySearch: {}, byPostal: {}, byTambonProv: {}, byAmphoeProv: {},
              byPostalAmphoe: {}, scanAmphoe: {}, scanTambon: {}, scanTambonByAmphoe: {},
              fuzzyByProv: {},
              // [v5.2 ENGLISH] parallel indexes
              bySearch_EN: {}, byPostal_EN: {}, byTambonProv_EN: {}, byAmphoeProv_EN: {},
              byPostalAmphoe_EN: {},
              // [v5.3 PERF] เพิ่ม index ใหม่สำหรับ English path
              fuzzyByProv_EN: {},    // สำหรับ English fuzzy matching (fix bug #3)
              byProvince_EN: {},     // สำหรับ O(1) province pool lookup (fix bug #4)
              provinceList_EN: []
            };

  // [v5.3 PERF] ลองอ่าน cache แยก 2 ก้อน (TH/EN) — ถ้าก้อนใดไม่ครบ rebuild เฉพาะก้อนนั้น
  let cache = CacheService.getScriptCache();
  let thJson = null, enJson = null;
  try { thJson = cache.get(TH_GEO_CACHE_KEY_TH); } catch (e) {}
  try { enJson = cache.get(TH_GEO_CACHE_KEY_EN); } catch (e) {}

  let thPart = null, enPart = null;
  if (thJson) { try { thPart = JSON.parse(thJson); } catch (e) {} }
  if (enJson) { try { enPart = JSON.parse(enJson); } catch (e) {} }

  // ตรวจ cache TH ว่ามี field ครบ + [v5.5.0] เวอร์ชันโครงสร้างตรงกัน (กัน cache รุ่นเก่า)
  let thValid = thPart && thPart.__v === GEO_IDX_VER && thPart.bySearch && thPart.byPostal && thPart.byTambonProv &&
                thPart.byAmphoeProv && thPart.byPostalAmphoe && thPart.scanAmphoe &&
                thPart.scanTambon && thPart.scanTambonByAmphoe && thPart.fuzzyByProv;
  // ตรวจ cache EN ว่ามี field ครบ (v5.3 เพิ่ม fuzzyByProv_EN + byProvince_EN) + เวอร์ชัน
  let enValid = enPart && enPart.__v === GEO_IDX_VER && enPart.bySearch_EN && enPart.byPostal_EN && enPart.byTambonProv_EN &&
                enPart.byAmphoeProv_EN && enPart.byPostalAmphoe_EN && enPart.provinceList_EN &&
                enPart.fuzzyByProv_EN && enPart.byProvince_EN;

  if (thValid && enValid) {
    // merge TH + EN parts กลับเป็น flat idx
    Object.keys(thPart).forEach(function (k) { idx[k] = thPart[k]; });
    Object.keys(enPart).forEach(function (k) { idx[k] = enPart[k]; });
    _GEO_IDX = idx;
    console.log('GeoService v5.3: cache hit (2 cache) TH=' + Object.keys(idx.bySearch).length + ' EN=' + Object.keys(idx.bySearch_EN).length);
    return _GEO_IDX;
  }

  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TH_GEO_SHEET);
  if (!sh || sh.getLastRow() < 2) {
    _GEO_IDX = idx;
    return idx;
  }
  // [v5.2 ENGLISH] อ่าน 32 columns (A..AF) เพื่อเอา English columns ด้วย
  let rows = sh.getRange(2, 1, sh.getLastRow() - 1, 32).getValues();

  // [v5.3 PERF] ใช้ cached parts ถ้ามี — ไม่ต้อง rebuild
  let thPartBuild = thValid ? thPart : {
    bySearch: {}, byPostal: {}, byTambonProv: {}, byAmphoeProv: {},
    byPostalAmphoe: {}, scanAmphoe: {}, scanTambon: {}, scanTambonByAmphoe: {},
    fuzzyByProv: {}
  };
  let enPartBuild = enValid ? enPart : {
    bySearch_EN: {}, byPostal_EN: {}, byTambonProv_EN: {}, byAmphoeProv_EN: {},
    byPostalAmphoe_EN: {}, provinceList_EN: [], fuzzyByProv_EN: {},
    byProvince_EN: {}
  };

  for (var i = 0; i < rows.length; i++) {
    let r = rows[i];
    // === Thai indexes (existing v5.1) ===
    let pn = normArea_(String(r[GEO_COL.PROVINCE_NORM] || ''));
    let an = normArea_(String(r[GEO_COL.AMPHOE_NORM] || ''));
    let tn = normArea_(String(r[GEO_COL.TAMBON_NORM] || ''));
    let sk = String(r[GEO_COL.SEARCH_KEY] || '').trim();
    let pk = String(r[GEO_COL.POSTAL_KEY] || '').trim();
    let pc = String(r[GEO_COL.POSTAL] || '').trim();
    // [v5.5.0] normalize key รายส่วนด้วย normArea_ — ให้ index ตรงกับฝั่ง lookup เป๊ะ
    //   แก้ dead zone กลุ่ม "เมือง...": เช่น search_key "บางโปรง|เมืองสมุทรปราการ|สมุทรปราการ"
    //   เดิม (v5.4.7) index เก็บคำเต็ม แต่ lookup ผ่าน normArea_ ตัด "เมือง" ทิ้ง → EXACT3 พลาด 1,210 แถว
    //   และ postal_key "18160|เมืองเก่า" → lookup "18160|เก่า" → พลาดอีก 74 แถว
    if (sk) {
      let skNorm = normSearchKey_(sk, normArea_);
      // [v5.5.0 M-1] เก็บ array แทน row เดียว — กัน search_key ซ้ำ (97 คีย์) ทับซ้อน postal
      if (skNorm && !thPartBuild.bySearch[skNorm]) thPartBuild.bySearch[skNorm] = [];
      if (skNorm) thPartBuild.bySearch[skNorm].push(r);
    }
    if (pk) {
      let pkNorm = normPostalKey_(pk, normArea_);
      // [v5.5.0 M-1] array เช่นกัน — ใช้ pickRowByPostal_ กรอง row ที่ postal ตรงตอน lookup
      if (pkNorm && !thPartBuild.byPostal[pkNorm]) thPartBuild.byPostal[pkNorm] = [];
      if (pkNorm) thPartBuild.byPostal[pkNorm].push(r);
    }
    if (tn && pn) { var k3 = tn + '|' + pn; if (!thPartBuild.byTambonProv[k3]) thPartBuild.byTambonProv[k3] = r; }
    if (an && pn) { var k4 = an + '|' + pn; if (!thPartBuild.byAmphoeProv[k4]) thPartBuild.byAmphoeProv[k4] = []; thPartBuild.byAmphoeProv[k4].push(r); }
    if (pc && an) { var k5 = pc + '|' + an; if (!thPartBuild.byPostalAmphoe[k5]) thPartBuild.byPostalAmphoe[k5] = []; thPartBuild.byPostalAmphoe[k5].push(r); }
    if (an && pn) { (thPartBuild.scanAmphoe[pn] || (thPartBuild.scanAmphoe[pn] = {}))[an] = true; }
    if (tn && pn) { (thPartBuild.scanTambon[pn] || (thPartBuild.scanTambon[pn] = {}))[tn] = true; }
    if (an && tn && pn) { (thPartBuild.scanTambonByAmphoe[pn + '|' + an] || (thPartBuild.scanTambonByAmphoe[pn + '|' + an] = {}))[tn] = true; }
    if (pn) { (thPartBuild.fuzzyByProv[pn] || (thPartBuild.fuzzyByProv[pn] = [])).push({ tn: tn, an: an, row: r }); }

    // === [v5.2 ENGLISH] parallel indexes ===
    let pn_en = normAreaEn_(String(r[GEO_COL.PROVINCE_NORM_EN] || ''));
    let an_en = normAreaEn_(String(r[GEO_COL.AMPHOE_NORM_EN] || ''));
    let tn_en = normAreaEn_(String(r[GEO_COL.TAMBON_NORM_EN] || ''));
    let sk_en = String(r[GEO_COL.SEARCH_KEY_EN] || '').trim();
    let pk_en = String(r[GEO_COL.POSTAL_KEY_EN] || '').trim();
    let pc_en = String(r[GEO_COL.POSTCODE_EN] || '').trim();
    // [v5.5.0] normalize EN key รายส่วนด้วย normAreaEn_ — ให้ตรงฝั่ง lookup เป๊ะ (เช่นเดียวกับฝั่งไทย)
    //   "Ban Bat|Pom Prap Sattru Phai|Bangkok" → "banbat|pomprapsattruphai|bangkok"
    if (sk_en) {
      let skNorm = normSearchKey_(sk_en, normAreaEn_);
      // [v5.5.0 M-1] array เพื่อรองรับ postal disambig
      if (skNorm && !enPartBuild.bySearch_EN[skNorm]) enPartBuild.bySearch_EN[skNorm] = [];
      if (skNorm) enPartBuild.bySearch_EN[skNorm].push(r);
      // [v5.5.0] alias จังหวัด: ลงทะเบียน key ที่สลับ Bangkok ↔ Krung Thep Maha Nakhon ด้วย
      let skAlias = provAliasSearchKeyEn_(skNorm, pn_en);
      if (skAlias && !enPartBuild.bySearch_EN[skAlias]) enPartBuild.bySearch_EN[skAlias] = [];
      if (skAlias) enPartBuild.bySearch_EN[skAlias].push(r);
    }
    if (pk_en) {
      let pkNorm = normPostalKey_(pk_en, normAreaEn_);
      // [v5.5.0 M-1] array
      if (pkNorm && !enPartBuild.byPostal_EN[pkNorm]) enPartBuild.byPostal_EN[pkNorm] = [];
      if (pkNorm) enPartBuild.byPostal_EN[pkNorm].push(r);
    }
    // [v5.5.0] alias จังหวัดสำหรับ index ที่มีจังหวัดเป็นส่วนประกอบ
    let pn_en_alias = PROV_ALIAS_EN[pn_en] || '';
    if (tn_en && pn_en) {
      var k3_en = tn_en + '|' + pn_en; if (!enPartBuild.byTambonProv_EN[k3_en]) enPartBuild.byTambonProv_EN[k3_en] = r;
      if (pn_en_alias) { var k3a_en = tn_en + '|' + pn_en_alias; if (!enPartBuild.byTambonProv_EN[k3a_en]) enPartBuild.byTambonProv_EN[k3a_en] = r; }
    }
    if (an_en && pn_en) {
      var k4_en = an_en + '|' + pn_en; if (!enPartBuild.byAmphoeProv_EN[k4_en]) enPartBuild.byAmphoeProv_EN[k4_en] = []; enPartBuild.byAmphoeProv_EN[k4_en].push(r);
      if (pn_en_alias) { var k4a_en = an_en + '|' + pn_en_alias; if (!enPartBuild.byAmphoeProv_EN[k4a_en]) enPartBuild.byAmphoeProv_EN[k4a_en] = []; enPartBuild.byAmphoeProv_EN[k4a_en].push(r); }
    }
    if (pc_en && an_en) { var k5_en = pc_en + '|' + an_en; if (!enPartBuild.byPostalAmphoe_EN[k5_en]) enPartBuild.byPostalAmphoe_EN[k5_en] = []; enPartBuild.byPostalAmphoe_EN[k5_en].push(r); }
    // [v5.3 PERF] เพิ่ม English fuzzy index — bug #3 fix (+ [v5.5.0] alias)
    if (pn_en) {
      (enPartBuild.fuzzyByProv_EN[pn_en] || (enPartBuild.fuzzyByProv_EN[pn_en] = [])).push({ tn: tn_en, an: an_en, row: r });
      // [v5.3 PERF] เพิ่ม byProvince_EN สำหรับ O(1) lookup — bug #4 fix
      (enPartBuild.byProvince_EN[pn_en] || (enPartBuild.byProvince_EN[pn_en] = [])).push(r);
      if (pn_en_alias) {
        (enPartBuild.fuzzyByProv_EN[pn_en_alias] || (enPartBuild.fuzzyByProv_EN[pn_en_alias] = [])).push({ tn: tn_en, an: an_en, row: r });
        (enPartBuild.byProvince_EN[pn_en_alias] || (enPartBuild.byProvince_EN[pn_en_alias] = [])).push(r);
      }
    }
  }

  // [v5.2 ENGLISH] Build unique province list for scanning fallback (keys already normalized)
  enPartBuild.provinceList_EN = [];
  for (let sk2 in enPartBuild.bySearch_EN) {
    let parts = sk2.split('|');
    if (parts.length === 3 && parts[2] && enPartBuild.provinceList_EN.indexOf(parts[2]) < 0) {
      enPartBuild.provinceList_EN.push(parts[2]);
    }
  }

  // [v5.3 PERF] write-back 2 cache แยกกัน — หลีกเลี่ยง 90KB limit
  // [v5.5.0] ฝังเวอร์ชันโครงสร้างลง payload + เช็คขนาดล่วงหน้าก่อน stringify
  //   ข้อมูลจริง 7,536 แถว → stringify ~6.4M chars/ก้อน (รวม ~12.9M chars) เปล่า ๆ ทุกครั้งที่รัน
  //   แถม put ก็ไม่สำเร็จอยู่ดี → ถ้า rows เกิน GEO_CACHE_MAX_ROWS ข้ามทั้ง stringify และ put ไปเลย
  thPartBuild.__v = GEO_IDX_VER;
  enPartBuild.__v = GEO_IDX_VER;
  if (rows.length <= GEO_CACHE_MAX_ROWS) {
    try {
      let thJsonOut = JSON.stringify(thPartBuild);
      if (thJsonOut.length < 90000) {
        cache.put(TH_GEO_CACHE_KEY_TH, thJsonOut, TH_GEO_CACHE_S);
      } else {
        console.log('GeoService: TH cache size ' + thJsonOut.length + ' exceeds 90KB, skip');
      }
    } catch (e) { console.log('GeoService: TH cache put skip: ' + e.message); }
    try {
      let enJsonOut = JSON.stringify(enPartBuild);
      if (enJsonOut.length < 90000) {
        cache.put(TH_GEO_CACHE_KEY_EN, enJsonOut, TH_GEO_CACHE_S);
      } else {
        console.log('GeoService: EN cache size ' + enJsonOut.length + ' exceeds 90KB, skip');
      }
    } catch (e) { console.log('GeoService: EN cache put skip: ' + e.message); }
  } else {
    console.log('GeoService v5.5: ' + rows.length + ' rows > ' + GEO_CACHE_MAX_ROWS +
                ' → cache ต้องเกิน 90KB แน่นอน ข้าม stringify/put (rebuild ต่อครั้งอยู่แล้ว)');
  }

  // merge parts กลับเป็น flat idx (เพื่อ backward-compat กับ code ที่ใช้ idx.bySearch, idx.bySearch_EN)
  Object.keys(thPartBuild).forEach(function (k) { idx[k] = thPartBuild[k]; });
  Object.keys(enPartBuild).forEach(function (k) { idx[k] = enPartBuild[k]; });

  _GEO_IDX = idx;
  console.log('GeoService v5.3: โหลด SYS_TH_GEO Thai ' + Object.keys(idx.bySearch).length +
              ' + EN ' + Object.keys(idx.bySearch_EN).length + ' คีย์ (cache 2 ก้อน)');
  return _GEO_IDX;
}

/** รีเซ็ต cache (ใช้เมื่อ SYS_TH_GEO ปรับปรุงแล้ว) — [v5.3] ลบ 2 cache */
function clearThGeoCache() {
  _GEO_IDX = null;
  try { CacheService.getScriptCache().remove(TH_GEO_CACHE_KEY_TH); } catch (e) {}
  try { CacheService.getScriptCache().remove(TH_GEO_CACHE_KEY_EN); } catch (e) {}
}

/** Normalize ชื่อพื้นที่ให้ตรงกับ SYS_TH_GEO: lowercase + ตัดคำนำหน้า + ลบช่องว่าง */
function normArea_(s) {
  if (!s) return '';
  return String(s).toLowerCase()
    .replace(/^(ต\.|อ\.|จ\.|แขวง|เขต|ตำบล|อําเภอ|อำเภอ|จังหวัด|หมู่|เมือง)\s*/g, '')
    .replace(/\s+/g, '').trim();
}

/** [v5.2 ENGLISH] Normalize ชื่อพื้นที่ภาษาอังกฤษ: lowercase + ตัดคำนำหน้า (Khwaeng/Khet/Tambon/Amphoe/District/Province) + ลบช่องว่าง */
function normAreaEn_(s) {
  if (!s) return '';
  return String(s).toLowerCase()
    .replace(/^(khwaeng|tambon|khet|amphoe|district|province|sub-district|subdistrict)\s*/g, '')
    .replace(/\s+/g, '').trim();
}

/**
 * [v5.5.0] normSearchKey_ — normalize search_key "ต|อ|จ" รายส่วนด้วย normFn (normArea_ / normAreaEn_)
 * ให้ key ที่ index เก็บตรงกับ key ที่ฝั่ง lookup สร้างจาก geoExtract_ เป๊ะ
 *   เช่น TH "บางโปรง|เมืองสมุทรปราการ|สมุทรปราการ" → "บางโปรง|สมุทรปราการ|สมุทรปราการ"
 *   (lookup ผ่าน normArea_ ตัดคำนำหน้า "เมือง" ทิ้ง — index ต้องตัดแบบเดียวกัน)
 * ถ้า format ไม่ใช่ 3 ส่วน (ไม่คาดคิด) → fallback เป็น lower+ลบช่องว่างทั้ง key เหมือน v5.4.7
 */
function normSearchKey_(sk, normFn) {
  let s = String(sk || '');
  let parts = s.split('|');
  if (parts.length === 3) {
    return parts.map(function (p) { return normFn(p); }).join('|');
  }
  return s.toLowerCase().replace(/\s+/g, '');
}

/**
 * [v5.5.0] normPostalKey_ — normalize postal_key "รหัส|ตำบล" รายส่วนด้วย normFn
 *   เช่น "18160|เมืองเก่า" → "18160|เก่า" (lookup ผ่าน normArea_ ตัด "เมือง" — index ต้องตัดด้วย)
 * ตัวเลขรหัสไปรษณีย์ไม่ได้รับผลจาก normFn (ไม่มีคำนำหน้า/ช่องว่าง)
 */
function normPostalKey_(pk, normFn) {
  let s = String(pk || '');
  let i = s.indexOf('|');
  if (i > 0) return normFn(s.slice(0, i)) + '|' + normFn(s.slice(i + 1));
  return s.toLowerCase().replace(/\s+/g, '');
}

/** [v5.5.0 M-1] pickRowByPostal_ — เลือก row จาก array ที่ postal ตรงกับ input
 *  ใช้ตอน lookup bySearch/byPostal ที่ search_key ซ้ำ (97 คีย์) แต่ postal ต่าง
 *  @param {Array} rows - array ของ row objects
 *  @param {string} postal - รหัสไปรษณีย์ที่จะกรอง (5 หลัก)
 *  @return {Object|null} row แรกที่ postal ตรง หรือ row แรกถ้าไม่มี postal
 */
function pickRowByPostal_(rows, postal) {
  if (!rows || !rows.length) return null;
  if (!postal) return rows[0];
  let p = String(postal).trim();
  for (let i = 0; i < rows.length; i++) {
    let rowPost = String(rows[i][GEO_COL.POSTAL] || '').trim();
    if (rowPost === p) return rows[i];
  }
  // ไม่เจอ row ที่ postal ตรง — fallback row แรก (เหมือนเดิม)
  return rows[0];
}

/** [v5.5.0] provAliasSearchKeyEn_ — สร้าง key alias ของ bySearch_EN โดยสลับชื่อจังหวัด (ส่วนท้าย)
 *  เช่น "thungkhru|thungkhru|bangkok" → "thungkhru|thungkhru|krungthepmahanakhon" */
function provAliasSearchKeyEn_(skNorm, pnEn) {
  let alias = PROV_ALIAS_EN[pnEn] || '';
  if (!alias || !skNorm || skNorm.indexOf('|') < 0) return '';
  return skNorm.slice(0, skNorm.lastIndexOf('|') + 1) + alias;
}

/**
 * geoExtract_ — ดึง ต./อ./จ./รหัส (regex ก่อน → scan fallback ตาม pattern ThGeoService)
 *   - จังหวัด: จ./จังหวัด → กทม. → คำไทยหน้ารหัส → คำไทยท้ายข้อความ (ยกเว้น ไทย/ประเทศ/ประเทศไทย)
 *   - อำเภอ: regex อ./อำเภอ/เขต → ถ้าไม่เจอ → สแกนชื่ออำเภอจริงในจังหวัดนั้น (เจอ 1 ตัวเท่านั้นถึงใช้)
 *   - ตำบล: regex ต./ตำบล/แขวง → ถ้าไม่เจอ → สแกนชื่อตำบลจริงใน จ.+อ. (เจอลำดับ 1 ถึงใช้)
 * @returns {object} {tambon, amphoe, province, postal} (norm แล้วทั้งหมด)
 */
function geoExtract_(text) {
  let t = String(text || '');
  t = t.replace(/\s+/g, ' ').trim();
  let out = { tambon: '', amphoe: '', province: '', postal: '' };
  if (!t) return out;

  let pc = '';
  let pcm = t.match(GEO_POSTAL_RE); if (pcm) pc = pcm[1];

  // --- จังหวัด ---
  let p = '';
  let pm = t.match(GEO_PROVINCE_RE); if (pm && pm[1]) p = pm[1].trim();
  if (!p && GEO_BKK_RE.test(t)) p = 'กรุงเทพมหานคร';
  if (!p) {
    let fb = GEO_PROV_FALLBACK_RE.exec(t);
    if (fb && fb[1] !== 'ไทย' && fb[1] !== 'ประเทศ' && fb[1] !== 'ประเทศไทย') p = fb[1].trim();
  }
  if (!p) {
    // fallback สุดท้าย: คำไทย 2+ ตัวท้ายข้อความหลังตัด "ประเทศไทย/ไทย" (จังหวัดจริงเท่านั้น)
    let t2 = t.replace(/(\s|^)(ประเทศไทย|ไทย|ประเทศ)(\s|$)/g, ' ').replace(/\s+$/, '');
    let m2 = t2.match(/([\u0E00-\u0E7F]{2,})\s*$/);
    if (m2 && m2[1] !== 'ไทย' && m2[1] !== 'ประเทศ' && m2[1] !== 'ประเทศไทย') p = m2[1].trim();
  }
  let pn = normArea_(p);

  // --- อำเภอ: regex ก่อน → scan fallback กรองตามจังหวัด (1-hit rule) ---
  let an = '';
  let am = t.match(GEO_AMPHOE_RE); if (am && am[1]) an = normArea_(am[1].trim());
  if (!an && pn) an = scanAmphoeIn_(t, pn);

  // --- ตำบล: regex ก่อน → scan fallback กรองตาม จ.+อ. (1-hit rule) ---
  let tn = '';
  let tm = t.match(GEO_TAMBON_RE); if (tm && tm[1]) tn = normArea_(tm[1].trim());
  if (!tn && pn) tn = scanTambonIn_(t, pn, an);

  out.tambon = tn; out.amphoe = an; out.province = pn; out.postal = pc;
  return out;
}

/** scanAmphoeIn_ — หาอำเภอจากชื่อที่มีจริงในพจนานุกรม (1-hit rule) */
function scanAmphoeIn_(text, pn) {
  let idx = loadGeoIdx_();
  let pool = idx.scanAmphoe[pn]; if (!pool) return '';
  let nt = normArea_(text);
  let hits = [];
  let keys = Object.keys(pool);
  for (var i = 0; i < keys.length; i++) { if (nt.indexOf(keys[i]) >= 0) hits.push(keys[i]); }
  return hits.length === 1 ? hits[0] : '';
}

/** scanTambonIn_ — หาตำบลจากชื่อที่มีจริงในพจนานุกรม (1-hit rule) กรองตามอำเภอถ้ามี */
function scanTambonIn_(text, pn, an) {
  let idx = loadGeoIdx_();
  let pool = null;
  if (an) pool = idx.scanTambonByAmphoe[pn + '|' + an];
  if (!pool) pool = idx.scanTambon[pn];
  if (!pool) return '';
  let nt = normArea_(text);
  let hits = [];
  let keys = Object.keys(pool);
  for (var i = 0; i < keys.length; i++) { if (nt.indexOf(keys[i]) >= 0) hits.push(keys[i]); }
  return hits.length === 1 ? hits[0] : '';
}

/** findRowByTambonInText_ — [v5 BUG B FIX] หาแถว SYS_TH_GEO ที่ tambon ตรงกับ text
 *  ถ้าไม่เจอเลย → return null (ไม่ fallback เป็น amphoe name - แก้ Bug A ด้วย)
 *  ลำดับความสำคัญ:
 *    1) exact match กับ extractedTambonNorm (ถ้ามี) — กัน false positive จาก amphoe name ที่ตรงกับ text
 *    2) substring search tambon ใน text (fallback)
 */
function findRowByTambonInText_(candidates, text, extractedTambonNorm) {
  if (!candidates || !candidates.length) return null;
  // Priority 1: exact match กับ extracted tambon
  if (extractedTambonNorm) {
    for (var i = 0; i < candidates.length; i++) {
      let tn = normArea_(String(candidates[i][GEO_COL.TAMBON_CLEAN] || ''));
      if (tn === extractedTambonNorm) return candidates[i];
    }
    // ถ้ามี extracted tambon แต่ไม่ตรงกับ candidates เลย → return null (ไม่ fallback)
    return null;
  }
  // Priority 2: substring search (กรณี extract ไม่ได้ tambon)
  if (!text) return null;
  let nt = normArea_(text);
  for (var j = 0; j < candidates.length; j++) {
    let tn2 = normArea_(String(candidates[j][GEO_COL.TAMBON_CLEAN] || ''));
    if (tn2 && nt.indexOf(tn2) >= 0) return candidates[j];
  }
  return null;
}

/**
 * geoMatch_ — เทียบข้อความกับ SYS_TH_GEO (5 ชั้น, หยุดทันทีที่เจอ)
 * @returns {object|null} {entry: แถว SYS_TH_GEO, layer: ชั้นที่แมชต์}
 */
function geoMatch_(geoText) {
  if (!geoText) return null;
  let idx = loadGeoIdx_();
  if (!idx) return null;
  let e = geoExtract_(geoText);
  let nt = e.tambon, na = e.amphoe, np = e.province;
  let r;

  // ชั้น 1: ต.+อ.+จ. (search_key col M) — [v5.5.0 M-1] array ใช้ pickRowByPostal_ กรอง
  if (nt && na && np) {
    let arr = idx.bySearch[nt + '|' + na + '|' + np];
    if (arr && arr.length) { r = pickRowByPostal_(arr, e.postal); if (r) return { entry: r, layer: 'EXACT3' }; }
  }
  // ชั้น 2: รหัส + ตำบล (postal_key col N) — ข้อมูลจริงใช้ '|' เป็นตัวคั่น (ไม่ใช่ช่องว่าง)
  if (e.postal && nt) {
    let arr = idx.byPostal[e.postal + '|' + nt];
    if (arr && arr.length) { r = pickRowByPostal_(arr, e.postal); if (r) return { entry: r, layer: 'POSTAL_RHSTB' }; }
  }
  // ชั้น 3: รหัส + อำเภอ (v5 BUG B FIX: search tambon ใน text ก่อนเลือกแถว)
  if (e.postal && na) {
    let candidates = idx.byPostalAmphoe[e.postal + '|' + na];
    if (candidates && candidates.length) {
      let matched = findRowByTambonInText_(candidates, geoText, nt);
      if (matched) return { entry: matched, layer: 'POSTAL_AMPHOE' };
    }
    // ไม่เจอ tambon ใน text → ไม่ return (ลงไปชั้น 4 ต่อ)
  }
  // ชั้น 4: ตำบล + จังหวัด
  if (nt && np) {
    r = idx.byTambonProv[nt + '|' + np]; if (r) return { entry: r, layer: 'TAMBON_PROV' };
  }
  // ชั้น 5: อำเภอ + จังหวัด (v5 BUG B FIX: search tambon ใน text)
  if (na && np) {
    let candidates = idx.byAmphoeProv[na + '|' + np];
    if (candidates && candidates.length) {
      let matched = findRowByTambonInText_(candidates, geoText, nt);
      if (matched) return { entry: matched, layer: 'AMPHOE_PROV' };
    }
    // ไม่เจอ → ลงไปชั้น 6 ต่อ
  }
  // ชั้น 6: fuzzy ตำบล (bigram 0.80) กรองตามจังหวัด
  if (nt && np && idx.fuzzyByProv[np]) {
    let f = fuzzyBest_(nt, idx.fuzzyByProv[np], 'tn');
    if (f) return { entry: f, layer: 'TAMBON_FUZZY' };
  }
  // ชั้น 7: fuzzy อำเภอ (bigram 0.80) กรองตามจังหวัด
  if (na && np && idx.fuzzyByProv[np]) {
    let f2 = fuzzyBest_(na, idx.fuzzyByProv[np], 'an');
    if (f2) return { entry: f2, layer: 'AMPHOE_FUZZY' };
  }
  // ชั้น 8: Levenshtein ตำบล (≤ 1 edit, สำหรับคำ 5+ ตัวอักษร) — แก้ typo 1 ตัวอักษร เช่น "สมุทธปราการ" → "สมุทรปราการ"
  if (nt && np && idx.fuzzyByProv[np]) {
    let f3 = levenshteinBest_(nt, idx.fuzzyByProv[np], 'tn', 1);
    // [v5.5.7 AUDIT FIX-2] เพิ่ม postalOk_ — ให้ Thai path ใช้นโยบายเดียวกับ EN path (v5.5.3)
    //   กัน false positive คนละพื้นที่ที่ห่าง 1 ตัวอักษร เมื่อข้อความมีรหัสไปรษณีย์ขัดแย้ง
    if (f3 && postalOk_(f3, e.postal)) return { entry: f3, layer: 'TAMBON_LEV' };
  }
  // ชั้น 9: Levenshtein อำเภอ (≤ 1 edit, สำหรับคำ 5+ ตัวอักษร)
  if (na && np && idx.fuzzyByProv[np]) {
    let f4 = levenshteinBest_(na, idx.fuzzyByProv[np], 'an', 1);
    // [v5.5.7 AUDIT FIX-2] เพิ่ม postalOk_ ครอบชั้น 9 เช่นกัน
    if (f4 && postalOk_(f4, e.postal)) return { entry: f4, layer: 'AMPHOE_LEV' };
  }
  return null;
}

/**
 * [v5.2 ENGLISH] geoMatchEn_ — เทียบข้อความภาษาอังกฤษกับ SYS_TH_GEO (parallel indexes, 5 layers + fuzzy + Levenshtein)
 * ใช้ index _EN ทั้งหมด: bySearch_EN, byPostal_EN, byTambonProv_EN, byAmphoeProv_EN, byPostalAmphoe_EN
 * @returns {object|null} {entry: แถว SYS_TH_GEO, layer: ชั้นที่แมชต์ (ต่อท้าย _EN)}
 */
function geoMatchEn_(geoText) {
  if (!geoText) return null;
  let idx = loadGeoIdx_();
  if (!idx) return null;
  let e = geoExtractEn_(geoText);
  let nt = e.tambon, na = e.amphoe, np = e.province;
  let r;

  // ชั้น 1: ต.+อ.+จ. (search_key_EN col AC) — [v5.5.0 M-1] array + pickRowByPostal_
  if (nt && na && np) {
    let arr = idx.bySearch_EN[nt + '|' + na + '|' + np];
    if (arr && arr.length) { r = pickRowByPostal_(arr, e.postal); if (r) return { entry: r, layer: 'EXACT3_EN' }; }
  }
  // ชั้น 2: รหัส + ตำบล (postal_key_EN col AD) — ข้อมูลจริงใช้ '|' เป็นตัวคั่น (ไม่ใช่ช่องว่าง)
  if (e.postal && nt) {
    let arr = idx.byPostal_EN[e.postal + '|' + nt];
    if (arr && arr.length) { r = pickRowByPostal_(arr, e.postal); if (r) return { entry: r, layer: 'POSTAL_RHSTB_EN' }; }
  }
  // ชั้น 3: รหัส + อำเภอ
  if (e.postal && na) {
    let candidates = idx.byPostalAmphoe_EN[e.postal + '|' + na];
    if (candidates && candidates.length) {
      let matched = findRowByTambonInTextEn_(candidates, geoText, nt);
      if (matched) return { entry: matched, layer: 'POSTAL_AMPHOE_EN' };
    }
  }
  // ชั้น 4: ตำบล + จังหวัด
  if (nt && np) {
    r = idx.byTambonProv_EN[nt + '|' + np]; if (r) return { entry: r, layer: 'TAMBON_PROV_EN' };
  }
  // ชั้น 5: อำเภอ + จังหวัด
  if (na && np) {
    let candidates = idx.byAmphoeProv_EN[na + '|' + np];
    if (candidates && candidates.length) {
      let matched = findRowByTambonInTextEn_(candidates, geoText, nt);
      if (matched) return { entry: matched, layer: 'AMPHOE_PROV_EN' };
    }
  }
  // [v5.3 PERF] Fuzzy สำหรับ English — ใช้ fuzzyByProv_EN (English index) แทน Thai
  // bug #3 fix: เดิมใช้ idx.fuzzyByProv (Thai) → แทบไม่เคย match
  let fuzzyIdx = idx.fuzzyByProv_EN || {};
  if (nt && np && fuzzyIdx[np]) {
    let f = fuzzyBest_(nt, fuzzyIdx[np], 'tn');
    if (f) return { entry: f, layer: 'TAMBON_FUZZY_EN' };
  }
  // [v5.5.3 REORDER] TAMBON_LEV_EN มาก่อน AMPHOE_FUZZY_EN — ชื่อตำบลที่สะกดต่าง 1 ตัวอักษร
  //   ควรชนะก่อนให้ amphoe-fuzzy เติมตำบลแบบ arbitrary (ตำบลแรกของอำเภอ)
  if (nt && np && fuzzyIdx[np]) {
    let f3 = levenshteinBest_(nt, fuzzyIdx[np], 'tn', 1);
    // [v5.5.3] postalOk_ — กัน false positive คนละเขต เช่น "bangna"→"bangwa" (dist 1 แต่คนละเขต)
    if (f3 && postalOk_(f3, e.postal)) return { entry: f3, layer: 'TAMBON_LEV_EN' };
  }
  if (na && np && fuzzyIdx[np]) {
    let f2 = fuzzyBest_(na, fuzzyIdx[np], 'an');
    if (f2) return { entry: f2, layer: 'AMPHOE_FUZZY_EN' };
  }
  if (na && np && fuzzyIdx[np]) {
    let f4 = levenshteinBest_(na, fuzzyIdx[np], 'an', 1);
    if (f4) return { entry: f4, layer: 'AMPHOE_LEV_EN' };
  }
  return null;
}

/** [v5.2 ENGLISH] findRowByTambonInTextEn_ — หาแถว EN ที่ tambon_en ตรงกับ text (substring case-insensitive) */
function findRowByTambonInTextEn_(candidates, text, extractedTambonNorm) {
  if (!candidates || !candidates.length) return null;
  if (extractedTambonNorm) {
    for (var i = 0; i < candidates.length; i++) {
      let tn = normAreaEn_(String(candidates[i][GEO_COL.SUBDISTRICT_CLEAN_EN] || ''));
      if (tn === extractedTambonNorm) return candidates[i];
    }
    return null;
  }
  if (!text) return null;
  let nt = text.toLowerCase().replace(/\s+/g, '');
  for (var j = 0; j < candidates.length; j++) {
    let tn2 = normAreaEn_(String(candidates[j][GEO_COL.SUBDISTRICT_CLEAN_EN] || ''));
    if (tn2 && nt.indexOf(tn2) >= 0) return candidates[j];
  }
  return null;
}

/**
 * [v5.2 ENGLISH] geoExtractEn_ — ดึง ต./อ./จ./รหัส จากข้อความภาษาอังกฤษ
 *   - Tambon/Khwaeng: "Khwaeng X" / "Tambon X"
 *   - District/Khet/Amphoe: "Khet X" / "Amphoe X" / "District X"
 *   - Province: "Province X" / หรือคำที่อยู่หน้ารหัส 5 หลัก
 *   - Postal: regex \b(\d{5})\b
 *   - ถ้าไม่เจอ label → ใช้ scanning ผ่าน Thai index (TAMBON_NORM_EN, AMPHOE_NORM_EN, PROVINCE_NORM_EN)
 */
function geoExtractEn_(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  let out = { tambon: '', amphoe: '', province: '', postal: '' };
  if (!t) return out;

  // Postal code
  let pcm = t.match(/\b(\d{5})\b/);
  if (pcm) out.postal = pcm[1];

  // Tambon: "Khwaeng X" หรือ "Tambon X"
  let tm = t.match(/\b(?:Khwaeng|Tambon)\s+([A-Za-z][A-Za-z\s]+?)(?=,|\s+(?:Khet|Amphoe|District|Province)|\s+\d{5}|$)/i);
  if (tm) out.tambon = normAreaEn_(tm[1]);

  // Amphoe: "Khet X" / "Amphoe X" / "District X"
  let am = t.match(/\b(?:Khet|Amphoe|District)\s+([A-Za-z][A-Za-z\s]+?)(?=,|\s+(?:Province)|\s+\d{5}|$)/i);
  if (am) out.amphoe = normAreaEn_(am[1]);

  // Province: "Province X" หรือ Bangkok (default)
  let pm = t.match(/\bProvince\s+([A-Za-z][A-Za-z\s]+?)(?=,|\s+\d{5}|$)/i);
  if (pm) out.province = normAreaEn_(pm[1]);
  if (!out.province && /\bBangkok\b/i.test(t)) out.province = 'bangkok';
  // Fallback: คำที่อยู่หน้ารหัส 5 หลัก
  if (!out.province && out.postal) {
    let fb = t.match(/([A-Za-z][A-Za-z\s]+?)\s+\d{5}/);
    if (fb && fb[1]) {
      let provGuess = normAreaEn_(fb[1]);
      if (provGuess && provGuess !== 'thailand' && provGuess !== 'th') {
        out.province = provGuess;
      }
    }
  }

  // [v5.5.3 FIX "Chang Wat"] ตัดคำนำหน้า "changwat" ออกจาก province (หลัง normalize แล้ว)
  //   "changwatsamutprakan" → "samutprakan" / "krungthepmahanakhon" ไม่กระทบ
  //   ปลอดภัย: ไม่มีชื่อจังหวัดใน dict ที่ขึ้นต้นด้วย "changwat" (และก็ไม่มีตำบล/อำเภอที่ใช้ path นี้)
  //   ผล: ชั้น EXACT3_EN / TAMBON_PROV_EN / AMPHOE_PROV_EN / FUZZY_EN / LEV_EN กลับมาใช้ได้ทุกจังหวัด
  if (out.province) {
    out.province = out.province.replace(/^chang\s*wat/, '');
  }

  // Scanning fallback: ถ้า label ไม่ครบ → scan ผ่าน English province list (v5.2)
  let idx = loadGeoIdx_();
  if (idx) {
    if (!out.province) {
      // Scan English province list (provinceList_EN จาก loadGeoIdx_) — เทียบทั้งคู่ lowercase
      let provsEn = idx.provinceList_EN || [];
      let tLower = t.toLowerCase();
      for (var i = 0; i < provsEn.length; i++) {
        let p = String(provsEn[i] || '').toLowerCase();
        if (p && tLower.indexOf(p) >= 0) { out.province = p; break; }
      }
    }
    if (out.province) {
      // [v5.3 PERF] ใช้ byProvince_EN (O(1)) แทน full scan 7,500+ keys — bug #4 fix
      let poolEn = idx.byProvince_EN[out.province] || [];
      let tLowerNoSpace = t.toLowerCase().replace(/\s+/g, '');
      // [v5.3 PERF + FIX-A] 1-hit rule ฝั่ง EN — นับชื่อที่ "ต่างกัน" (dedup) ไม่ใช่จำนวนครั้งที่ push
      // เดิม push ซ้ำชื่อเดียวกันแล้ว amphoeHits.length > 1 ทำให้ 1-hit แทบไม่เคยทำงาน
      if (!out.amphoe) {
        let amphoeSeen = {};
        let amphoeHit = '', amphoeCount = 0;
        for (var j = 0; j < poolEn.length; j++) {
          let an = normAreaEn_(String(poolEn[j][GEO_COL.AMPHOE_NORM_EN] || ''));
          if (an && !amphoeSeen[an] && tLowerNoSpace.indexOf(an) >= 0) {
            amphoeSeen[an] = true;
            amphoeHit = an;
            amphoeCount++;
          }
        }
        // 1-hit rule: ชื่อที่ไม่ซ้ำกันเจอแค่ 1 ตัว → ใช้
        if (amphoeCount === 1) out.amphoe = amphoeHit;
      }
      if (!out.tambon) {
        let tambonSeen = {};
        let tambonHit = '', tambonCount = 0;
        for (var k = 0; k < poolEn.length; k++) {
          let tn = normAreaEn_(String(poolEn[k][GEO_COL.TAMBON_NORM_EN] || ''));
          if (tn && !tambonSeen[tn] && tLowerNoSpace.indexOf(tn) >= 0) {
            tambonSeen[tn] = true;
            tambonHit = tn;
            tambonCount++;
          }
        }
        if (tambonCount === 1) out.tambon = tambonHit;
      }
    }
  }

  return out;
}

/** fuzzyBest_ — bigram similarity >= 0.80 หาคู่คะแนนสูงสุดในหนึ่งจังหวัด */
function fuzzyBest_(needle, pool, field) {
  let best = null, bs = 0.0;
  let bNeedle = bigrams_(needle);
  if (!bNeedle.length) return null;
  for (var i = 0; i < pool.length; i++) {
    let c = pool[i][field];
    if (!c) continue;
    let s = bigramScore_(bNeedle, bigrams_(c));
    if (s > bs) { bs = s; best = pool[i].row; }
  }
  return (best && bs >= 0.80) ? best : null;
}

/** [v5.5.3] postalOk_ — ยอมรับผล Levenshtein เฉพาะเมื่อรหัสไปรษณีย์ของแถว dict ตรงกับ
 *  รหัสในที่อยู่ (หรือที่อยู่ไม่มีรหัส) — กัน false positive คนละเขตที่ห่างกัน 1 ตัวอักษร
 *  เช่น "Bang Na" (10260, ชื่อเดิมที่ Google ยังใช้) ไปชน "Bang Wa" (10160, คนละเขต)
 */
function postalOk_(row, postal) {
  if (!postal) return true;
  return String(row[GEO_COL.POSTAL] || '').trim() === String(postal).trim();
}

function bigrams_(s) {
  let out = [];
  for (var i = 0; i < s.length - 1; i++) out.push(s.substring(i, i + 2));
  return out;
}

function bigramScore_(a, b) {
  if (!a.length || !b.length) return 0.0;
  let map = {};
  for (var i = 0; i < a.length; i++) map[a[i]] = (map[a[i]] || 0) + 1;
  let inter = 0, union = 0;
  let cnt = {};
  for (var i = 0; i < b.length; i++) cnt[b[i]] = (cnt[b[i]] || 0) + 1;
  let keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    let cb = cnt[keys[i]] || 0;
    inter += Math.min(map[keys[i]], cb);
  }
  union = a.length + b.length - inter;
  return union ? inter / union : 0.0;
}

/** levenshtein_ — ระยะ Levenshtein (จำนวน insert/delete/substitute ขั้นต่ำระหว่าง 2 สาย) */
function levenshtein_(a, b) {
  if (a === b) return 0;
  let al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  let v0 = new Array(bl + 1);
  let v1 = new Array(bl + 1);
  for (var j = 0; j <= bl; j++) v0[j] = j;
  for (var i = 0; i < al; i++) {
    v1[0] = i + 1;
    for (var j = 0; j < bl; j++) {
      let cost = a.charAt(i) === b.charAt(j) ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (var k = 0; k <= bl; k++) v0[k] = v1[k];
  }
  return v1[bl];
}

/** levenshteinBest_ — หาแถวที่ Levenshtein ≤ maxDist (ข้ามคำสั้น < 5 ตัว กัน false positive) */
function levenshteinBest_(needle, pool, field, maxDist) {
  if (!needle || needle.length < 5) return null;
  let best = null, bestDist = maxDist + 1;
  for (var i = 0; i < pool.length; i++) {
    let c = pool[i][field];
    if (!c) continue;
    let d = levenshtein_(needle, c);
    if (d < bestDist) { bestDist = d; best = pool[i].row; }
  }
  return bestDist <= maxDist ? best : null;
}

/**
 * geoParse_ — สร้างค่า 7 คอลัมน์จากชื่อที่อยู่ + ระยะทาง
 * @param {string} geoText ชื่อที่อยู่จาก_LatLong (ข้อความเดิม)
 * @param {*} dist ระยะทางจากคลัง_Km
 * @returns {object} 7 ค่า (ราชการ 4 ตัว + Reversegeocode + Calculatedistances + GEO_LAYER)
 *
 * กฎ: แมชต์พจนานุกรม → ค่ามาตรฐานจาก SYS_TH_GEO / ไม่แมชต์ → เว้นว่าง (4 ตัวราชการ)
 *      Reversegeocode = คัดลอกดิบ / Calculatedistances = คัดลอกระยะทางดิบ
 */
function geoParse_(geoText, dist) {
  let out = {
    rahatpraisanee: '',
    changwat: '',
    amphoe_khet: '',
    tambon_kwaeng: '',
    reversegeocode: geoText ? String(geoText).trim() : '',
    calculatedistances: (dist !== undefined && dist !== null && dist !== '') ? dist : '',
    geoLayer: ''
  };
  let m = geoMatch_(geoText);
  if (m) {
    let row = m.entry;
    // [v5.3] bug #7 fix: ตรวจ note_type ก่อน — ถ้าเป็น CHECK_NOTE ห้ามเติมอัตโนมัติ
    let noteType = String(row[GEO_COL.NOTE_TYPE] || '').trim().toUpperCase();
    if (noteType === 'CHECK_NOTE') {
      // [v5.5.4 PATCH-4] CHECK_NOTE + รหัสยืนยัน — ถ้าข้อความระบุรหัสไปรษณีย์มาเอง
      // และรหัสนั้นตรงกับแถว dict ที่แมชต์ (กรณีนี้มาจากชั้นที่ผ่าน pickRowByPostal_
      // เช่น EXACT3/POSTAL_RHSTB อยู่แล้ว) → sub-area ถูกระบุชัดเจน เติมได้ปลอดภัย
      // ตัวอย่าง: "แขวงท่าแร้ง เขตบางเขน กรุงเทพฯ 10220" + ท่าแร้งมีรหัส 10200/10220
      //   → รหัส 10220 ในข้อความยืนยันว่าเป็นแถว 10220 → เติม ไม่ต้องเว้นว่าง
      let peCn = geoExtract_(geoText);
      if (peCn && peCn.postal &&
          String(row[GEO_COL.POSTAL] || '').trim() === String(peCn.postal).trim()) {
        out.rahatpraisanee = String(row[GEO_COL.POSTAL] || '');
        out.changwat = String(row[GEO_COL.PROVINCE_CLEAN] || '');
        out.amphoe_khet = String(row[GEO_COL.AMPHOE_CLEAN] || row[GEO_COL.AMPHOE_RAW] || '');
        out.tambon_kwaeng = String(row[GEO_COL.TAMBON_CLEAN] || '');
        out.geoLayer = 'CN_ZIP_OK';
        return out;
      }
      out.geoLayer = 'CHECK_NOTE';
      // เว้น 4 คอลัมน์ราชการว่างไว้ ให้คนตรวจ
      return out;
    }
    out.rahatpraisanee = String(row[GEO_COL.POSTAL] || '');
    out.changwat = String(row[GEO_COL.PROVINCE_CLEAN] || '');
    // fallback ไป column C (amphoe_raw) ถ้า column G (amphoe_clean) ว่าง
    out.amphoe_khet = String(row[GEO_COL.AMPHOE_CLEAN] || row[GEO_COL.AMPHOE_RAW] || '');
    out.tambon_kwaeng = String(row[GEO_COL.TAMBON_CLEAN] || '');
    out.geoLayer = m.layer;
  }
  // ไม่แมชต์ → 4 คอลัมน์ราชการ = เว้นว่าง (ไม่ใส่ค่าผิดลงฐาน)
  return out;
}

/**
 * runMasterGeo — รันเพิ่ม/อัปเดต 7 คอลัมน์ U–AA ใน MASTER_PLACE
 *   batch 500 แถว/ครั้ง (กัน Timeout) — รันต่อได้หลายรอบจนครบทั้งใบ
 * @returns {object} {processed, filled}
 */
function getGeoSourceIndex_() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  // [v5.4.3 BUG-008 FIX] ใช้ SHEETS.SOURCE แทน hard-coded
  let sh = ss.getSheetByName(SHEETS.SOURCE);
  if (!sh) throw new Error('ไม่พบชีตต้นทาง: ' + SHEETS.SOURCE);
  let lastRow = sh.getLastRow();
  let lastCol = sh.getLastColumn();
  if (lastRow < 2) return { rowsByMdId: {}, sh: sh };

  let values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  let headers = values[0].map(function (v) { return String(v || '').trim(); });
  let cols = {};
  headers.forEach(function (h, i) { if (h) cols[h] = i; });
  ['MD_LINK', 'ชื่อที่อยู่จาก_LatLong', 'ระยะทางจากคลัง_Km'].forEach(function (h) {
    if (cols[h] === undefined) throw new Error('ชีต SCGนครหลวงJWDภูมิภาค ไม่มีหัวคอลัมน์: ' + h);
  });

  let rowsByMdId = {};
  // [v5.5.6 PATCH-6] cleanEnByMdId = "EN สะอาดล่าสุด" ของแต่ละสถานที่ (mdId)
  //   ใช้อัปเกรด Y ที่เป็นขยะ (ไทย/Plus Code/GeoErr/ว่าง) ตามนโยบาย Upgrade-only
  let cleanEnByMdId = {};
  // [v5.3 FIX] bug #5: MD_LINK เดียวกันเลือก "latest + non-empty priority"
  // ก่อนหน้านี้: ใช้แถวแรกเสมอ → ถ้าแถวแรกว่างหรือมีระยะทางผิด → ผลผิด
  // ตอนนี้: priority = (1) non-empty text, (2) non-empty distance, (3) แถวล่าสุด
  for (var i = 1; i < values.length; i++) {
    let mdId = String(values[i][cols['MD_LINK']] || '').trim();
    if (!mdId) continue;
    let geoText = values[i][cols['ชื่อที่อยู่จาก_LatLong']];
    let distance = values[i][cols['ระยะทางจากคลัง_Km']];
    // [v5.5.6 PATCH-6] จับแถว EN สะอาดล่าสุดของสถานที่นี้ไว้ (แถวที่สะอาดและใหม่กว่าจะ overwrite)
    if (geoIsCleanEnText_(geoText)) {
      cleanEnByMdId[mdId] = { geoText: String(geoText).trim(), distance: distance };
    }
    let newRow = { geoText: geoText, distance: distance };

    if (!rowsByMdId[mdId]) {
      // ยังไม่มี → ใส่เลย
      rowsByMdId[mdId] = newRow;
    } else {
      // มีแล้ว → เปรียบเทียบ priority
      let cur = rowsByMdId[mdId];
      let curHasText = cur.geoText && String(cur.geoText).trim() !== '';
      let newHasText = newRow.geoText && String(newRow.geoText).trim() !== '';
      let curHasDist = cur.distance && String(cur.distance).trim() !== '';
      let newHasDist = newRow.distance && String(newRow.distance).trim() !== '';
      // กฎ: ถ้าของใหม่มี text แต่ของเก่าไม่มี → แทน
      //     ถ้าของใหม่มี distance แต่ของเก่าไม่มี → แทน
      //     ถ้าทั้งคู่มีเหมือนกัน → แถวล่าสุดชนะ (overwrite)
      if ((newHasText && !curHasText) || (newHasDist && !curHasDist)) {
        rowsByMdId[mdId] = newRow;
      } else if (newHasText || newHasDist) {
        // overwrite ด้วยแถวล่าสุดที่มีข้อมูล
        rowsByMdId[mdId] = newRow;
      }
    }
  }
  return { rowsByMdId: rowsByMdId, cleanEnByMdId: cleanEnByMdId, sh: sh };   // [v5.5.6 PATCH-6] เพิ่ม cleanEnByMdId
}

function runMasterGeo(maxMs) {
  // [v5.4.1 P1-3 FIX] LockService — กัน race condition เขียน U-AA ซ้ำ
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('runMasterGeo: มีคนกดปุ่ม 3 ค้างอยู่ — รอ 20s แล้วยังไม่ว่าง');
  }
  try {
  // v5.1 NEW-001: รับ maxMs จาก caller (เช่น uiRunMasterAndGeo ใช้ shared budget) — ถ้าไม่ส่งมาใช้ GEO_MAX_MS ปกติ
  let timeBudgetMs = (typeof maxMs === 'number' && maxMs > 0) ? maxMs : GEO_MAX_MS;
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let msh = ss.getSheetByName(SHEETS.MASTER);
  if (!msh) throw new Error('ไม่พบชีต: ' + SHEETS.MASTER);
  let last = msh.getLastRow();
  if (last < 2) return { processed: 0, filled: 0, sourceFound: 0, skipped: 0 };

  let headers = msh.getRange(1, 1, 1, msh.getLastColumn()).getValues()[0].map(function (v) { return String(v || '').trim(); });
  let mcols = {};
  headers.forEach(function (h, i) { if (h) mcols[h] = i; });
  ['MD_ID', 'PROVINCE', 'AMPHOE', 'CONFIRMED_BY', 'REVIEW_NOTE',
   'Rahatpraisanee', 'Changwat', 'Amphoe_Khet', 'Tambon_Kwaeng',
   'Reversegeocode', 'Calculatedistances', 'GEO_LAYER'].forEach(function (h) {
    if (mcols[h] === undefined) throw new Error('ชีต MASTER_PLACE ไม่มีหัวคอลัมน์: ' + h);
  });

  // ข้อมูลสำหรับ GeoService ต้องมาจากชีตต้นทางเท่านั้น ไม่ใช้ชื่อปลายทาง/ที่อยู่ปลายทาง
  let sourceIndex = getGeoSourceIndex_();   // [v5.5.6 PATCH-6]
  let source = sourceIndex.rowsByMdId;
  let cleanEnMap = sourceIndex.cleanEnByMdId;   // mdId → EN สะอาดล่าสุด (ใช้อัปเกรด Y)
  let n = last - 1;
  let data = msh.getRange(2, 1, n, msh.getLastColumn()).getValues();
  let BATCH = 500;
  let filled = 0;
  let sourceFound = 0;
  let skipped = 0;
  let yFrozen = 0;    // [v5.5.6 PATCH-6] Y เป็น EN สะอาด → แช่แข็ง ไม่ถูกทับ
  let yUpgraded = 0;  // [v5.5.6 PATCH-6] Y เป็นขยะ → อัปเกรดเป็น EN สะอาดจาก SOURCE
  let completedRows = 0;
  let startedAt = Date.now();
  let stoppedByGuard = false;

  for (var start = 0; start < n; start += BATCH) {
    if (Date.now() - startedAt > timeBudgetMs) {
      stoppedByGuard = true;
      logRun_('runMasterGeo', 'TIME_GUARD หยุดก่อนชุดข้อมูลที่ ' + (start + 2) + '/' + (last) + ' (budget ' + Math.round(timeBudgetMs / 1000) + 's)');
      break;
    }
    let end = Math.min(start + BATCH, n);
    let batchRowCount = end - start;
    let geoFills = [];
    for (var i = start; i < end; i++) {
      if (Date.now() - startedAt > timeBudgetMs) {
        stoppedByGuard = true;
        break;
      }
      let r = data[i];
      let mdId = String(r[mcols['MD_ID']] || '').trim();
      let src = source[mdId] || { geoText: '', distance: '' };
      if (source[mdId]) sourceFound++;

      let existingLayer = String(r[mcols['GEO_LAYER']] || '').trim();
      let geoRow;
      if (existingLayer) {
        // [v5.5.6 PATCH-6] แถวที่เติมแล้ว: แช่แข็ง U/V/W/X/AA + Y/Z ตามนโยบาย Upgrade-only
        //   (แทนพฤติกรรมเดิม: คัดลอกที่อยู่/ระยะทาง "ล่าสุด" จาก SOURCE ทับ Y/Z ทุกครั้งที่รัน)
        skipped++;
        geoRow = buildSkippedGeoRow_(r, mcols, src, !!source[mdId], cleanEnMap[mdId] || null);
        if (geoIsCleanEnText_(r[mcols['Reversegeocode']])) {
          yFrozen++;
        } else if (geoIsCleanEnText_(geoRow[4])) {
          yUpgraded++;
        }
      } else {
        // ใช้สองคอลัมน์จากชีต SCG ต้นทางตรง ๆ เท่านั้น
        let g = geoParse_(src.geoText, src.distance);
        if (g.geoLayer) filled++;
        // [v5.5.6 PATCH-6] กันดาวน์เกรด Y สะอาดในช่องทางเติมใหม่ (ดู buildGeoFillRow_)
        geoRow = buildGeoFillRow_(g, r, mcols);
      }
      // v5: ไม่เขียน CONFIRMED_BY (P), REVIEW_NOTE (Q) — ปุ่ม 1 (runMaster) เขียนเองจาก [ที่อยู่ปลายทาง]
      //   เพื่อให้ P/Q สะท้อน source ที่ตรวจสอบ N/O (PROVINCE/AMPHOE)
      geoFills.push(geoRow);
      completedRows++;
    }
    // [v5.4.3 FIX] ห้ามเขียน partial batch เมื่อ TIME_GUARD กลางชุด — กัน misalignment
    if (stoppedByGuard && geoFills.length !== batchRowCount) {
      logRun_('runMasterGeo', 'TIME_GUARD กลาง batch → ข้ามเขียน partial (filled so far ' + filled + ')');
      break;
    }
    if (!geoFills.length) break;
    // v5: เขียนเฉพาะ 7 คอลัมน์ U-AA (Rahatpraisanee..GEO_LAYER) เท่านั้น — ไม่แตะ P/Q
    msh.getRange(start + 2, mcols['Rahatpraisanee'] + 1, geoFills.length, 7).setValues(geoFills);
    SpreadsheetApp.flush();
    console.log('runMasterGeo: ' + (start + 1) + '-' + (start + geoFills.length) + '/' + n + ' filled=' + filled);
    if (stoppedByGuard) break;
  }

  let processed = completedRows;
  let log = 'runMasterGeo v5: processed=' + processed + ' filled=' + filled + ' sourceFound=' + sourceFound + ' skipped=' + skipped +
    ' yFrozen=' + yFrozen + ' yUpgraded=' + yUpgraded;   // [v5.5.6 PATCH-6]
  if (stoppedByGuard) log += ' TIME_GUARD=true';
  console.log(log);
  logRun_('runMasterGeo', log);
  return { processed: processed, filled: filled, sourceFound: sourceFound, skipped: skipped,
           yFrozen: yFrozen, yUpgraded: yUpgraded, timeGuard: stoppedByGuard };   // [v5.5.6 PATCH-6]
  } finally {
    lock.releaseLock();  // [v5.4.1 P1-3] release lock
  }
}

/**
 * [v5.2 ENGLISH] runMasterGeoEn — เหมือน runMasterGeo แต่ใช้ English text เป็น input
 * ใช้เมื่อ [ชื่อที่อยู่จาก_LatLong] (column V) เป็นภาษาอังกฤษ เช่น "Khwaeng Chakkrawat, Khet Samphanthawong, Bangkok 10100"
 * Logic: ใช้ geoMatchEn_() แทน geoMatch_() และ geoParseEn_() แทน geoParse_()
 * ผลลัพธ์: เขียนเฉพาะ 7 คอลัมน์ U-AA (Rahatpraisanee..GEO_LAYER) เหมือน runMasterGeo ปกติ
 *   - Rahatpraisanee, Changwat, Amphoe_Khet, Tambon_Kwaeng = ค่าจาก SYS_TH_GEO (col 0,3,6,5) ไม่ใช่ English
 *   - Reversegeocode, Calculatedistances = จาก source เดิม
 *   - GEO_LAYER = "EXACT3_EN", "POSTAL_AMPHOE_EN", etc. (ลงท้ายด้วย _EN)
 * [v5.1 NEW-001] รับ maxMs parameter (ใช้ใน uiRunMasterAndGeoEn)
 */
function runMasterGeoEn(maxMs) {
  // [v5.4.1 P1-3 FIX] LockService — กัน race condition เขียน U-AA ซ้ำ
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('runMasterGeoEn: มีคนกดปุ่ม 3b ค้างอยู่ — รอ 20s แล้วยังไม่ว่าง');
  }
  try {
  let timeBudgetMs = (typeof maxMs === 'number' && maxMs > 0)
    ? maxMs
    : GEO_MAX_MS;

  let ss = SpreadsheetApp.getActiveSpreadsheet();
  // [v5.4.3 BUG-008 FIX] ใช้ SHEETS.MASTER แทน hard-coded
  let msh = ss.getSheetByName(SHEETS.MASTER);
  if (!msh) throw new Error('ไม่พบชีต: ' + SHEETS.MASTER);

  let last = msh.getLastRow();
  if (last < 2) {
    return {
      processed: 0,
      filled: 0,
      sourceFound: 0,
      skipped: 0,
      checkNoteSkipped: 0,
      yFrozen: 0,      // [v5.5.6 PATCH-6]
      yUpgraded: 0,    // [v5.5.6 PATCH-6]
      alignmentChecks: 0
    };
  }

  let headers = msh
    .getRange(1, 1, 1, msh.getLastColumn())
    .getValues()[0]
    .map(function (v) { return String(v || '').trim(); });

  let mcols = {};
  headers.forEach(function (h, i) {
    if (h) mcols[h] = i;
  });

  [
    'MD_ID',
    'PROVINCE',
    'AMPHOE',
    'CONFIRMED_BY',
    'REVIEW_NOTE',
    'Rahatpraisanee',
    'Changwat',
    'Amphoe_Khet',
    'Tambon_Kwaeng',
    'Reversegeocode',
    'Calculatedistances',
    'GEO_LAYER'
  ].forEach(function (h) {
    if (mcols[h] === undefined) {
      throw new Error('ชีต MASTER_PLACE ไม่มีหัวคอลัมน์: ' + h);
    }
  });

  let sourceIndex = getGeoSourceIndex_();   // [v5.5.6 PATCH-6]
  let source = sourceIndex.rowsByMdId;
  let cleanEnMap = sourceIndex.cleanEnByMdId;   // mdId → EN สะอาดล่าสุด (ใช้อัปเกรด Y)
  let n = last - 1;
  let allData = msh.getRange(2, 1, n, msh.getLastColumn()).getValues();

  let BATCH = 500;
  let filled = 0;
  let sourceFound = 0;
  let skipped = 0;
  let checkNoteSkipped = 0;
  let yFrozen = 0;    // [v5.5.6 PATCH-6] Y เป็น EN สะอาด → แช่แข็ง ไม่ถูกทับ
  let yUpgraded = 0;  // [v5.5.6 PATCH-6] Y เป็นขยะ → อัปเกรดเป็น EN สะอาดจาก SOURCE
  let completedRows = 0;
  let alignmentChecks = 0;
  let startedAt = Date.now();
  let stoppedByGuard = false;

  for (var start = 0; start < n; start += BATCH) {
    if (Date.now() - startedAt > timeBudgetMs) {
      stoppedByGuard = true;
      logRun_(
        'runMasterGeoEn',
        'TIME_GUARD หยุดก่อนชุดข้อมูลที่ ' + (start + 2) + '/' + last
      );
      break;
    }

    let end = Math.min(start + BATCH, n);
    let batchRowCount = end - start;
    let batchData = allData.slice(start, end);

    // Snapshot MD_ID ก่อนเขียน ใช้ตรวจว่า row identity ไม่เปลี่ยน
    let mdIdsBefore = snapshotMdIds_(batchData, mcols['MD_ID']);

    // สำคัญ: geoFills ต้องมีจำนวนเท่ากับ batchRowCount เสมอ
    let geoFills = [];

    for (var offset = 0; offset < batchData.length; offset++) {
      if (Date.now() - startedAt > timeBudgetMs) {
        stoppedByGuard = true;
        break;
      }

      let r = batchData[offset];
      let mdId = normalizeMdId_(r[mcols['MD_ID']]);
      let src = source[mdId] || { geoText: '', distance: '' };
      if (source[mdId]) sourceFound++;

      let existingLayer = String(r[mcols['GEO_LAYER']] || '').trim();
      let checkNote = isCheckNoteRow_(r, mcols);

      if (checkNote) {
        // CHECK_NOTE ห้ามเติมหรือเปลี่ยนข้อมูลอัตโนมัติ
        geoFills.push(buildExistingGeoRow_(r, mcols));
        checkNoteSkipped++;
        skipped++;
        completedRows++;
        continue;
      }

      if (shouldSkipEnglishGeo_(existingLayer)) {
        // Padding: เก็บ 1 output row ไว้ตรงตำแหน่งเดิม
        // [v5.5.6 PATCH-6] คงค่าพื้นที่เดิม (U/V/W/X/AA) + Y/Z ตามนโยบาย Upgrade-only:
        //   ไม่ใช่คัดลอก source text/distance ล่าสุดมาทับทุกครั้งอีกต่อไป
        let skipRow = buildSkippedGeoRow_(r, mcols, src, !!source[mdId], cleanEnMap[mdId] || null);
        if (geoIsCleanEnText_(r[mcols['Reversegeocode']])) {
          yFrozen++;
        } else if (geoIsCleanEnText_(skipRow[4])) {
          yUpgraded++;
        }
        geoFills.push(skipRow);
        skipped++;
        completedRows++;
        continue;
      }

      let g;
      if (!src.geoText) {
        g = emptyGeoResult_();
      } else {
        g = geoParseEn_(src.geoText, src.distance);
        if (g.geoLayer) filled++;
      }

      geoFills.push(buildGeoFillRow_(g, r, mcols));   // [v5.5.6 PATCH-6] กันดาวน์เกรด Y สะอาด
      completedRows++;
    }

    // หาก time guard หยุดกลาง batch ห้ามเขียน partial block เพราะจะทำให้ alignment ไม่สมบูรณ์
    if (stoppedByGuard && geoFills.length !== batchRowCount) {
      logRun_(
        'runMasterGeoEn',
        'TIME_GUARD ยกเลิก batch เพื่อป้องกัน partial row write: ' +
        'start=' + start + ', expected=' + batchRowCount + ', actual=' + geoFills.length
      );
      break;
    }

    // Alignment invariant ก่อนเขียน
    assertRowAlignment_(batchRowCount, geoFills.length, start);

    let writeStartRow = start + 2;
    let writeStartCol = mcols['Rahatpraisanee'] + 1;

    msh
      .getRange(writeStartRow, writeStartCol, batchRowCount, 7)
      .setValues(geoFills);
    SpreadsheetApp.flush();

    // ตรวจ MD_ID หลังเขียนจากชีตจริง
    verifyMdIdsAfterWrite_(
      msh,
      writeStartRow,
      batchRowCount,
      mcols['MD_ID'] + 1,
      mdIdsBefore,
      'runMasterGeoEn batch start=' + start
    );
    alignmentChecks++;

    console.log(
      'runMasterGeoEn: rows=' + writeStartRow + '-' +
      (writeStartRow + batchRowCount - 1) +
      '/' + last +
      ' filled=' + filled +
      ' skipped=' + skipped +
      ' CHECK_NOTE=' + checkNoteSkipped
    );

    if (stoppedByGuard) break;
  }

  let log =
    'runMasterGeoEn v5.2 padding: ' +
    'processed=' + completedRows +
    ' filled=' + filled +
    ' sourceFound=' + sourceFound +
    ' skipped=' + skipped +
    ' checkNoteSkipped=' + checkNoteSkipped +
    ' yFrozen=' + yFrozen +          // [v5.5.6 PATCH-6]
    ' yUpgraded=' + yUpgraded +      // [v5.5.6 PATCH-6]
    ' alignmentChecks=' + alignmentChecks;

  if (stoppedByGuard) log += ' TIME_GUARD=true';

  console.log(log);
  logRun_('runMasterGeoEn', log);

  return {
    processed: completedRows,
    filled: filled,
    sourceFound: sourceFound,
    skipped: skipped,
    checkNoteSkipped: checkNoteSkipped,
    yFrozen: yFrozen,        // [v5.5.6 PATCH-6]
    yUpgraded: yUpgraded,    // [v5.5.6 PATCH-6]
    alignmentChecks: alignmentChecks,
    timeGuard: stoppedByGuard
  };
  } finally {
    lock.releaseLock();  // [v5.4.1 P1-3] release lock
  }
}

/** คืนค่าข้อมูล Geo เดิมทั้ง 7 ช่อง โดยไม่เปลี่ยนค่าใด ๆ */

function buildExistingGeoRow_(r, mcols) {
  return [
    r[mcols['Rahatpraisanee']],
    r[mcols['Changwat']],
    r[mcols['Amphoe_Khet']],
    r[mcols['Tambon_Kwaeng']],
    r[mcols['Reversegeocode']],
    r[mcols['Calculatedistances']],
    r[mcols['GEO_LAYER']]
  ];
}

/**
 * [v5.5.6 PATCH-6] geoIsCleanEnText_ — ตรวจว่าข้อความที่อยู่เป็น "EN สะอาด" หรือไม่
 * สะอาด = ไม่ว่าง + ยาวพอ (>=8) + ไม่มีอักษรไทย + ไม่มี Plus Code + ไม่ใช่ค่า error
 * ใช้ตัดสินนโยบาย Upgrade-only: ค่าสะอาดห้ามถูกทับ / ค่าสกปรกพร้อมอัปเกรดเมื่อมีค่าสะอาดกว่า
 */
function geoIsCleanEnText_(value) {
  if (value === null || value === undefined) return false;
  let t = String(value).trim();
  if (t.length < 8) return false;
  if (/[\u0E00-\u0E7F]/.test(t)) return false;              // อักษรไทย
  if (/[A-Z0-9]{4,}\+[A-Z0-9]{2,}/i.test(t)) return false;  // Plus Code (เช่น 7W2P+XR)
  let u = t.toUpperCase();
  if (u === 'GEOERR' || u === 'N/A' || u === 'MAPERR' || u === 'ERROR') return false;
  return true;
}

/**
 * สำหรับแถวที่มี Thai/English layer เดิม (เติมแล้ว)
 * [v5.5.6 PATCH-6] นโยบาย Upgrade-only (แทน "latest snapshot" เดิม):
 *   - U/V/W/X/AA แช่แข็งเหมือนเดิม
 *   - Y (Reversegeocode): ค่าปัจจุบันเป็น EN สะอาด → ห้ามถูกทับเด็ดขาด (freeze)
 *     ค่าปัจจุบันเป็นขยะ (ไทย/Plus Code/GeoErr/ว่าง) → อัปเกรดด้วย cleanEn
 *     (EN สะอาดล่าสุดของสถานที่นี้จาก SOURCE) ถ้าไม่มี → คงขยะเดิมไว้ (ไม่ทับขยะด้วยขยะ)
 *   - Z (Calculatedistances): เติมเฉพาะช่องว่าง (fill-don't-destroy)
 *     เว้นแต่อัปเกรด Y พร้อมกัน → เปลี่ยน Z เป็นคู่จากแถว SOURCE เดียวกับ Y ใหม่
 *   - ถ้าไม่มี SOURCE (hasSource=false) → คง Y/Z เดิมทั้งคู่ (ไม่ทำอะไรเลย)
 * @param {Array} r แถว MASTER ปัจจุบัน
 * @param {Object} mcols ดัชนีคอลัมน์
 * @param {Object} src แถว SOURCE ที่ถูกเลือก (latest + non-empty priority)
 * @param {boolean} hasSource มีแถว SOURCE ของ mdId นี้หรือไม่
 * @param {Object|null} cleanEn EN สะอาดล่าสุดของ mdId นี้ ({geoText, distance}) หรือ null
 */
function buildSkippedGeoRow_(r, mcols, src, hasSource, cleanEn) {
  let yCur = r[mcols['Reversegeocode']];
  let zCur = r[mcols['Calculatedistances']];
  let zBlank = (zCur === '' || zCur === null || zCur === undefined);
  let yNew, zNew;

  if (geoIsCleanEnText_(yCur)) {
    // สะอาดอยู่แล้ว → แช่แข็ง Y, เติม Z เฉพาะช่องว่าง
    yNew = yCur;
    zNew = (zBlank && hasSource) ? valueOrBlank_(src.distance) : zCur;
  } else if (cleanEn) {
    // ขยะ/ว่าง + มี EN สะอาดใน SOURCE → อัปเกรด Y, Z เป็นคู่จากแถวเดียวกัน
    yNew = cleanEn.geoText;
    let distOk = (cleanEn.distance !== undefined && cleanEn.distance !== null && cleanEn.distance !== '');
    zNew = distOk ? cleanEn.distance : zCur;
  } else {
    // ขยะ/ว่าง แต่ไม่มีของสะอาดมาแทน → คง Y เดิม, เติม Z เฉพาะช่องว่าง
    yNew = yCur;
    zNew = (zBlank && hasSource) ? valueOrBlank_(src.distance) : zCur;
  }

  return [
    r[mcols['Rahatpraisanee']],
    r[mcols['Changwat']],
    r[mcols['Amphoe_Khet']],
    r[mcols['Tambon_Kwaeng']],
    yNew,
    zNew,
    r[mcols['GEO_LAYER']]
  ];
}

/**
 * [v5.5.6 PATCH-6] buildGeoFillRow_ — แถวที่ยังไม่มี layer (เติมใหม่ / re-parse เพราะ layer ว่าง หรือ NO_MATCH หรือ Thai layer โดน 3b)
 * กันดาวน์เกรด (r, mcols เป็น optional เพื่อรองรับ caller เก่าที่ไม่ส่ง):
 *   - Y ปัจจุบันเป็น EN สะอาด แต่ค่าใหม่ที่จะเขียนไม่สะอาด → คง Y เดิม
 *   - Z ใหม่ว่าง แต่ Z เดิมมีค่า → คง Z เดิม (กันค่าหายตอน re-fill)
 */
function buildGeoFillRow_(g, r, mcols) {
  let yOut = g.reversegeocode;
  let zOut = g.calculatedistances;
  if (r && mcols) {
    let yCur = r[mcols['Reversegeocode']];
    if (geoIsCleanEnText_(yCur) && !geoIsCleanEnText_(yOut)) yOut = yCur;
    let zCur = r[mcols['Calculatedistances']];
    let zBlankOut = (zOut === '' || zOut === null || zOut === undefined);
    let zHasCur = (zCur !== '' && zCur !== null && zCur !== undefined);
    if (zBlankOut && zHasCur) zOut = zCur;
  }
  return [
    g.rahatpraisanee,
    g.changwat,
    g.amphoe_khet,
    g.tambon_kwaeng,
    yOut,
    zOut,
    g.geoLayer
  ];
}

function emptyGeoResult_() {
  return {
    rahatpraisanee: '',
    changwat: '',
    amphoe_khet: '',
    tambon_kwaeng: '',
    reversegeocode: '',
    calculatedistances: '',
    geoLayer: ''
  };
}

function shouldSkipEnglishGeo_(existingLayer) {
  if (!existingLayer) return false;
  if (existingLayer === 'NO_MATCH') return false;
  // Thai layer เดิม หรือ English layer เดิม ห้ามให้ English path ทับ
  return true;
}

/** รองรับ CHECK_NOTE ใน REVIEW_NOTE และ NOTE_TYPE หากมีคอลัมน์นั้น */
function isCheckNoteRow_(row, cols) {
  let reviewNote = cols['REVIEW_NOTE'] === undefined
    ? ''
    : String(row[cols['REVIEW_NOTE']] || '').trim().toUpperCase();
  let noteType = cols['NOTE_TYPE'] === undefined
    ? ''
    : String(row[cols['NOTE_TYPE']] || '').trim().toUpperCase();

  return reviewNote === 'CHECK_NOTE' || noteType === 'CHECK_NOTE';
}

function normalizeMdId_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function valueOrBlank_(value) {
  return value === null || value === undefined || value === '' ? '' : value;
}

/** สร้าง snapshot MD_ID ตามลำดับแถว */
function snapshotMdIds_(rows, mdIdColIndex) {
  return rows.map(function (row) {
    return normalizeMdId_(row[mdIdColIndex]);
  });
}

/** ตรวจ duplicate MD_ID ใน snapshot */
function findDuplicateMdIds_(mdIds) {
  let seen = {};
  let duplicates = [];
  mdIds.forEach(function (id) {
    if (!id) return;
    if (seen[id]) {
      if (duplicates.indexOf(id) < 0) duplicates.push(id);
    } else {
      seen[id] = true;
    }
  });
  return duplicates;
}

/** ตรวจจำนวนแถว output ต้องเท่ากับจำนวนแถว input */
function assertRowAlignment_(expectedRows, actualRows, batchStart) {
  if (expectedRows !== actualRows) {
    throw new Error(
      'ROW_ALIGNMENT_ERROR: batchStart=' + batchStart +
      ', expectedRows=' + expectedRows +
      ', actualRows=' + actualRows
    );
  }
}

/**
 * อ่าน MD_ID จากชีตหลังเขียน แล้วเทียบกับ snapshot ก่อนเขียนแบบตำแหน่งต่อ ตำแหน่ง
 */
function verifyMdIdsAfterWrite_(sheet, startRow, rowCount, mdIdColumn, expectedIds, context) {
  if (!sheet) throw new Error('MD_ID_VERIFY_ERROR: ไม่พบ sheet');
  if (expectedIds.length !== rowCount) {
    throw new Error(
      'MD_ID_VERIFY_ERROR: expectedIds length ' + expectedIds.length +
      ' ไม่เท่ากับ rowCount ' + rowCount + ' (' + context + ')'
    );
  }

  let actualIds = sheet
    .getRange(startRow, mdIdColumn, rowCount, 1)
    .getValues()
    .map(function (row) { return normalizeMdId_(row[0]); });

  let diffs = [];
  for (var i = 0; i < expectedIds.length; i++) {
    if (expectedIds[i] !== actualIds[i]) {
      diffs.push({
        offset: i,
        sheetRow: startRow + i,
        expected: expectedIds[i],
        actual: actualIds[i]
      });
    }
  }

  let duplicateIds = findDuplicateMdIds_(actualIds);
  if (diffs.length || duplicateIds.length) {
    throw new Error(
      'MD_ID_ALIGNMENT_ERROR (' + context + '): ' +
      JSON.stringify({ diffs: diffs, duplicateIds: duplicateIds })
    );
  }

  return { ok: true, rowCount: rowCount, mdIds: actualIds };
}

/**
 * ตรวจ MD_ID ของทั้งชีตก่อน/หลัง operation อื่น
 * ใช้สำหรับ unit/integration test หรือเรียกก่อนและหลัง run ได้
 */
function verifyMasterMdIds_(sheet, beforeIds, firstDataRow) {
  if (!sheet) throw new Error('MD_ID_VERIFY_ERROR: ไม่พบ sheet');
  firstDataRow = firstDataRow || 2;

  let rowCount = Math.max(sheet.getLastRow() - firstDataRow + 1, 0);
  if (beforeIds.length !== rowCount) {
    throw new Error(
      'MD_ID_VERIFY_ERROR: จำนวนแถวเปลี่ยนจาก ' + beforeIds.length +
      ' เป็น ' + rowCount
    );
  }

  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let mdCol = headers.map(function (v) { return String(v || '').trim(); }).indexOf('MD_ID');
  if (mdCol < 0) throw new Error('MD_ID_VERIFY_ERROR: ไม่พบหัวคอลัมน์ MD_ID');

  return verifyMdIdsAfterWrite_(
    sheet,
    firstDataRow,
    rowCount,
    mdCol + 1,
    beforeIds,
    'whole MASTER_PLACE'
  );
}

/** สร้าง snapshot ทั้ง MASTER_PLACE ก่อนเริ่ม run */
function snapshotMasterMdIds_() {
  // [v5.4.3 BUG-008 FIX] ใช้ SHEETS.MASTER แทน hard-coded
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.MASTER);
  if (!sheet || sheet.getLastRow() < 2) return [];
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let mdCol = headers.map(function (v) { return String(v || '').trim(); }).indexOf('MD_ID');
  if (mdCol < 0) throw new Error('ไม่พบหัวคอลัมน์ MD_ID');
  // getRange(row, col, numRows, numCols) — lastRow-1 = จำนวนแถวข้อมูลครบ
  return snapshotMdIds_(
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues(),
    mdCol
  );
}

/**
 * [v5.2 ENGLISH] geoParseEn_ — เหมือน geoParse_ แต่ใช้ English match
 * @returns {rahatpraisanee, changwat, amphoe_khet, tambon_kwaeng, reversegeocode, calculatedistances, geoLayer}
 */
function geoParseEn_(geoText, dist) {
  let out = { rahatpraisanee: '', changwat: '', amphoe_khet: '', tambon_kwaeng: '',
              reversegeocode: '', calculatedistances: '', geoLayer: '' };
  if (!geoText) return out;
  let m = geoMatchEn_(geoText);
  if (m) {
    let row = m.entry;
    // [v5.3] bug #7 fix: ตรวจ NOTE_TYPE_EN ก่อน — ถ้า CHECK_NOTE ห้ามเติมอัตโนมัติ
    let noteType = String(row[GEO_COL.NOTE_TYPE_EN] || '').trim().toUpperCase();
    if (noteType === 'CHECK_NOTE') {
      // [v5.5.4 PATCH-4] CHECK_NOTE + รหัสยืนยัน (English path) — หลักการเดียวกับ geoParse_
      //   ถ้ารหัสไปรษณีย์ที่ปรากฏในข้อความ reverse geocode ตรงกับรหัสของแถว dict
      //   ที่แมชต์ → เติมได้ เลเยอร์ CN_ZIP_OK_EN
      //   ผลจริงบน 2,669 แถว: กู้คืน 157/178 แถว (88%) — เฉพาะแถวที่ชื่อตำบลปรากฏในข้อความ
      //   แถวที่ไม่มีชื่อตำบลเลย (ตำบลต้องเดา) ยังบล็อกไว้ เพราะเป็นการเดา ไม่ใช่การยืนยัน
      let peCn = geoExtractEn_(geoText);
      if (peCn && peCn.postal &&
          String(row[GEO_COL.POSTAL] || '').trim() === String(peCn.postal).trim()) {
        out.rahatpraisanee = String(row[GEO_COL.POSTAL] || '');
        out.changwat = String(row[GEO_COL.PROVINCE_CLEAN] || '');
        out.amphoe_khet = String(row[GEO_COL.AMPHOE_CLEAN] || row[GEO_COL.AMPHOE_RAW] || '');
        out.tambon_kwaeng = String(row[GEO_COL.TAMBON_CLEAN] || '');
        out.geoLayer = 'CN_ZIP_OK_EN';
        out.reversegeocode = String(geoText || '');
        out.calculatedistances = (dist === 0 || dist === '0') ? 0 : ((dist !== undefined && dist !== null && dist !== '') ? dist : '');
        return out;
      }
      out.geoLayer = 'CHECK_NOTE';
      out.reversegeocode = String(geoText || '');
      // [v5.3.1] fix: ใช้ explicit check เพื่อรักษาค่า 0
      out.calculatedistances = (dist === 0 || dist === '0') ? 0 : ((dist !== undefined && dist !== null && dist !== '') ? dist : '');
      return out;
    }
    // [v5.2] ใช้ Thai columns (0,3,6,5) สำหรับเขียน - เพราะ column U-AA เป็นภาษาไทย
    out.rahatpraisanee = String(row[GEO_COL.POSTAL] || '');
    out.changwat = String(row[GEO_COL.PROVINCE_CLEAN] || '');
    out.amphoe_khet = String(row[GEO_COL.AMPHOE_CLEAN] || row[GEO_COL.AMPHOE_RAW] || '');
    out.tambon_kwaeng = String(row[GEO_COL.TAMBON_CLEAN] || '');
    out.geoLayer = m.layer;
  }
  out.reversegeocode = String(geoText || '');
  // [v5.3.1] bug fix: ค่า 0 หาย — ใช้ explicit check (0 || '' ให้ '' เพราะ 0 เป็น falsy)
  out.calculatedistances = (dist === 0 || dist === '0') ? 0 : ((dist !== undefined && dist !== null && dist !== '') ? dist : '');
  return out;
}

/**
 * diagnoseGeoKeys_ — ตรวจความสอดคล้องของ key format ใน SYS_TH_GEO กับ Logic ปัจจุบัน
 * ใช้เพื่อป้องกัน Dead Layer (delimiter / norm mismatch) ในอนาคต
 * เรียกจากเมนู "ดูผล / รีเซ็ต → ตรวจ Geo Key Alignment"
 * @returns {string} รายงานสั้น ๆ
 */
function diagnoseGeoKeys_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TH_GEO_SHEET);
  if (!sh || sh.getLastRow() < 2) {
    return '❌ ไม่พบชีต SYS_TH_GEO หรือไม่มีข้อมูล';
  }

  const sampleSize = Math.min(200, sh.getLastRow() - 1);
  const rows = sh.getRange(2, 1, sampleSize, 32).getValues();

  let postalPipe = 0, postalSpace = 0, postalOther = 0, postalEmpty = 0;
  let searchPipe = 0, searchSpaceInside = 0, searchEmpty = 0;
  let enSearchSpace = 0, enSearchNormable = 0, enPostalPipe = 0, enEmpty = 0;
  const samples = { postal: [], search: [], enSearch: [] };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const pk = String(r[GEO_COL.POSTAL_KEY] || '').trim();
    const sk = String(r[GEO_COL.SEARCH_KEY] || '').trim();
    const skEn = String(r[GEO_COL.SEARCH_KEY_EN] || '').trim();
    const pkEn = String(r[GEO_COL.POSTAL_KEY_EN] || '').trim();

    // Thai postal_key
    if (!pk) postalEmpty++;
    else if (pk.indexOf('|') >= 0) { postalPipe++; if (samples.postal.length < 2) samples.postal.push(pk); }
    else if (pk.indexOf(' ') >= 0) { postalSpace++; if (samples.postal.length < 2) samples.postal.push(pk); }
    else postalOther++;

    // Thai search_key
    if (!sk) searchEmpty++;
    else if (sk.indexOf('|') >= 0) {
      searchPipe++;
      if (/\s/.test(sk.replace(/\|/g, ''))) searchSpaceInside++;
      if (samples.search.length < 2) samples.search.push(sk);
    }

    // English
    if (!skEn) enEmpty++;
    else {
      if (/\s/.test(skEn)) enSearchSpace++;
      enSearchNormable++;
      if (samples.enSearch.length < 2) samples.enSearch.push(skEn);
    }
    if (pkEn && pkEn.indexOf('|') >= 0) enPostalPipe++;
  }

  // Expected by current code (v5.4.5+)
  const okPostal = postalPipe > 0 && postalSpace === 0;
  const okSearch = searchPipe > 0;
  const okEn = enSearchNormable > 0; // code now norms spaces away

  let report = '=== Geo Key Alignment Diagnostic (sample ' + sampleSize + ' rows) ===\n\n';
  report += 'TH postal_key:  pipe=' + postalPipe + ' space=' + postalSpace + ' other=' + postalOther + ' empty=' + postalEmpty + '\n';
  report += 'TH search_key:  pipe=' + searchPipe + ' (has space inside parts: ' + searchSpaceInside + ')\n';
  report += 'EN search_key:  has spaces=' + enSearchSpace + ' / total non-empty=' + enSearchNormable + '\n';
  report += 'EN postal_key:  pipe=' + enPostalPipe + '\n\n';

  report += 'Samples:\n';
  report += '  postal: ' + (samples.postal.join(' | ') || '(none)') + '\n';
  report += '  search: ' + (samples.search.join(' | ') || '(none)') + '\n';
  report += '  enSearch: ' + (samples.enSearch.join(' | ') || '(none)') + '\n\n';

  if (okPostal && okSearch) {
    report += '✅ TH keys ตรงกับ Logic ปัจจุบัน (delimiter = |)\n';
  } else {
    report += '❌ TH keys ไม่ตรงกับ Logic — อาจเกิด Dead Layer อีก\n';
    if (postalSpace > 0) report += '   → พบ postal_key ใช้ช่องว่าง แต่ Code คาดหวัง |\n';
  }
  if (okEn) {
    report += '✅ EN keys มีข้อมูล — Code จะ normalize (lower + ลบช่องว่าง) ตอน index\n';
  } else {
    report += '⚠️ EN keys ว่างเกือบทั้งหมด — ชั้น English อาจไม่มีข้อมูลให้ match\n';
  }

  report += '\nCache note: ดัชนีเต็มแถวมักเกิน 90KB → cache.put ถูกข้าม (rebuild ทุกครั้ง)\n';
  report += 'เวอร์ชัน Logic: v5.5.0 (postal = | , key normalize รายส่วนด้วย normArea_/normAreaEn_, alias Bangkok ↔ Krung Thep Maha Nakhon)\n';

  return report;
}

/** UI wrapper สำหรับ diagnoseGeoKeys_ */
function uiDiagnoseGeoKeys() {
  const report = diagnoseGeoKeys_();
  SpreadsheetApp.getUi().alert(report);
}


/**
 * [v5.5.4 PATCH-5] uiClearGeoColumnsOnly — ล้างเฉพาะ 7 คอลัมน์ราชการ (U-AA) ทั้งชีต MASTER_PLACE
 * ไม่แตะคอลัมน์อื่นเลย (MD_ID/NAME/LAT/LNG/... คงเดิมทั้งหมด)
 *
 * ทำไมต้องมี: runMasterGeo / runMasterGeoEn เว้นแถวที่มี GEO_LAYER อยู่แล้ว (กันทับค่ามือ)
 *   แถวที่เติมผิดตั้งแต่รอบรันเก่า (ก่อน v5.5.3) จะไม่ถูกแก้ จนกว่าจะล้างเลเยอร์เดิม
 *
 * วิธีใช้ (ครั้งเดียวพอ หลังวางไฟล์นี้):
 *   1) รันฟังก์ชันนี้จากเมนู "ดูผล / รีเซ็ต" (เพิ่มบรรทัดใน 03_Menu.gs ตามด้านล่าง) หรือรันจาก Editor
 *   2) กดปุ่ม 3b) เติม 7 คอลัมน์ราชการ (English) ใหม่ทั้งชีต
 *   3) เทียบผลกับชีต "03_ค่าที่จะเปลี่ยน" ในรายงานวิเคราะห์ (187 แถว: เติมใหม่ 158 / แก้ตำบล 24 / แก้รหัส+ตำบล 5)
 *
 * เพิ่มใน 03_Menu.gs (ใน submenu "ดูผล / รีเซ็ต" ได้เลย):
 *   .addItem('🧹 ล้างเฉพาะ 7 คอลัมน์ราชการ (U-AA)', 'uiClearGeoColumnsOnly')
 */
function uiClearGeoColumnsOnly() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEETS.MASTER);
  if (!sh) {
    ui.alert('❌ ไม่พบชีต ' + SHEETS.MASTER);
    return;
  }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (v) { return String(v || '').trim(); });
  const cols7 = ['Rahatpraisanee', 'Changwat', 'Amphoe_Khet', 'Tambon_Kwaeng',
                 'Reversegeocode', 'Calculatedistances', 'GEO_LAYER'];
  const idx = {};
  cols7.forEach(function (h) { idx[h] = headers.indexOf(h); });
  const missing = cols7.filter(function (h) { return idx[h] < 0; });
  if (missing.length) {
    ui.alert('❌ ไม่พบคอลัมน์: ' + missing.join(', '));
    return;
  }
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    ui.alert('ไม่มีข้อมูลให้ล้าง');
    return;
  }
  const res = ui.alert(
    'ล้าง 7 คอลัมน์ราชการ?',
    'จะล้าง ' + cols7.join(', ') + '\nทั้งหมด ' + (lastRow - 1) + ' แถว ในชีต ' + SHEETS.MASTER +
    '\n(คอลัมน์อื่นไม่ถูกแตะ) แล้วรันปุ่ม 3/3b เพื่อเติมใหม่',
    ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;

  // ล้างทีละคอลัมน์ (เขียน '' ทับ) — กัน quota ด้วยการเขียนเป็น range ก้อนใหญ่ต่อคอลัมน์
  cols7.forEach(function (h) {
    sh.getRange(2, idx[h] + 1, lastRow - 1, 1).clearContent();
  });
  // ล้าง geo dict cache ด้วย เพื่อโหลด dict ใหม่ในรอบถัดไป
  try { clearThGeoCache(); } catch (e) { /* ฟังก์ชันอาจไม่อยู่ — ไม่เป็นไร */ }
  ui.alert('✅ ล้างครบ 7 คอลัมน์แล้ว (' + (lastRow - 1) + ' แถว)\nต่อไปกดปุ่ม 3b) เติม 7 คอลัมน์ราชการ (English)');
}
