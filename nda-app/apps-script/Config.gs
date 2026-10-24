/**
 * Everything you are likely to change lives here.
 * After editing, redeploy: Deploy > Manage deployments > (pencil) > Version: New version.
 */
const CONFIG = {
  // Party disclosing the information (printed on the NDA).
  COMPANY_NAME: 'TagneticAI',
  COMPANY_ADDRESS: 'F/NO-1 A MAINAK APT, GROUND FLOOR C/F-10/1, JYANGRA GHOSPARA, KOL- 59 NORTH 24 PARGANAS 700059, WB, India',
  COMPANY_PHONE: '+91 7003411010',

  // Printed under the company's signature line. Leave the name blank to sign by hand.
  COMPANY_SIGNATORY_NAME: '',
  COMPANY_SIGNATORY_TITLE: 'Authorised Signatory',

  // Legal terms used in the template (NdaTemplate.html).
  JURISDICTION_CITY: 'Kolkata',
  CONFIDENTIALITY_YEARS: 3,

  // Reference numbers look like TAI-NDA-261024-7K3QX.
  REF_PREFIX: 'TAI-NDA',

  // UIDAI guidance is to display only the last 4 digits of an Aadhaar number.
  // true  -> NDA and register show "XXXX XXXX 1234"; the full number is never stored.
  // false -> the full 12-digit number is printed and stored.
  MASK_AADHAAR: true,

  // MLID format check (regular expression). Tighten this once you know your exact format,
  // e.g. '^ML[0-9]{5}$' for IDs like ML00042.
  MLID_PATTERN: '^[A-Za-z0-9][A-Za-z0-9/_-]{1,29}$',
  MLID_HINT: 'Your MLID as given by HR (letters, numbers, - _ /).',

  // Optional: who gets an email when a signed copy is uploaded. Blank = no email.
  HR_EMAIL: '',

  // Signed-copy upload limits.
  MAX_UPLOAD_FILES: 6,
  MAX_UPLOAD_MB: 15,
};
