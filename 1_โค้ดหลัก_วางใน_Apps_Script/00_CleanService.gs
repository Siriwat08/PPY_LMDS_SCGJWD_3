/**
 * CleanService — ล้างข้อมูลไทยเป็นมาตรฐาน (v5)
 * หลักฐานจากข้อมูลจริง 13,935 แถว + 200 แถวทดสอบ:
 *   1. EXACT 3-คอลัมน์ (cleanName|cleanAddr|cleanOwner) — แมชต์หลัก ~100% เมื่อคนขับ/ระบบพิมพ์คำเดียวกัน
 *   2. ALIAS 3-คอลัมน์ (ลบช่องว่าง + ลบ '-') — จับกรณี 'บ.เอชทูโอ-ไฮโดร' vs 'บริษัท เอชทูโอไฮโดร', 'ถ ราชพฤกษ์' vs 'ถราชพฤกษ์'
 *   3. REVIEW — งานที่ข้อมูลเขียนไม่เหมือนจริง (คนละที่/พิมพ์คนละแบบมาก) ให้คนดู
 *
 * หมายเหตุ: ไม่มี FALLBACK 2-คอลัมน์ในโค้ดจริง — ใช้เฉพาะ exact3 + alias3
 * ปุ่ม 1 / ปุ่ม 2 / Service_SCG ใช้ makeKey + makeKeyAlias ชุดเดียวกันเท่านั้น
 */

/** แปลงเลขไทยเป็นเลขอาหรับ */
function cleanThaiDigits_(s) {
  const map = { '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4',
                '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9' };
  return s.replace(/[๐-๙]/g, function (c) { return map[c]; });
}

/** ล้างเท็กซ์ไทยเป็นมาตรฐาน: ตัดวงเล็บ+โทร., คำนำหน้าชื่อ, เลขไทย, สัญลักษณ์ */
function cleanThai(s) {
  if (s === undefined || s === null) return '';
  let str = String(s).trim();
  if (!str) return '';
  // ตัดครึ่งวงเล็บ/วงเล็บพร้อมเนื้อหา (ชั้นเดียว — วงเล็บซ้อนลึกอาจเหลือเศษ)
  str = str.replace(/[\[\(][^\]\)]*[\]\)]/g, ' ');
  // ตัด "โทร." พร้อมเลขที่ตามหลัง
  str = str.replace(/โทร\.?\s*\d[\d\- ๐-๙]{3,}/g, ' ');
  // ตัดคำนำหน้าชื่อคน: นาย/นาง/นางสาว/คุณ/ดร.
  str = str.replace(/^(นาย|นาง|นางสาว|คุณ|ดร\.?)\s+/g, ' ');
  // แปลงเลขไทย→อาหรับ
  str = cleanThaiDigits_(str);
  // ตัดสัญลักษณ์ เหลือเฉพาะไทย+อาหรับ+อังกฤษ+ช่องว่าง+ยัติภังค์+สแลช
  str = str.replace(/[^A-Za-z0-9ก-๙ \-\/]/g, ' ');
  // รวมช่องว่างซ้ำ
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * ล้างชื่อคน/บริษัท โดยเก็บคำของชื่อเดิมไว้ครบ ไม่ตัดคำหน้า/ท้ายชื่อ
 * ห้ามลบคำว่า บริษัท, บจก., จำกัด — จะทำให้ NAME_CLEAN และ MATCH_KEY ผิด
 * (alias ช่วยแค่ลบช่องว่าง/-)
 */
function cleanName(s) {
  return cleanThai(s);
}

/**
 * ล้างที่อยู่: ตัดคำนำหน้าตำบล/อำเภอ/จังหวัด ที่ต้นสตริง และเลขไปรษณีย์ท้าย
 * ตัดเฉพาะต้นสตริง (^) — ไม่ขยาย global เพื่อไม่เปลี่ยน MATCH_KEY ของ MASTER เดิม
 */
function cleanAddr(s) {
  let str = cleanThai(s);
  str = str.replace(/^(แขวง|เขต|ตำบล|อําเภอ|อำเภอ|จังหวัด|จ\.|ตําบล|หมู่|ม\u0E48)\s*/g, '');
  str = str.replace(/\s*\d{5}\s*$/, '');
  return str.replace(/\s+/g, ' ').trim();
}

/** ล้างชื่อเจ้าของสินค้า — ใช้ cleanName ชุดเดียวกัน */
function cleanOwner(s) {
  return cleanName(s);
}

/** ลบช่องว่างทั้งหมดและยัติภังค์ (สำหรับ alias key) */
function aliasOf(s) {
  return s.replace(/\s+/g, '').replace(/-/g, '');
}

/** EXACT key: cleanName | cleanAddr | cleanOwner */
function makeKey(name, addr, owner) {
  return [cleanName(name), cleanAddr(addr), cleanOwner(owner)].join('|');
}

/** ALIAS key: alias(cleanName) | alias(cleanAddr) | alias(cleanOwner) */
function makeKeyAlias(name, addr, owner) {
  return [aliasOf(cleanName(name)), aliasOf(cleanAddr(addr)), aliasOf(cleanOwner(owner))].join('|');
}
