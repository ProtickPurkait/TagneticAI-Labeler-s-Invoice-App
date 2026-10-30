'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, withCheckDigit } = require('./gas-harness');

const AADHAAR = withCheckDigit('23456789012');

function employee(overrides) {
  return Object.assign({
    fullName: 'Rahul Kumar Das',
    address: '12 Lake Road, Salt Lake, Kolkata 700091',
    aadhaar: AADHAAR.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3'),
    pan: 'abcpe1234f',
    mobile: '+91 98765 43210',
    email: '',
    confirmed: true,
  }, overrides);
}

function readyApp() {
  const app = createApp();
  // Start without the company's real signature file (it lives in Drive); tests opt in.
  app.eval("CONFIG.COMPANY_SIGNATURE_FILE_ID = ''");
  app.call('setup');
  return app;
}

function pdfHtml(response) {
  const text = Buffer.from(response.pdfBase64, 'base64').toString('utf8');
  assert.ok(text.startsWith('%PDF'), 'response should carry a PDF');
  return text;
}

function rowFor(app, ref) {
  const header = app.sheetRows()[0];
  const row = app.sheetRows().find((r) => r[header.indexOf('NDA Ref')] === ref);
  return row && Object.fromEntries(header.map((name, i) => [name, row[i]]));
}

function fileArg(bytes, mimeType, name) {
  return { name: name || 'page.pdf', mimeType, base64: Buffer.from(bytes).toString('base64') };
}
const PDF_BYTES = Buffer.from('%PDF-1.7\nsigned scan');
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

test('doGet serves the portal and allows framing by the Netlify page', () => {
  const app = createApp();
  const page = app.context.doGet();
  assert.equal(page.xFrameOptionsMode, 'ALLOWALL');
  assert.equal(page.title, 'TagneticAI NDA Portal');
  assert.match(page.getContent(), /Employee Non-Disclosure Agreement Portal/);
  assert.match(page.getContent(), /<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="TagneticAI" class="brand-logo">/);
  assert.match(page.getContent(), /Only the last 4 digits are printed and stored/);
});

test('setup creates folders and the register once, and is safe to re-run', () => {
  const app = readyApp();
  const first = Object.assign({}, app.props);
  assert.deepEqual(Object.keys(first).sort(), ['GENERATED_FOLDER_ID', 'ROOT_FOLDER_ID', 'SHEET_ID', 'SIGNED_FOLDER_ID']);
  assert.equal(app.sheetRows()[0][1], 'NDA Ref');
  app.call('setup');
  assert.deepEqual(app.props, first);
});

test('server functions explain when setup() has not been run', () => {
  const app = createApp();
  assert.throws(() => app.call('generateNda', employee()), /run setup\(\) once/);
});

test('generateNda rejects bad details field by field, and an unticked confirmation', () => {
  const app = readyApp();
  const bad = app.call('generateNda', employee({ aadhaar: '2345 6789 0123', pan: 'ABCCE1234F' }));
  assert.equal(bad.success, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['aadhaar', 'pan']);

  const unconfirmed = app.call('generateNda', employee({ confirmed: false }));
  assert.equal(unconfirmed.success, false);
  assert.match(unconfirmed.error, /confirm/);
  assert.equal(app.sheetRows().length, 1, 'nothing is logged for rejected requests');
});

test('generateNda builds the PDF, files it, and logs a register row', () => {
  const app = readyApp();
  const res = app.call('generateNda', employee());

  assert.equal(res.success, true);
  assert.match(res.ref, /^TAI-NDA-\d{6}-[2-9A-HJ-NP-Z]{5}$/);
  assert.equal(res.mobile, '9876543210');
  assert.equal(res.fileName, res.ref + ' - NDA - Rahul Kumar Das.pdf');
  assert.equal(res.emailed, false);

  const html = pdfHtml(res);
  assert.match(html, /Rahul Kumar Das/);
  assert.match(html, /ABCPE1234F/);
  assert.match(html, /\+91 9876543210/);
  assert.ok(html.includes('XXXX XXXX ' + AADHAAR.slice(-4)));
  assert.ok(!html.includes(AADHAAR) && !html.includes(AADHAAR.slice(0, 4) + ' ' + AADHAAR.slice(4, 8)), 'full Aadhaar must not appear');
  assert.ok(html.includes(res.ref));
  assert.match(html, /Disclosing Party: TagneticAI LLP/);
  assert.match(html, /Receiving Party: Rahul Kumar Das/);
  assert.match(html, /Mobile: \+91 9876543210/);
  assert.ok(!/MLID/.test(html));
  assert.match(html, /entered into as of [A-Z][a-z]+ \d{1,2}(st|nd|rd|th), \d{4}, by and between/);
  assert.match(html, /exclusive jurisdiction of the courts in Kolkata, West Bengal/);
  assert.match(html, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="TagneticAI">/, 'logo survives template escaping');
  assert.match(html, /background-image: url\('data:image\/png;base64,[A-Za-z0-9+/=]+'\)/, 'watermark survives template escaping');
  assert.ok(!html.includes('zSoyz'));
  assert.ok(!/<img[^>]*alt=""/.test(html), 'no company signature image unless configured');

  const row = rowFor(app, res.ref);
  assert.ok(!('MLID' in row));
  assert.equal(row['Mobile'], '9876543210');
  assert.equal(row['PAN'], 'ABCPE1234F');
  assert.equal(row['Aadhaar'], 'XXXX XXXX ' + AADHAAR.slice(-4));
  assert.equal(row['Status'], 'Awaiting signed copy');
  assert.match(row['NDA PDF'], /^https:\/\/drive\.google\.com\/file\/d\//);

  const generated = app.filesIn('GENERATED_FOLDER_ID');
  assert.equal(generated.length, 1);
  assert.equal(generated[0].name, res.fileName);
});

test('a register made by the earlier version, with an MLID column, keeps working', () => {
  const app = readyApp();
  const rows = app.sheetRows();
  rows[0] = ['Generated At', 'NDA Ref', 'MLID', 'Full Name', 'Mobile', 'Email', 'Address', 'PAN', 'Aadhaar',
    'NDA PDF', 'Status', 'Signed Copy', 'Signed At'];
  const { ref } = app.call('generateNda', employee());
  let row = rowFor(app, ref);
  assert.equal(row['MLID'], '');
  assert.equal(row['Full Name'], 'Rahul Kumar Das');
  assert.equal(row['Mobile'], '9876543210');
  assert.equal(row['Status'], 'Awaiting signed copy');

  assert.equal(app.call('uploadSignedNda', { ref, mobile: '9876543210', files: [fileArg(PDF_BYTES, 'application/pdf')] }).success, true);
  row = rowFor(app, ref);
  assert.equal(row['Status'], 'Signed copy received');
  assert.equal(row['MLID'], '');
});

test('a register with a missing heading fails with a clear message', () => {
  const app = readyApp();
  app.sheetRows()[0] = app.sheetRows()[0].filter((h) => h !== 'Mobile');
  assert.throws(() => app.call('generateNda', employee()), /no "Mobile" column/);
});

test('MASK_AADHAAR = false prints and stores the full number', () => {
  const app = readyApp();
  app.eval('CONFIG.MASK_AADHAAR = false');
  const res = app.call('generateNda', employee());
  const formatted = AADHAAR.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
  assert.ok(pdfHtml(res).includes(formatted));
  assert.equal(rowFor(app, res.ref)['Aadhaar'], formatted);
});

test('user text is HTML-escaped in the NDA and cannot become a sheet formula', () => {
  const app = readyApp();
  const res = app.call('generateNda', employee({ address: '=HYPERLINK("http://x") <b>12</b> Road, Kolkata 700091' }));
  const html = pdfHtml(res);
  assert.ok(html.includes('&lt;b&gt;12&lt;/b&gt;'));
  assert.ok(!html.includes('<b>12</b>'));

  const header = app.sheetRows()[0];
  const raw = app.sheetRows()[1][header.indexOf('Address')];
  assert.ok(raw.startsWith("'="), 'formula-looking text is stored with a leading apostrophe');
});

test('an email copy is sent with the PDF attached when an email is given', () => {
  const app = readyApp();
  const res = app.call('generateNda', employee({ email: 'Rahul@Example.com' }));
  assert.equal(res.emailed, true);
  assert.equal(app.mail.length, 1);
  assert.equal(app.mail[0].to, 'rahul@example.com');
  assert.ok(app.mail[0].subject.includes(res.ref));
  assert.equal(app.mail[0].attachments[0].getName(), res.fileName);
});

test('uploadSignedNda checks the reference number and mobile number pair', () => {
  const app = readyApp();
  const { ref } = app.call('generateNda', employee());
  const files = [fileArg(PDF_BYTES, 'application/pdf')];

  assert.match(app.call('uploadSignedNda', { ref, mobile: '9123456789', files }).error, /No NDA matches/);
  assert.match(app.call('uploadSignedNda', { ref: 'TAI-NDA-000000-AAAAA', mobile: '9876543210', files }).error, /No NDA matches/);
  assert.match(app.call('uploadSignedNda', { ref: '', mobile: '9876543210', files }).error, /reference number/);
  assert.match(app.call('uploadSignedNda', { ref, mobile: '12345', files }).error, /mobile number/);
  assert.match(app.call('uploadSignedNda', { ref, mobile: '9876543210', files: [] }).error, /Attach/);
  assert.equal(app.filesIn('SIGNED_FOLDER_ID').length, 0);
});

test('uploadSignedNda rejects files that are not really PDF/JPG/PNG, and oversize batches', () => {
  const app = readyApp();
  const { ref } = app.call('generateNda', employee());
  const fake = fileArg(Buffer.from('MZ\x90\x00 not a pdf'), 'application/pdf', 'virus.pdf');
  assert.match(app.call('uploadSignedNda', { ref, mobile: '9876543210', files: [fake] }).error, /"virus.pdf" is not a PDF/);
  const gif = fileArg(Buffer.from('GIF89a'), 'image/gif', 'x.gif');
  assert.match(app.call('uploadSignedNda', { ref, mobile: '9876543210', files: [gif] }).error, /not a PDF, JPG or PNG/);

  const seven = Array.from({ length: 7 }, () => fileArg(PDF_BYTES, 'application/pdf'));
  assert.match(app.call('uploadSignedNda', { ref, mobile: '9876543210', files: seven }).error, /at most 6 files/);

  app.eval('CONFIG.MAX_UPLOAD_MB = 0.00001');
  assert.match(app.call('uploadSignedNda', { ref, mobile: '9876543210', files: [fileArg(PDF_BYTES, 'application/pdf')] }).error, /larger than/);
  assert.equal(app.filesIn('SIGNED_FOLDER_ID').length, 0);
});

test('uploadSignedNda stores the pages, updates the register, and keeps re-uploads', () => {
  const app = readyApp();
  const { ref } = app.call('generateNda', employee());

  const first = app.call('uploadSignedNda', {
    ref: ref.toLowerCase(), // typed in lower case
    mobile: '+91 98765-43210', // typed differently from the form
    files: [fileArg(JPEG_BYTES, 'image/jpeg', 'p1.jpg'), fileArg(JPEG_BYTES, 'image/jpeg', 'p2.jpg')],
  });
  assert.deepEqual(first, { success: true, ref, count: 2 });

  let row = rowFor(app, ref);
  assert.equal(row['Status'], 'Signed copy received');
  assert.equal(row['Signed Copy'].split('\n').length, 2);
  assert.match(row['Signed At'], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const signed = app.filesIn('SIGNED_FOLDER_ID');
  assert.equal(signed.length, 2);
  signed.forEach((f) => assert.match(f.name, new RegExp('^' + ref + '_signed_\\d{8}-\\d{6}_[12]\\.jpg$')));

  app.call('uploadSignedNda', { ref, mobile: '9876543210', files: [fileArg(PDF_BYTES, 'application/pdf')] });
  row = rowFor(app, ref);
  assert.equal(row['Signed Copy'].split('\n').length, 3);
  assert.equal(app.filesIn('SIGNED_FOLDER_ID').length, 3);
  assert.equal(app.mail.length, 0, 'no HR email unless HR_EMAIL is set');
});

test('HR gets the signed copy as the employee\'s reply: their name, Reply-To them, pages attached', () => {
  const app = readyApp();
  app.eval("CONFIG.HR_EMAIL = 'hr@tagneticai.com'");
  const { ref } = app.call('generateNda', employee({ email: 'Rahul@Example.com' }));
  app.mail.length = 0; // ignore the employee's own copy
  app.call('uploadSignedNda', {
    ref, mobile: '9876543210',
    files: [fileArg(JPEG_BYTES, 'image/jpeg', 'p1.jpg'), fileArg(PDF_BYTES, 'application/pdf', 'p2.pdf')],
  });

  assert.equal(app.mail.length, 1);
  const mail = app.mail[0];
  assert.equal(mail.to, 'hr@tagneticai.com');
  assert.equal(mail.subject, 'Re: Your TagneticAI NDA (' + ref + ')');
  assert.equal(mail.name, 'Rahul Kumar Das (via NDA portal)');
  assert.equal(mail.replyTo, 'rahul@example.com');
  assert.deepEqual(Array.from(mail.attachments, (b) => b.getContentType()), ['image/jpeg', 'application/pdf']);
  assert.match(mail.body, /Mobile No: \+91 9876543210/);
  assert.match(mail.body, /Email Id: rahul@example\.com/);
  assert.match(mail.body, /Reply to this email to write to Rahul Kumar Das/);
});

test('without an employee email, HR still gets the pages, and replies come back to HR', () => {
  const app = readyApp();
  app.eval("CONFIG.HR_EMAIL = 'hr@tagneticai.com'");
  const { ref } = app.call('generateNda', employee());
  app.call('uploadSignedNda', { ref, mobile: '9876543210', files: [fileArg(PDF_BYTES, 'application/pdf')] });
  const mail = app.mail[0];
  assert.equal(mail.replyTo, undefined);
  assert.equal(mail.attachments.length, 1);
  assert.match(mail.body, /Email Id: not given/);
});

test('very large uploads are linked rather than attached, so the HR email still sends', () => {
  const app = readyApp();
  app.eval("CONFIG.HR_EMAIL = 'hr@tagneticai.com'; CONFIG.MAX_UPLOAD_MB = 40");
  const { ref } = app.call('generateNda', employee());
  const big = Buffer.concat([PDF_BYTES, Buffer.alloc(21 * 1024 * 1024)]);
  assert.equal(app.call('uploadSignedNda', { ref, mobile: '9876543210', files: [fileArg(big, 'application/pdf')] }).success, true);
  const mail = app.mail[0];
  assert.equal(mail.attachments, undefined);
  assert.match(mail.body, /Saved in Drive:\nhttps:\/\/drive\.google\.com/);
});

test('the NDA date uses the "June 17th, 2026" style', () => {
  const app = createApp();
  const at = (day) => new Date(Date.UTC(2026, 5, day, 6, 30)); // 12:00 in Kolkata
  const expected = {
    1: 'June 1st, 2026', 2: 'June 2nd, 2026', 3: 'June 3rd, 2026', 4: 'June 4th, 2026',
    11: 'June 11th, 2026', 12: 'June 12th, 2026', 13: 'June 13th, 2026', 17: 'June 17th, 2026',
    21: 'June 21st, 2026', 22: 'June 22nd, 2026', 23: 'June 23rd, 2026', 30: 'June 30th, 2026',
  };
  Object.keys(expected).forEach((day) => assert.equal(app.context.longDate_(at(Number(day))), expected[day]));
  // Uses India time: 20:00 UTC on June 16 is already June 17 in Kolkata.
  assert.equal(app.context.longDate_(new Date(Date.UTC(2026, 5, 16, 20, 0))), 'June 17th, 2026');
});

test('a configured company stamp and signature is printed on every NDA', () => {
  const app = readyApp();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const id = app.addFile('stamp.png', png, 'image/png');
  app.eval('CONFIG.COMPANY_SIGNATURE_FILE_ID = ' + JSON.stringify(id));
  const html = pdfHtml(app.call('generateNda', employee()));
  assert.ok(html.includes('<img src="data:image/png;base64,' + png.toString('base64') + '" alt="">'));
});

test('only real PNG/JPEG data is ever printed raw into an image tag', () => {
  const app = readyApp();
  assert.equal(app.context.imageDataUri_('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(app.context.imageDataUri_('data:image/jpeg;base64,/9j/4AAQ'), 'data:image/jpeg;base64,/9j/4AAQ');
  assert.equal(app.context.imageDataUri_('data:image/png;base64,AAAA" onerror="alert(1)'), '');
  assert.equal(app.context.imageDataUri_('data:text/html;base64,PHNjcmlwdD4='), '');
  assert.equal(app.context.imageDataUri_('javascript:alert(1)'), '');
  assert.equal(app.context.imageDataUri_(''), '');

  // A signature file that isn't an image is left out rather than inserted.
  const id = app.addFile('notes.html', Buffer.from('<script>alert(1)</script>'), 'text/html');
  app.eval('CONFIG.COMPANY_SIGNATURE_FILE_ID = ' + JSON.stringify(id));
  const html = pdfHtml(app.call('generateNda', employee()));
  assert.ok(!/<img[^>]*alt=""/.test(html));
  assert.ok(!html.includes('<script>'));
});

test('an unreadable signature file still issues the NDA, unsigned, and logs why', () => {
  const app = readyApp();
  app.eval("CONFIG.COMPANY_SIGNATURE_FILE_ID = 'deleted-file-id'");
  const res = app.call('generateNda', employee());
  assert.equal(res.success, true);
  assert.ok(!/<img[^>]*alt=""/.test(pdfHtml(res)));
  assert.ok(app.logs.some((line) => line.startsWith('ERROR') && line.includes('deleted-file-id')));
});

test('previewNda saves a sample PDF without touching the register', () => {
  const app = readyApp();
  app.call('previewNda');
  const generated = app.filesIn('GENERATED_FOLDER_ID');
  assert.equal(generated.length, 1);
  assert.match(generated[0].name, /^PREVIEW - TAI-NDA-PREVIEW - NDA - Sample Employee\.pdf$/);
  assert.equal(app.sheetRows().length, 1);
});
