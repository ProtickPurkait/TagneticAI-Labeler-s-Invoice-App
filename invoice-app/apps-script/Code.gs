/**
 * TagneticAI client invoicing (Google Apps Script web app).
 *
 * Same architecture as the labeler invoice app and the NDA portal:
 *   Netlify page (full-screen <iframe>) -> this web app's /exec URL
 *   -> doGet() serves Index.html
 *   -> the page calls generateInvoice() through google.script.run
 *   -> this script, running as the owner, saves the PDF in Drive and logs a row in a Sheet.
 *
 * One-time setup: run setup() from the editor, then Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone). See invoice-app/README.md.
 */

const REGISTER_COLUMNS = [
  'Issued At', 'Invoice No', 'Invoice Date', 'Due Date', 'Client', 'Client GSTIN', 'Client Address',
  'Currency', 'Subtotal', 'GST', 'Total', 'Invoice PDF', 'Status',
];
const STATUS_ISSUED = 'Issued';

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(CONFIG.COMPANY_NAME + ' Invoicing')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // Lets the Netlify page show this app inside its <iframe>.
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Run once from the editor (select "setup" and press Run). Creates the Drive folder and the
 * invoice register, and remembers their IDs. Safe to run again.
 */
function setup() {
  const root = ensureFolder_('ROOT_FOLDER_ID', CONFIG.COMPANY_NAME + ' Invoices', null);
  const register = ensureRegister_(root);
  const lib = invoiceLib_();
  if (CONFIG.COMPANY_GSTIN && !lib.gstinValid(CONFIG.COMPANY_GSTIN)) {
    console.error('CONFIG.COMPANY_GSTIN "' + CONFIG.COMPANY_GSTIN + '" is not a valid GSTIN. Fix it in Config.gs.');
  }
  console.log('Invoice folder: ' + root.getUrl());
  console.log('Invoice register: ' + register.getUrl());
}

/** Run from the editor to check the invoice layout. Saves a sample PDF and logs its link. */
function previewInvoice() {
  const lib = invoiceLib_();
  const taxed = !!CONFIG.COMPANY_GSTIN;
  const check = lib.validateInvoice({
    clientName: 'Sample Client Pvt Ltd',
    clientAddress: '12 Example Road, Salt Lake, Kolkata, West Bengal 700091',
    invoiceDate: todayIso_(new Date()),
    dueDays: CONFIG.DEFAULT_DUE_DAYS,
    currency: 'INR',
    taxMode: taxed ? 'intra' : 'none',
    gstRate: CONFIG.DEFAULT_GST_RATE,
    notes: 'Sample invoice for checking the layout.',
    items: [
      { description: 'Image annotation (bounding boxes)', quantity: '1500', rate: '2.50', unit: 'images', sac: CONFIG.DEFAULT_SAC },
      { description: 'Quality review', quantity: '12.5', rate: '400', unit: 'hours', sac: CONFIG.DEFAULT_SAC },
    ],
  }, CONFIG.COMPANY_GSTIN);
  if (!check.ok) throw new Error('Preview data was rejected: ' + JSON.stringify(check.errors));
  const pdf = renderInvoicePdf_(check.value, CONFIG.NUMBER_PREFIX + '/PREVIEW');
  const file = folder_('ROOT_FOLDER_ID').createFile(pdf.setName('PREVIEW - ' + pdf.getName()));
  console.log('Preview PDF: ' + file.getUrl());
}

/**
 * Called by the page. Validates the form, numbers the invoice, renders it as a PDF, files it
 * in Drive, logs it in the register and returns the PDF for download.
 */
function generateInvoice(input) {
  if (CONFIG.ACCESS_CODE && String((input && input.accessCode) || '').trim() !== CONFIG.ACCESS_CODE) {
    return { success: false, error: 'Wrong access code.', accessCodeInvalid: true };
  }
  const lib = invoiceLib_();
  const check = lib.validateInvoice(input, CONFIG.COMPANY_GSTIN);
  if (!check.ok) return { success: false, errors: check.errors, itemErrors: check.itemErrors };

  const invoice = check.value;
  const now = new Date();
  const number = nextInvoiceNumber_(invoice.invoiceDate);
  const pdf = renderInvoicePdf_(invoice, number);
  const file = folder_('ROOT_FOLDER_ID').createFile(pdf);
  const totals = lib.computeTotals(invoice.items, invoice.taxMode, invoice.gstRate, invoice.currency);

  appendRegisterRow_({
    'Issued At': formatTimestamp_(now),
    'Invoice No': number,
    'Invoice Date': invoice.invoiceDate,
    'Due Date': lib.addDays(invoice.invoiceDate, invoice.dueDays),
    'Client': invoice.clientName,
    'Client GSTIN': invoice.clientGstin,
    'Client Address': invoice.clientAddress,
    'Currency': invoice.currency,
    'Subtotal': lib.formatMoney(totals.subtotal, invoice.currency),
    'GST': lib.formatMoney(totals.tax, invoice.currency),
    'Total': lib.formatMoney(totals.total, invoice.currency),
    'Invoice PDF': file.getUrl(),
    'Status': STATUS_ISSUED,
  });

  let emailed = false;
  if (input.emailClient && invoice.clientEmail) {
    try {
      MailApp.sendEmail({
        to: invoice.clientEmail,
        name: CONFIG.COMPANY_NAME,
        replyTo: CONFIG.COMPANY_EMAIL || undefined,
        subject: 'Invoice ' + number + ' from ' + CONFIG.COMPANY_NAME,
        body: [
          'Dear ' + invoice.clientName + ',',
          '',
          'Please find attached invoice ' + number + ' for ' + lib.CURRENCIES[invoice.currency].symbol + ' ' +
            lib.formatMoney(totals.total, invoice.currency) + ', due on ' + lib.displayDate(lib.addDays(invoice.invoiceDate, invoice.dueDays)) + '.',
          '',
          'Thank you,',
          CONFIG.COMPANY_LEGAL_NAME,
        ].join('\n'),
        attachments: [pdf],
      });
      emailed = true;
    } catch (err) {
      console.error('Could not email invoice ' + number + ': ' + err);
    }
  }

  return {
    success: true,
    number: number,
    total: lib.formatMoney(totals.total, invoice.currency),
    fileName: pdf.getName(),
    pdfBase64: Utilities.base64Encode(pdf.getBytes()),
    emailed: emailed,
  };
}

// ---------------------------------------------------------------------------------------
// Helpers (names ending in _ cannot be called from the browser).

function renderInvoicePdf_(invoice, number) {
  const lib = invoiceLib_();
  const cur = invoice.currency;
  const totals = lib.computeTotals(invoice.items, invoice.taxMode, invoice.gstRate, cur);
  const money = function (minor) { return lib.formatMoney(minor, cur); };
  const taxed = invoice.taxMode !== 'none';
  const half = invoice.gstRate / 2;

  const template = HtmlService.createTemplateFromFile('InvoiceTemplate');
  template.company = {
    legalName: CONFIG.COMPANY_LEGAL_NAME,
    address: CONFIG.COMPANY_ADDRESS,
    gstin: CONFIG.COMPANY_GSTIN,
    pan: CONFIG.COMPANY_PAN,
    email: CONFIG.COMPANY_EMAIL,
    bank: CONFIG.BANK_DETAILS.filter(function (line) { return line.trim() && !/:$/.test(line.trim()); }),
    terms: CONFIG.TERMS,
    signatureImage: imageDataUri_(companySignatureImage_()),
  };
  template.invoice = invoice;
  template.number = number;
  template.symbol = lib.CURRENCIES[cur].symbol === '₹' ? 'Rs.' : lib.CURRENCIES[cur].symbol;
  template.currency = cur;
  template.dateText = lib.displayDate(invoice.invoiceDate);
  template.dueText = lib.displayDate(lib.addDays(invoice.invoiceDate, invoice.dueDays));
  template.rows = invoice.items.map(function (item, i) {
    return {
      n: i + 1,
      description: item.description,
      sac: item.sac,
      quantity: String(item.quantity) + (item.unit ? ' ' + item.unit : ''),
      rate: money(item.rateMinor),
      amount: money(lib.lineAmount(item.quantity, item.rateMinor)),
    };
  });
  template.hasSac = invoice.items.some(function (item) { return item.sac; });
  template.taxed = taxed;
  template.taxLines = invoice.taxMode === 'intra'
    ? [{ label: 'CGST @ ' + half + '%', amount: money(totals.cgst) }, { label: 'SGST @ ' + half + '%', amount: money(totals.sgst) }]
    : invoice.taxMode === 'inter' ? [{ label: 'IGST @ ' + invoice.gstRate + '%', amount: money(totals.igst) }] : [];
  template.subtotal = money(totals.subtotal);
  template.roundOff = totals.roundOff ? money(totals.roundOff) : '';
  template.total = money(totals.total);
  template.words = lib.amountInWords(totals.total, cur);
  template.assets = { logoBadge: imageDataUri_(ASSETS.logoBadge) };

  const html = template.evaluate().getContent();
  const fileName = number.replace(/\//g, '-') + ' - ' + invoice.clientName.replace(/[^A-Za-z0-9 .-]/g, '') + '.pdf';
  return Utilities.newBlob(html, MimeType.HTML, 'invoice.html').getAs(MimeType.PDF).setName(fileName);
}

// The optional company stamp and signature, as a data URI for the template.
// If the file can't be read, the invoice is still issued, unsigned.
function companySignatureImage_() {
  if (!CONFIG.COMPANY_SIGNATURE_FILE_ID) return '';
  try {
    const blob = DriveApp.getFileById(CONFIG.COMPANY_SIGNATURE_FILE_ID).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (err) {
    console.error('Company signature file ' + CONFIG.COMPANY_SIGNATURE_FILE_ID + ' could not be read; invoice issued unsigned. ' + err);
    return '';
  }
}

// Templates insert images with the raw printing tag, because the escaping tag replaces data: URLs
// with a dummy value. So only well-formed base64 PNG/JPEG data URIs are let through.
function imageDataUri_(value) {
  return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/]+={0,2}$/.test(value || '') ? value : '';
}

// Sequential per financial year: TAI/2026-27/0001. The counter is kept in script properties and
// advanced under a lock, so two people issuing at once never get the same number.
function nextInvoiceNumber_(invoiceDateIso) {
  const fy = invoiceLib_().financialYear(invoiceDateIso);
  const key = 'COUNTER_' + fy;
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const next = Number(props.getProperty(key) || 0) + 1;
    props.setProperty(key, String(next));
    return CONFIG.NUMBER_PREFIX + '/' + fy + '/' + ('000' + next).slice(-Math.max(4, String(next).length));
  } finally {
    lock.releaseLock();
  }
}

function todayIso_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatTimestamp_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

// Columns are found by their heading in row 1, so the register can be rearranged or extended.
function registerHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

function column_(headers, name) {
  const at = headers.indexOf(name);
  if (at < 0) throw new Error('The invoice register has no "' + name + '" column. Put that heading back in row 1.');
  return at + 1;
}

function appendRegisterRow_(record) {
  const sheet = registerSheet_();
  const headers = registerHeaders_(sheet);
  REGISTER_COLUMNS.forEach(function (name) { column_(headers, name); }); // every heading must be present
  const values = headers.map(function (name) {
    const value = record[name] == null ? '' : String(record[name]);
    // Stop text such as "=IMPORTXML(...)" in a client name or address from running as a formula.
    return /^[=+\-@]/.test(value) ? "'" + value : value;
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const row = sheet.getLastRow() + 1;
    // Plain-text format first, so GSTINs and amounts are stored exactly as printed.
    sheet.getRange(row, 1, 1, values.length).setNumberFormat('@').setValues([values]);
  } finally {
    lock.releaseLock();
  }
}

function registerSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Invoicing is not set up yet. The owner must run setup() once.');
  return SpreadsheetApp.openById(id).getSheets()[0];
}

function folder_(propertyKey) {
  const id = PropertiesService.getScriptProperties().getProperty(propertyKey);
  if (!id) throw new Error('Invoicing is not set up yet. The owner must run setup() once.');
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
  const spreadsheet = SpreadsheetApp.create(CONFIG.COMPANY_NAME + ' Invoice Register');
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
