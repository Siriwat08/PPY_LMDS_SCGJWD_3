/**
 * Unit tests — 00_CleanService.gs (หัวใจ MATCH_KEY ของทั้งระบบ)
 * Run: node --test tests/
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { loadGs } = require('./helpers/loadGs');

const { ctx } = loadGs(['00_CleanService.gs']);
const { cleanThai, cleanThaiDigits_, cleanName, cleanAddr, cleanOwner, aliasOf, makeKey, makeKeyAlias } = ctx;

test('cleanThai: null/undefined/empty → ""', () => {
  assert.strictEqual(cleanThai(null), '');
  assert.strictEqual(cleanThai(undefined), '');
  assert.strictEqual(cleanThai(''), '');
  assert.strictEqual(cleanThai('   '), '');
});

test('cleanThai: lowercase + collapse whitespace', () => {
  assert.strictEqual(cleanThai('ABC   def'), 'abc def');
});

test('cleanThai: converts Thai digits to Arabic', () => {
  assert.strictEqual(cleanThai('เลข ๑๒๓๔๕'), 'เลข 12345');
});

test('cleanThai: strips bracketed segments (both kinds of brackets)', () => {
  assert.strictEqual(cleanThai('ร้าน ก (สาขา 1) [ปิด]'), 'ร้าน ก');
});

test('cleanThai: strips "โทร." + following number', () => {
  assert.strictEqual(cleanThai('บจก เอ็นบี โทร. 02-111-2222'), 'บจก เอ็นบี');
});

test('cleanThai: strips leading person titles', () => {
  assert.strictEqual(cleanThai('นาย สมชาย ใจดี'), 'สมชาย ใจดี');
  assert.strictEqual(cleanThai('นางสาว ก ข'), 'ก ข');
});

test('cleanThai: keeps company words intact (README rule: ห้ามลบ บริษัท/บจก./จำกัด)', () => {
  const out = cleanThai('บจก. จำกัด เอชทูโอ-ไฮโดร/แก๊ส');
  assert.match(out, /บจก/);
  assert.match(out, /จำกัด/);
});

test('cleanName === cleanThai; cleanOwner === cleanName (single source of truth)', () => {
  const s = 'ร้าน测试 ก (x)';
  assert.strictEqual(cleanName(s), cleanThai(s));
  assert.strictEqual(cleanOwner(s), cleanName(s));
});

test('cleanAddr: strips leading admin prefixes only (แขวง/เขต/ตำบล/อำเภอ/จังหวัด)', () => {
  assert.strictEqual(cleanAddr('แขวงบางพลี อำเภอเมือง'), 'บางพลี อำเภอเมือง'); // in-string occurrences kept
  assert.strictEqual(cleanAddr('ตำบลในช่องว่าง จังหวัด'), 'ในช่องว่าง จังหวัด');
});

test('cleanAddr: "จ." prefix is NOT stripped — cleanThai removes "." before cleanAddr runs (documented quirk)', () => {
  // cleanThai replaces '.' with a space, so the anchored /^จ\./ rule can never fire.
  // Pinned as a regression guard: if someone fixes cleanThai ordering, this test must be updated together
  // with a full MATCH_KEY migration (README rule: don't change cleanThai without a migration plan).
  assert.strictEqual(cleanAddr('จ.สมุทรปราการ ถ.สุขุมวิท'), 'จ สมุทรปราการ ถ สุขุมวิท');
});

test('cleanAddr: strips trailing 5-digit postal code', () => {
  assert.ok(/10260$/.test(cleanAddr('ถ.สุขุมวิท 10260')) === false);
  assert.strictEqual(cleanAddr('บางพลี 10260'), 'บางพลี');
});

test('aliasOf: removes spaces and hyphens', () => {
  assert.strictEqual(aliasOf('a b-c d'), 'abcd');
});

test('makeKey: joins three cleaned parts with "|"', () => {
  const k = makeKey('ร้าน ก', 'แขวงบางพลี 10260', 'บจก เอ บี');
  const parts = k.split('|');
  assert.strictEqual(parts.length, 3);
  assert.strictEqual(parts[0], cleanName('ร้าน ก'));
  assert.strictEqual(parts[1], cleanAddr('แขวงบางพลี 10260'));
  assert.strictEqual(parts[2], cleanOwner('บจก เอ บี'));
});

test('makeKey is deterministic/idempotent (same inputs → same key)', () => {
  const a = makeKey('ร้าน ก', 'ที่อยู่ X', 'เจ้าของ Y');
  const b = makeKey('ร้าน ก', 'ที่อยู่ X', 'เจ้าของ Y');
  assert.strictEqual(a, b);
});

test('makeKeyAlias: matches "บ.เอชทูโอ-ไฮโดร" vs "บริษัท เอชทูโอไฮโดร" style variants on name part', () => {
  // alias layer only removes spaces/hyphens — full-word differences stay REVIEW by design
  const k1 = makeKeyAlias('เอชทูโอ-ไฮโดร', 'ถ ราชพฤกษ์ 10260', 'เจ้าของ');
  const k2 = makeKeyAlias('เอชทูโอ ไฮโดร', 'ถราชพฤกษ์ 10260', 'เจ้าของ');
  assert.strictEqual(k1, k2);
});

test('makeKeyAlias differs from exact makeKey when spacing differs', () => {
  const exact1 = makeKey('เอ บ', 'a', 'o');
  const exact2 = makeKey('เอ-บ', 'a', 'o');
  assert.notStrictEqual(exact1, exact2);
  assert.strictEqual(makeKeyAlias('เอ บ', 'a', 'o'), makeKeyAlias('เอ-บ', 'a', 'o'));
});

test('cleanThaiDigits_: maps all ten Thai digits', () => {
  assert.strictEqual(cleanThaiDigits_('๐๑๒๓๔๕๖๗๘๙'), '0123456789');
});
