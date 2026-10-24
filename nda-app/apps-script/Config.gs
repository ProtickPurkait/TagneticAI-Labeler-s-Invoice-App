/**
 * Everything you are likely to change lives here. The NDA's wording lives in NdaTemplate.html.
 * After editing, redeploy: Deploy > Manage deployments > (pencil) > Version: New version.
 */
const CONFIG = {
  // Short name used on the portal, in emails and for the Drive folder names.
  COMPANY_NAME: 'TagneticAI',

  // The Disclosing Party, exactly as printed on the NDA.
  COMPANY_LEGAL_NAME: 'TagneticAI LLP',
  COMPANY_ADDRESS: 'F/NO-1 A MAINAK APT, F/N-1A, GROUND FLOOR C/F-10/1, JYANGRA GHOSPARA, KOL-59 NORTH 24 PARGANAS 700059',

  // Optional: Drive file ID of a PNG of the company stamp and authorised signature (transparent
  // background). When set, every NDA comes out already signed by the company, as the Canva NDAs are.
  // Note that anyone with the portal link can then produce a company-signed NDA for any name.
  // Leave blank to sign the company's part by hand when the employee's signed copy comes back.
  COMPANY_SIGNATURE_FILE_ID: '',

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
