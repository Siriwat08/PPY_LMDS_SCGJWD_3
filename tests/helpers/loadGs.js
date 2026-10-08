/**
 * loadGs.js — test harness for Google Apps Script (.gs) sources.
 *
 * Loads .gs files (plain ES5/ES2015 scripts that rely on GAS globals)
 * into a single shared sandbox context via the `vm` module, after
 * injecting lightweight mocks of the Google Apps Service APIs used
 * by the pure-logic portions of the code.
 *
 * Usage:
 *   const { ctx } = loadGs(['00_CleanService.gs']);
 *   ctx.makeKey('ร้าน ก', 'แขวงบางพลี ถ.สุขุมวิท 10260', 'บจก. เอ บี');
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_DIR = path.resolve(__dirname, '..', '..', '1_โค้ดหลัก_วางใน_Apps_Script');

/** In-memory mock of Google Sheets Range object. */
class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row; // 1-based
    this.col = col; // 1-based
    this.numRows = numRows || 1;
    this.numCols = numCols || 1;
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        line.push(this.sheet.getCell(this.row + r, this.col + c));
      }
      out.push(line);
    }
    return out;
  }

  getValue() {
    return this.getValues()[0][0];
  }

  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        this.sheet.setCell(this.row + r, this.col + c, values[r][c]);
      }
    }
    return this;
  }

  setValue(v) {
    return this.setValues([[v]]);
  }

  clearContent() {
    return this.setValues(
      Array.from({ length: this.numRows }, () => Array(this.numCols).fill(''))
    );
  }

  // Chainable formatting no-ops (not relevant to logic tests)
  setFontWeight() { return this; }
  setNumberFormat() { return this; }
  setBackground() { return this; }
  setHorizontalAlignment() { return this; }
  getA1Notation() {
    return this.sheet.name + '!' + this.row + ':' + (this.row + this.numRows - 1);
  }
}

/** In-memory mock of Google Sheets Sheet object. */
class MockSheet {
  constructor(name, rows /* array of arrays */) {
    this.name = name;
    this.grid = (rows || []).map((r) => r.slice());
    this.deletedColumns = []; // recorded by deleteColumn for assertions
  }

  getName() { return this.name; }

  /** GAS Sheet.deleteColumn(position) — 1-based */
  deleteColumn(position) {
    this.deletedColumns.push(position);
    const idx = position - 1;
    for (const row of this.grid) row.splice(idx, 1);
    return this;
  }

  getLastRow() {
    let lr = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i].some((v) => v !== '' && v !== null && v !== undefined)) lr = i + 1;
    }
    return lr;
  }

  getLastColumn() {
    let lc = 0;
    for (const row of this.grid) {
      for (let c = row.length - 1; c >= 0; c--) {
        if (row[c] !== '' && row[c] !== null && row[c] !== undefined) { lc = Math.max(lc, c + 1); break; }
      }
    }
    return lc;
  }

  getCell(row, col) {
    const r = this.grid[row - 1];
    if (!r) return '';
    return r[col - 1] === undefined ? '' : r[col - 1];
  }

  setCell(row, col, value) {
    while (this.grid.length < row) this.grid.push([]);
    const r = this.grid[row - 1];
    while (r.length < col) r.push('');
    r[col - 1] = value;
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    return new MockRange(this, row, col, numRows, numCols);
  }

  appendRow(arr) {
    this.grid.push(arr.slice());
    return this;
  }
}

/** In-memory mock of Spreadsheet object. */
class MockSpreadsheet {
  constructor(sheets /* {name: rows[][]} */) {
    this.sheets = {};
    Object.keys(sheets).forEach((n) => { this.sheets[n] = new MockSheet(n, sheets[n]); });
  }
  getSheetByName(name) { return this.sheets[name] || null; }
  getId() { return 'mock-id'; }
  insertSheet(name) {
    this.sheets[name] = new MockSheet(name, []);
    return this.sheets[name];
  }
}

function buildSandbox(ss) {
  const noop = function () {};
  const propsStore = {};
  const sandbox = {
    console: console,
    Logger: { log: noop },
    Date: Date,
    Math: Math,
    JSON: JSON,
    Set: Set,
    Map: Map,
    isNaN: isNaN,
    parseFloat: parseFloat,
    parseInt: parseInt,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Array: Array,
    Object: Object,
    Error: Error,
    RegExp: RegExp,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush: noop,
      getUi: () => ({ alert: noop }),
    },
    Session: {
      getScriptTimeZone: () => 'Asia/Bangkok',
      getActiveUser: () => ({ getEmail: () => '' }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }),
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
          (fmt.indexOf('HH') >= 0 ? ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) : '');
      },
      computeDigest: () => [],
      sleep: noop,
    },
    PropertiesService: {
      getUserProperties: () => ({
        getProperty: (k) => (k in propsStore ? propsStore[k] : null),
        setProperty: (k, v) => { propsStore[k] = v; },
        deleteProperty: (k) => { delete propsStore[k]; },
      }),
      getScriptProperties: () => ({
        getProperty: () => null, setProperty: noop, deleteProperty: noop,
      }),
    },
    CacheService: {
      getScriptCache: () => ({ get: () => null, put: noop, remove: noop }),
      getDocumentCache: () => ({ get: () => null, put: noop, remove: noop }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: noop }),
    },
    UrlFetchApp: { fetch: noop },
    DriveApp: {
      getFileById: () => ({ getParents: () => ({ hasNext: () => false }) }),
      getRootFolder: () => ({ getFilesByName: () => ({ hasNext: () => false }) }),
    },
    MimeType: { PLAIN_TEXT: 'text/plain' },
  };
  sandbox.global = sandbox;
  return sandbox;
}

/**
 * Load one or more .gs files from the main source folder into a shared sandbox.
 *
 * GAS concatenates all .gs files as top-level script code, so top-level
 * `const`/`let` are visible across files. Node's `vm.runInContext` compiles
 * each script separately and keeps top-level let/const script-scoped, so we
 * append an export epilogue that copies every top-level binding onto the
 * global sandbox object (functions already live there via hoisting).
 *
 * @param {string[]} fileNames e.g. ['00_CleanService.gs']
 * @param {object} [sheets] optional map {sheetName: rows[][]} for the mock spreadsheet
 * @returns {{ctx: object, ss: MockSpreadsheet}}
 */
function loadGs(fileNames, sheets = {}) {
  const ss = new MockSpreadsheet(sheets);
  const ctx = buildSandbox(ss);
  vm.createContext(ctx);
  for (const f of fileNames) {
    let code = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    // Detect top-level const/let names and export them to the sandbox global
    // so subsequent scripts (and tests) can see them like in GAS.
    const names = [];
    const re = /^(?:const|let)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(code)) !== null) {
      if (!names.includes(m[1])) names.push(m[1]);
    }
    if (names.length) {
      code += '\n;this.$$export = function (o) {' +
        names.map((n) => 'try { o["' + n + '"] = ' + n + '; } catch (e) {}').join('') +
        '}.call(this, this);\n';
    }
    vm.runInContext(code, ctx, { filename: f });
    if (ctx.$$export) { Object.assign(ctx, ctx.$$export); delete ctx.$$export; }
  }
  return { ctx, ss };
}

module.exports = { loadGs, MockSheet, MockSpreadsheet, SRC_DIR };
