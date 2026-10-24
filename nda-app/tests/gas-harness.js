// Minimal stand-ins for the Apps Script services the NDA portal uses, so Code.gs,
// Validation.gs and the HTML templates can run under plain Node (`node --test`).
// Only the calls the app actually makes are implemented.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'apps-script');
const SCRIPT_FILES = ['Config.gs', 'Validation.gs', 'Code.gs'];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Compiles Apps Script template syntax: <? code ?>, <?= escaped ?>, <?!= raw ?>.
function compileTemplate(source) {
  const re = /<\?(!=|=)?([\s\S]*?)\?>/g;
  let code = 'let __out = "";\n';
  let last = 0;
  let m;
  while ((m = re.exec(source))) {
    code += '__out += ' + JSON.stringify(source.slice(last, m.index)) + ';\n';
    if (m[1] === '=') code += '__out += __esc(' + m[2] + ');\n';
    else if (m[1] === '!=') code += '__out += String(' + m[2] + ');\n';
    else code += m[2] + '\n';
    last = re.lastIndex;
  }
  return code + '__out += ' + JSON.stringify(source.slice(last)) + ';\nreturn __out;';
}

function createApp() {
  let nextId = 1;
  const newId = (prefix) => prefix + (nextId++);
  const props = {};
  const files = new Map(); // id -> folder or file record
  const spreadsheets = new Map();
  const mail = [];
  const logs = [];
  let context;

  class Blob {
    constructor(data, type, name) {
      this.bytes = Buffer.isBuffer(data) ? data : Buffer.from(Array.isArray(data) ? data.map((b) => b & 0xff) : String(data));
      this.type = type;
      this.name = name;
    }
    getBytes() { return Array.from(this.bytes, (b) => (b > 127 ? b - 256 : b)); }
    getName() { return this.name; }
    setName(name) { this.name = name; return this; }
    getContentType() { return this.type; }
    getDataAsString() { return this.bytes.toString('utf8'); }
    // The real converter renders the HTML; here the "PDF" is a %PDF marker plus the HTML, so tests can inspect it.
    getAs(type) {
      return new Blob(Buffer.concat([Buffer.from('%PDF-1.4\n'), this.bytes]), type, this.name.replace(/\.[^.]+$/, '') + '.pdf');
    }
  }

  function makeFolder(name, parentId) {
    const folder = {
      id: newId('folder'), name, parentId, trashed: false, isFolder: true,
      getId() { return this.id; },
      getName() { return this.name; },
      getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; },
      isTrashed() { return this.trashed; },
      createFolder(childName) { return makeFolder(childName, this.id); },
      createFile(blob) {
        const file = makeFile(blob.getName(), this.id);
        file.blob = blob;
        return file;
      },
    };
    files.set(folder.id, folder);
    return folder;
  }

  function makeFile(name, parentId, id) {
    const file = {
      id: id || newId('file'), name, parentId, trashed: false, isFolder: false, blob: null,
      getId() { return this.id; },
      getName() { return this.name; },
      getUrl() { return 'https://drive.google.com/file/d/' + this.id + '/view'; },
      isTrashed() { return this.trashed; },
      moveTo(folder) { this.parentId = folder.getId(); return this; },
    };
    files.set(file.id, file);
    return file;
  }

  function makeSheet(spreadsheet) {
    const rows = []; // raw values as written, 1-based rows mapped to rows[row - 1]
    const read = (raw) => (typeof raw === 'string' && raw.startsWith("'") ? raw.slice(1) : raw == null ? '' : raw);
    const sheet = {
      name: 'Sheet1', rows, frozen: 0,
      setName(name) { this.name = name; return this; },
      setFrozenRows(n) { this.frozen = n; },
      getParent() { return spreadsheet; },
      getLastRow() { return rows.length; },
      getRange(row, col, numRows = 1, numCols = 1) {
        const range = {
          getRow() { return row; },
          getValue() { return read((rows[row - 1] || [])[col - 1]); },
          getValues() {
            const out = [];
            for (let r = 0; r < numRows; r++) {
              const line = [];
              for (let c = 0; c < numCols; c++) line.push(read((rows[row - 1 + r] || [])[col - 1 + c]));
              out.push(line);
            }
            return out;
          },
          setValue(value) { return range.setValues([[value]]); },
          setValues(values) {
            values.forEach((line, r) => {
              rows[row - 1 + r] = rows[row - 1 + r] || [];
              line.forEach((value, c) => { rows[row - 1 + r][col - 1 + c] = value; });
            });
            return range;
          },
          setNumberFormat() { return range; },
          setFontWeight() { return range; },
          createTextFinder(text) {
            return {
              matchEntireCell() { return this; },
              findNext() {
                const values = range.getValues();
                for (let r = 0; r < values.length; r++) {
                  for (let c = 0; c < values[r].length; c++) {
                    if (String(values[r][c]) === text) return sheet.getRange(row + r, col + c);
                  }
                }
                return null;
              },
            };
          },
        };
        return range;
      },
    };
    return sheet;
  }

  function makeSpreadsheet(name) {
    const file = makeFile(name, null);
    const spreadsheet = {
      getId() { return file.id; },
      getUrl() { return 'https://docs.google.com/spreadsheets/d/' + file.id + '/edit'; },
      getSheets() { return [sheet]; },
    };
    const sheet = makeSheet(spreadsheet);
    spreadsheets.set(file.id, spreadsheet);
    return spreadsheet;
  }

  function formatDate(date, tz, pattern) {
    const parts = (options) => {
      const out = {};
      new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz, hourCycle: 'h23' }, options))
        .formatToParts(date).forEach((p) => { out[p.type] = p.value; });
      return out;
    };
    const n = parts({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const monthName = parts({ month: 'long' }).month;
    return pattern.replace(/yyyy|yy|MMMM|MM|dd|d|HH|mm|ss/g, (token) => ({
      yyyy: n.year, yy: n.year.slice(-2), MMMM: monthName, MM: n.month,
      dd: n.day, d: String(Number(n.day)), HH: n.hour, mm: n.minute, ss: n.second,
    })[token]);
  }

  function createTemplateFromFile(name) {
    const source = fs.readFileSync(path.join(SRC, name + '.html'), 'utf8');
    const template = {
      evaluate() {
        const vars = Object.assign({}, template);
        delete vars.evaluate;
        // Compiled inside the script's context so templates see its globals (CONFIG, buildValidators_, ...);
        // template variables are parameters, so they shadow globals as in Apps Script.
        const names = Object.keys(vars);
        const render = vm.runInContext('(function (__esc' + names.map((n) => ', ' + n).join('') + ') {\n' + compileTemplate(source) + '\n})', context);
        const content = render(escapeHtml, ...names.map((n) => vars[n]));
        const output = {
          content,
          getContent() { return content; },
          setTitle(t) { output.title = t; return output; },
          addMetaTag(n, v) { output.meta = Object.assign({}, output.meta, { [n]: v }); return output; },
          setXFrameOptionsMode(mode) { output.xFrameOptionsMode = mode; return output; },
        };
        return output;
      },
    };
    return template;
  }

  const globals = {
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERROR ' + a.join(' ')) },
    HtmlService: { createTemplateFromFile, XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' } },
    MimeType: { HTML: 'text/html', PDF: 'application/pdf' },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
      }),
    },
    MailApp: {
      sendEmail(...args) { mail.push(args.length === 1 ? args[0] : { to: args[0], subject: args[1], body: args[2] }); },
    },
    Utilities: {
      newBlob: (data, type, name) => new Blob(data, type, name),
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => b & 0xff)).toString('base64'),
      base64Decode: (text) => Array.from(Buffer.from(text, 'base64'), (b) => (b > 127 ? b - 256 : b)),
      formatDate,
    },
    DriveApp: {
      createFolder: (name) => makeFolder(name, null),
      getFolderById(id) {
        const f = files.get(id);
        if (!f || !f.isFolder) throw new Error('No item with the given ID could be found.');
        return f;
      },
      getFileById(id) {
        const f = files.get(id);
        if (!f || f.isFolder) throw new Error('No item with the given ID could be found.');
        return f;
      },
    },
    SpreadsheetApp: {
      create: (name) => makeSpreadsheet(name),
      openById(id) {
        if (!spreadsheets.has(id)) throw new Error('Spreadsheet not found');
        return spreadsheets.get(id);
      },
    },
  };

  context = vm.createContext(globals);
  SCRIPT_FILES.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), context, { filename: file });
  });

  return {
    context,
    props,
    files,
    mail,
    logs,
    /** Evaluates an expression inside the script's global scope (e.g. 'CONFIG'). */
    eval: (code) => vm.runInContext(code, context),
    /** Calls a server function the way google.script.run does: arguments and result go through JSON. */
    call(name, arg) {
      const result = context[name](arg === undefined ? undefined : JSON.parse(JSON.stringify(arg)));
      return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
    },
    sheetRows() {
      return spreadsheets.get(props.SHEET_ID).getSheets()[0].rows;
    },
    filesIn(propertyKey) {
      return Array.from(files.values()).filter((f) => !f.isFolder && f.parentId === props[propertyKey]);
    },
  };
}

// Independent Verhoeff check-digit generator, used to build valid test Aadhaar numbers.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
function withCheckDigit(base) {
  let c = 0;
  base.split('').reverse().forEach((digit, i) => { c = D[c][P[(i + 1) % 8][Number(digit)]]; });
  return base + INV[c];
}

module.exports = { createApp, compileTemplate, withCheckDigit };
