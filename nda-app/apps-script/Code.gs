/**
 * TagneticAI employee NDA portal (Google Apps Script web app).
 *
 * Same architecture as the labeler invoice app:
 *   Netlify page (full-screen <iframe>) -> this web app's /exec URL
 *   -> doGet() serves Index.html
 *   -> the page calls generateNda() / uploadSignedNda() through google.script.run
 *   -> this script, running as the owner, saves PDFs in Drive and logs rows in a Sheet.
 *
 * One-time setup: run setup() from the editor, then Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone). See nda-app/README.md.
 */

const REGISTER_COLUMNS = [
  'Generated At', 'NDA Ref', 'MLID', 'Full Name', 'Mobile', 'Email', 'Address', 'PAN', 'Aadhaar',
  'NDA PDF', 'Status', 'Signed Copy', 'Signed At',
];
const STATUS_AWAITING = 'Awaiting signed copy';
const STATUS_RECEIVED = 'Signed copy received';

// Accepted signed-copy formats, checked against the file's first bytes, not just its declared type.
const UPLOAD_TYPES = {
  'application/pdf': { ext: 'pdf', magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(CONFIG.COMPANY_NAME + ' NDA Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // Lets the Netlify page show this app inside its <iframe>.
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Run once from the editor (select "setup" and press Run). Creates the Drive folders and
 * the register spreadsheet, and remembers their IDs. Safe to run again.
 */
function setup() {
  const root = ensureFolder_('ROOT_FOLDER_ID', CONFIG.COMPANY_NAME + ' NDAs', null);
  ensureFolder_('GENERATED_FOLDER_ID', 'Generated NDAs', root);
  ensureFolder_('SIGNED_FOLDER_ID', 'Signed NDAs', root);
  const register = ensureRegister_(root);
  console.log('NDA folder: ' + root.getUrl());
  console.log('NDA register: ' + register.getUrl());
}

/** Run from the editor to check the NDA layout. Saves a sample PDF and logs its link. */
function previewNda() {
  const sample = {
    fullName: 'Sample Employee',
    address: '12 Example Road, Salt Lake, Kolkata, West Bengal 700091',
    pan: 'ABCPE1234F',
    mobile: '9800000000',
    mlid: 'ML-SAMPLE',
    email: '',
  };
  const pdf = renderNdaPdf_(sample, 'XXXX XXXX 0000', CONFIG.REF_PREFIX + '-PREVIEW', new Date());
  const file = folder_('GENERATED_FOLDER_ID').createFile(pdf.setName('PREVIEW - ' + pdf.getName()));
  console.log('Preview PDF: ' + file.getUrl());
}

/**
 * Called by the page. Validates the employee's details, renders their NDA as a PDF,
 * files it in Drive, logs it in the register and returns the PDF for download.
 */
function generateNda(input) {
  const validators = validators_();
  const check = validators.validateEmployee(input);
  if (!check.ok) return { success: false, errors: check.errors };
  if (!input.confirmed) return { success: false, error: 'Please confirm that your details are correct.' };

  const employee = check.value;
  const now = new Date();
  const ref = newRef_(now);
  const aadhaarShown = CONFIG.MASK_AADHAAR
    ? validators.maskAadhaar(employee.aadhaar)
    : validators.formatAadhaar(employee.aadhaar);

  const pdf = renderNdaPdf_(employee, aadhaarShown, ref, now);
  const file = folder_('GENERATED_FOLDER_ID').createFile(pdf);

  appendRegisterRow_({
    'Generated At': formatTimestamp_(now),
    'NDA Ref': ref,
    'MLID': employee.mlid,
    'Full Name': employee.fullName,
    'Mobile': employee.mobile,
    'Email': employee.email,
    'Address': employee.address,
    'PAN': employee.pan,
    'Aadhaar': aadhaarShown,
    'NDA PDF': file.getUrl(),
    'Status': STATUS_AWAITING,
  });

  let emailed = false;
  if (employee.email) {
    try {
      MailApp.sendEmail({
        to: employee.email,
        name: CONFIG.COMPANY_NAME,
        subject: 'Your ' + CONFIG.COMPANY_NAME + ' NDA (' + ref + ')',
        body: [
          'Hi ' + employee.fullName + ',',
          '',
          'Your Non-Disclosure Agreement is attached. Reference number: ' + ref,
          '',
          '1. Print all pages and read the agreement fully.',
          '2. Sign under "Receiving Party" on the last page and initial the bottom of every page, in blue or black ink.',
          '3. Scan or photograph every page clearly.',
          '4. Upload the signed pages on the NDA portal using your reference number and MLID.',
          '',
          CONFIG.COMPANY_NAME,
        ].join('\n'),
        attachments: [pdf],
      });
      emailed = true;
    } catch (err) {
      console.error('Could not email NDA ' + ref + ': ' + err);
    }
  }

  return {
    success: true,
    ref: ref,
    mlid: employee.mlid,
    fileName: pdf.getName(),
    pdfBase64: Utilities.base64Encode(pdf.getBytes()),
    emailed: emailed,
  };
}

/**
 * Called by the page with { ref, mlid, files: [{ name, mimeType, base64 }] }.
 * Stores the scanned, hand-signed pages and marks the NDA as returned.
 */
function uploadSignedNda(input) {
  const ref = String((input && input.ref) || '').trim().toUpperCase();
  const mlid = String((input && input.mlid) || '').trim();
  const files = (input && input.files) || [];

  if (!ref || !mlid) return { success: false, error: 'Enter your NDA reference number and MLID.' };
  if (!files.length) return { success: false, error: 'Attach the scanned or photographed signed pages.' };
  if (files.length > CONFIG.MAX_UPLOAD_FILES) {
    return { success: false, error: 'Attach at most ' + CONFIG.MAX_UPLOAD_FILES + ' files. Combine pages into one PDF if you have more.' };
  }

  const sheet = registerSheet_();
  const row = findRegisterRow_(sheet, ref);
  const registeredMlid = row ? String(sheet.getRange(row, column_('MLID')).getValue()).trim() : '';
  if (!row || registeredMlid.toLowerCase() !== mlid.toLowerCase()) {
    return { success: false, error: 'No NDA matches that reference number and MLID. Check both and try again.' };
  }

  const now = new Date();
  const stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  let totalBytes = 0;
  const blobs = [];
  for (let i = 0; i < files.length; i++) {
    const type = UPLOAD_TYPES[files[i].mimeType];
    const bytes = Utilities.base64Decode(String(files[i].base64 || ''));
    if (!type || !startsWith_(bytes, type.magic)) {
      return { success: false, error: '"' + files[i].name + '" is not a PDF, JPG or PNG file.' };
    }
    totalBytes += bytes.length;
    blobs.push(Utilities.newBlob(bytes, files[i].mimeType, ref + '_signed_' + stamp + '_' + (i + 1) + '.' + type.ext));
  }
  if (totalBytes > CONFIG.MAX_UPLOAD_MB * 1024 * 1024) {
    return { success: false, error: 'Files are larger than ' + CONFIG.MAX_UPLOAD_MB + ' MB in total. Use a lower scan resolution.' };
  }

  const folder = folder_('SIGNED_FOLDER_ID');
  const urls = blobs.map(function (blob) { return folder.createFile(blob).getUrl(); });

  // Re-uploads (e.g. a missed page) are kept alongside earlier ones.
  const signedCell = sheet.getRange(row, column_('Signed Copy'));
  const earlier = String(signedCell.getValue() || '');
  signedCell.setValue((earlier ? earlier + '\n' : '') + urls.join('\n'));
  sheet.getRange(row, column_('Status')).setValue(STATUS_RECEIVED);
  sheet.getRange(row, column_('Signed At')).setValue(formatTimestamp_(now));

  if (CONFIG.HR_EMAIL) {
    const name = sheet.getRange(row, column_('Full Name')).getValue();
    try {
      MailApp.sendEmail(
        CONFIG.HR_EMAIL,
        'Signed NDA received: ' + name + ' (' + ref + ')',
        [
          name + ' (MLID ' + registeredMlid + ') uploaded ' + urls.length + ' file(s) for NDA ' + ref + '.',
          '',
          'Signed copies:',
          urls.join('\n'),
          '',
          'Register: ' + sheet.getParent().getUrl(),
        ].join('\n')
      );
    } catch (err) {
      console.error('Could not notify HR about ' + ref + ': ' + err);
    }
  }

  return { success: true, ref: ref, count: urls.length };
}

// ---------------------------------------------------------------------------------------
// Helpers (names ending in _ cannot be called from the browser).

function renderNdaPdf_(employee, aadhaarShown, ref, date) {
  const template = HtmlService.createTemplateFromFile('NdaTemplate');
  template.company = {
    legalName: CONFIG.COMPANY_LEGAL_NAME,
    address: CONFIG.COMPANY_ADDRESS,
    signatureImage: companySignatureImage_(),
  };
  template.employee = employee;
  template.aadhaarShown = aadhaarShown;
  template.ref = ref;
  template.dateText = longDate_(date);
  template.assets = ASSETS;

  const html = template.evaluate().getContent();
  const fileName = ref + ' - NDA - ' + employee.fullName.replace(/[^A-Za-z0-9 .-]/g, '') + '.pdf';
  return Utilities.newBlob(html, MimeType.HTML, 'nda.html').getAs(MimeType.PDF).setName(fileName);
}

// The optional pre-applied company stamp and signature, as a data URI for the template.
function companySignatureImage_() {
  if (!CONFIG.COMPANY_SIGNATURE_FILE_ID) return '';
  const blob = DriveApp.getFileById(CONFIG.COMPANY_SIGNATURE_FILE_ID).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

// "June 17th, 2026", the date style used in the company's NDA.
function longDate_(date) {
  const tz = Session.getScriptTimeZone();
  const day = Number(Utilities.formatDate(date, tz, 'd'));
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][day % 10] || 'th';
  return Utilities.formatDate(date, tz, 'MMMM') + ' ' + day + suffix + ', ' + Utilities.formatDate(date, tz, 'yyyy');
}

function newRef_(date) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O or 1/I look-alikes
  let suffix = '';
  for (let i = 0; i < 5; i++) suffix += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return CONFIG.REF_PREFIX + '-' + Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyMMdd') + '-' + suffix;
}

function formatTimestamp_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function startsWith_(bytes, magic) {
  return magic.every(function (b, i) { return (bytes[i] & 0xff) === b; });
}

function column_(name) {
  return REGISTER_COLUMNS.indexOf(name) + 1;
}

function appendRegisterRow_(record) {
  const values = REGISTER_COLUMNS.map(function (name) {
    const value = record[name] == null ? '' : String(record[name]);
    // Stop text such as "=IMPORTXML(...)" in an address from running as a formula.
    return /^[=+\-@]/.test(value) ? "'" + value : value;
  });
  const sheet = registerSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const row = sheet.getLastRow() + 1;
    // Plain-text format first, so mobile, Aadhaar and PAN are never turned into numbers.
    sheet.getRange(row, 1, 1, values.length).setNumberFormat('@').setValues([values]);
  } finally {
    lock.releaseLock();
  }
}

function findRegisterRow_(sheet, ref) {
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return 0;
  const match = sheet.getRange(2, column_('NDA Ref'), rows, 1)
    .createTextFinder(ref)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function registerSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('The NDA portal is not set up yet. The owner must run setup() once.');
  return SpreadsheetApp.openById(id).getSheets()[0];
}

function folder_(propertyKey) {
  const id = PropertiesService.getScriptProperties().getProperty(propertyKey);
  if (!id) throw new Error('The NDA portal is not set up yet. The owner must run setup() once.');
  return DriveApp.getFolderById(id);
}

function ensureFolder_(propertyKey, name, parent) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(propertyKey);
  if (id) {
    try {
      const existing = DriveApp.getFolderById(id);
      if (!existing.isTrashed()) return existing;
    } catch (err) {
      // Deleted or no longer accessible: create a new one below.
    }
  }
  const folder = parent ? parent.createFolder(name) : DriveApp.createFolder(name);
  props.setProperty(propertyKey, folder.getId());
  return folder;
}

function ensureRegister_(folder) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) {
    try {
      if (!DriveApp.getFileById(id).isTrashed()) return SpreadsheetApp.openById(id);
    } catch (err) {
      // Deleted or no longer accessible: create a new one below.
    }
  }
  const spreadsheet = SpreadsheetApp.create(CONFIG.COMPANY_NAME + ' NDA Register');
  DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);
  const sheet = spreadsheet.getSheets()[0];
  sheet.setName('Register');
  sheet.getRange(1, 1, 1, REGISTER_COLUMNS.length).setValues([REGISTER_COLUMNS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  props.setProperty('SHEET_ID', spreadsheet.getId());
  return spreadsheet;
}

// Serialises a value for use inside a <script> block in Index.html.
function jsonForScript_(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
