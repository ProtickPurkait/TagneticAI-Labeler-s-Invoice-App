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
  COMPANY_PHONE: '',

  // Printed under "Pay to" at the foot of every invoice. One line per entry; entries with nothing
  // after the colon are skipped, so with none filled in the block is left out.
  BANK_DETAILS: [
    'Account name: ',
    'Bank: ',
    'Account number: ',
    'IFSC: ',
    'UPI: ',
  ],

  // Printed at the bottom of every invoice, one line each. Empty = no terms block.
  TERMS: [],

  // Optional: Drive file ID of a PNG of the company stamp and authorised signature (transparent
  // background). When set, every invoice comes out signed. Keep that file private in Drive.
  COMPANY_SIGNATURE_FILE_ID: '',

  // Invoices are numbered 1, 2, 3... with no gaps. FIRST_NUMBER is where the sequence starts, so it
  // can carry on from invoices issued elsewhere (the last one was 9). NUMBER_PREFIX goes in front,
  // e.g. 'TAI-' gives TAI-10. Changing either later does not renumber existing invoices.
  FIRST_NUMBER: 10,
  NUMBER_PREFIX: '',

  // How dates print on the invoice: YYYY, MM, DD, D (day without a zero) and MMM (Sep).
  // 'MM/DD/YYYY' -> 09/01/2026, 'DD/MM/YYYY' -> 01/09/2026, 'D MMM YYYY' -> 1 Sep 2026.
  DATE_FORMAT: 'MM/DD/YYYY',

  // What the form starts with. Currency: 'INR' or 'USD'. GST type: 'none', 'intra' or 'inter'.
  DEFAULT_CURRENCY: 'USD',
  DEFAULT_TAX_MODE: 'none',
  DEFAULT_GST_RATE: 18,
  DEFAULT_DUE_DAYS: 30,
  DEFAULT_PAYMENT_METHOD: 'Wire Transfer',

  // Anyone with the portal link can open it, so set a code here to keep strangers from issuing
  // invoices in the company's name. Staff type it on the form. Blank = no code.
  ACCESS_CODE: '',
};
