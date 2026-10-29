/**
 * Everything you are likely to change lives here. The invoice layout lives in InvoiceTemplate.html.
 * After editing, redeploy: Deploy > Manage deployments > (pencil) > Version: New version.
 */
const CONFIG = {
  // Short name used on the portal, in emails and for the Drive folder names.
  COMPANY_NAME: 'TagneticAI',

  // The supplier, exactly as printed on invoices.
  COMPANY_LEGAL_NAME: 'TagneticAI LLP',
  COMPANY_ADDRESS: 'F/NO-1 A MAINAK APT, F/N-1A, GROUND FLOOR C/F-10/1, JYANGRA GHOSPARA, KOL-59 NORTH 24 PARGANAS 700059',
  // Fill these in. Leave GSTIN blank if not GST-registered
  // (then every invoice is issued without tax).
  COMPANY_GSTIN: '',
  COMPANY_PAN: '',
  COMPANY_EMAIL: '',

  // Printed under "Pay to" on every invoice. One line per entry; blank entries are skipped.
  BANK_DETAILS: [
    'Account name: TagneticAI LLP',
    'Bank: ',
    'Account number: ',
    'IFSC: ',
    'UPI: ',
  ],

  // Printed at the bottom of every invoice.
  TERMS: [
    'Payment is due by the due date shown above.',
    'Please quote the invoice number with your payment.',
  ],

  // Optional: Drive file ID of a PNG of the company stamp and authorised signature (transparent
  // background). When set, every invoice comes out signed. Keep that file private in Drive.
  COMPANY_SIGNATURE_FILE_ID: '',

  // Invoice numbers look like TAI/2026-27/0001 and restart each financial year (April to March).
  NUMBER_PREFIX: 'TAI',

  // Default HSN/SAC code shown on the form for new line items (can be changed per item).
  DEFAULT_SAC: '',
  // Default GST rate on the form.
  DEFAULT_GST_RATE: 18,
  DEFAULT_DUE_DAYS: 15,

  // Anyone with the portal link can open it, so set a code here to keep strangers from issuing
  // invoices in the company's name. Staff type it on the form. Blank = no code.
  ACCESS_CODE: '',
};
