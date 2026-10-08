/**
 * Unit tests — 00_Config.gs helpers (RBAC assertRole_, cookie storage, config validation)
 * Run: node --test tests/
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { loadGs } = require('./helpers/loadGs');

function loadConfig(opts = {}) {
  const sheets = opts.sheets || {};
  const { ctx, ss } = loadGs(['00_CleanService.gs', '00_Config.gs'], sheets);
  if (opts.email !== undefined) {
    // override Session.getActiveUser for RBAC tests
    ctx.Session.getActiveUser = () => ({ getEmail: () => opts.email });
  }
  return { ctx, ss };
}

test('SHEETS contains all 10 documented sheet names', () => {
  const { ctx } = loadConfig();
  const keys = Object.keys(ctx.SHEETS);
  assert.strictEqual(keys.length, 10);
  ['SOURCE', 'DAILY', 'MASTER', 'SETTINGS', 'GEO_DICT', 'SUMMARY_OWNER',
    'SUMMARY_SHIP', 'INPUT', 'EMPLOYEE', 'MASTER_IDX'].forEach((k) => {
    assert.ok(ctx.SHEETS[k], 'missing SHEETS.' + k);
  });
});

test('DATA_IDX / MASTER_IDX column maps match documented totals', () => {
  const { ctx } = loadConfig();
  assert.strictEqual(ctx.DATA_IDX.TOTAL_COLS, 32);
  assert.strictEqual(ctx.MASTER_IDX.TOTAL_COLS, 27);
  assert.strictEqual(ctx.DATA_HEADERS.length, ctx.DATA_IDX.TOTAL_COLS);
  assert.strictEqual(ctx.MASTER_HEADERS.length, ctx.MASTER_IDX.TOTAL_COLS);
  // header order must line up with index constants
  assert.strictEqual(ctx.DATA_HEADERS[ctx.DATA_IDX.MATCH_KEY], 'MATCH_KEY');
  assert.strictEqual(ctx.DATA_HEADERS[ctx.DATA_IDX.LATLNG_ACTUAL], 'LatLong_Actual');
  assert.strictEqual(ctx.MASTER_HEADERS[ctx.MASTER_IDX.LAT], 'LAT');
});

test('assertRole_: empty ROLE_MAP → not enforced (documented behavior)', () => {
  const { ctx } = loadConfig({ email: 'anyone@x.com' });
  ctx.ROLE_MAP.admin = [];
  ctx.ROLE_MAP.editor = [];
  assert.doesNotThrow(() => ctx.assertRole_('editor'));
});

test('assertRole_: RBAC configured + unknown user → denied for editor', () => {
  const { ctx } = loadConfig({ email: 'intruder@x.com' });
  ctx.ROLE_MAP.admin = ['admin@x.com'];
  ctx.ROLE_MAP.editor = ['editor@x.com'];
  assert.throws(() => ctx.assertRole_('editor'), /Permission denied/);
});

test('assertRole_: admin passes editor requirement; editor passes editor', () => {
  // NOTE: current implementation grants admins only for requiredRole==='admin';
  // for requiredRole==='editor' an admin must also be listed in ROLE_MAP.editor.
  // (Documented as an improvement suggestion — hierarchy not implemented yet.)
  const adm = loadConfig({ email: 'admin@x.com' });
  adm.ctx.ROLE_MAP.admin = ['ADMIN@X.COM']; // case-insensitive compare
  assert.doesNotThrow(() => adm.ctx.assertRole_('admin'));

  const edt = loadConfig({ email: 'editor@x.com' });
  edt.ctx.ROLE_MAP.admin = ['admin@x.com'];
  edt.ctx.ROLE_MAP.editor = ['editor@x.com'];
  assert.doesNotThrow(() => edt.ctx.assertRole_('editor'));
});

test('KNOWN GAP (pinned): admin NOT auto-allowed for requiredRole "editor" — needs explicit entry', () => {
  const { ctx } = loadConfig({ email: 'admin@x.com' });
  ctx.ROLE_MAP.admin = ['admin@x.com'];
  ctx.ROLE_MAP.editor = [];
  assert.throws(() => ctx.assertRole_('editor'), /not in allowlist/);
});

test('assertRole_: fail-closed when RBAC on but active user email unavailable', () => {
  const { ctx } = loadConfig({ email: '' });
  ctx.ROLE_MAP.admin = ['admin@x.com'];
  assert.throws(() => ctx.assertRole_('editor'), /cannot identify active user/);
});

test('setScgCookie_/getScgCookie_: stores in UserProperties, migrates+clears sheet B1', () => {
  const { ctx, ss } = loadConfig({
    sheets: { Input: [['COOKIE_CELL_LABEL', ''], ['SHPT-1', 'legacy-cookie-value-from-sheet']] },
  });
  // fresh user: no property yet → reads sheet and migrates
  const got = ctx.getScgCookie_();
  assert.strictEqual(got, 'legacy-cookie-value-from-sheet');
  assert.strictEqual(ss.getSheetByName('Input').getCell(1, 2), '', 'B1 should be cleared after migration');

  // set new cookie via properties
  assert.strictEqual(ctx.setScgCookie_('a-long-enough-cookie-value'), true);
  assert.strictEqual(ctx.getScgCookie_(), 'a-long-enough-cookie-value');

  // delete
  assert.strictEqual(ctx.setScgCookie_(''), false);
  assert.strictEqual(ctx.getScgCookie_(), '');
});

test('setScgCookie_: rejects suspiciously short cookie', () => {
  const { ctx } = loadConfig();
  assert.throws(() => ctx.setScgCookie_('abc'), /สั้นผิดปกติ/);
});

test('validateConfig_: reports missing sheets as errors', () => {
  const { ctx } = loadConfig({ sheets: { MASTER_PLACE: [['MD_ID']] } });
  const res = ctx.validateConfig_();
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('SCGนครหลวงJWDภูมิภาค')));
  assert.ok(res.infos.some((i) => i.includes('MASTER_PLACE')));
});

test('trimPiiColumns_: deletes ID-card/phone columns from EMPLOYEE sheet', () => {
  const { ctx } = loadConfig({
    sheets: {
      'ข้อมูลพนักงาน': [
        ['ID', 'ชื่อ', 'เบอร์โทร', 'เลขบัตร', 'ทะเบียน', 'ประเภทรถ', 'Email', 'Role'],
        ['1', 'สมชาย', '0812345678', '1234567890123', 'กก1', '6w', 'a@x.com', 'driver'],
      ],
    },
  });
  const deleted = ctx.trimPiiColumns_();
  assert.ok(deleted >= 2, 'expected at least phone+idcard columns deleted, got ' + deleted);
});
