'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, withCheckDigit } = require('./gas-harness');

const app = createApp();
const V = app.eval('validators_()');
// Results are built inside the script's vm context; make them plain objects for deepEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));
const VALID_AADHAAR = withCheckDigit('23456789012');

test('Verhoeff matches the published example (236 -> check digit 3)', () => {
  assert.equal(withCheckDigit('236'), '2363');
  assert.equal(V.verhoeffValid('2363'), true);
  assert.equal(V.verhoeffValid('2364'), false);
});

test('Aadhaar: accepts valid numbers with spaces or dashes, rejects typos', () => {
  assert.deepEqual(plain(V.rules.aadhaar(VALID_AADHAAR)), { value: VALID_AADHAAR });
  const spaced = VALID_AADHAAR.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
  assert.deepEqual(plain(V.rules.aadhaar(spaced)), { value: VALID_AADHAAR });
  assert.deepEqual(plain(V.rules.aadhaar(spaced.replace(/ /g, '-'))), { value: VALID_AADHAAR });

  // Any single-digit change breaks the checksum.
  for (let i = 0; i < 12; i++) {
    const wrong = VALID_AADHAAR.slice(0, i) + ((Number(VALID_AADHAAR[i]) + 1) % 10) + VALID_AADHAAR.slice(i + 1);
    if (/^[01]/.test(wrong)) continue;
    assert.match(V.rules.aadhaar(wrong).error, /checksum/, 'digit ' + i);
  }
  // Swapping two adjacent digits is caught too.
  const swapped = VALID_AADHAAR[0] + VALID_AADHAAR[2] + VALID_AADHAAR[1] + VALID_AADHAAR.slice(3);
  assert.match(V.rules.aadhaar(swapped).error, /checksum/);

  assert.match(V.rules.aadhaar('12345').error, /12 digits/);
  assert.match(V.rules.aadhaar(withCheckDigit('12345678901')).error, /never start with 0 or 1/);
  assert.match(V.rules.aadhaar('').error, /Enter/);
});

test('Aadhaar masking and formatting', () => {
  assert.equal(V.maskAadhaar('234567890124'), 'XXXX XXXX 0124');
  assert.equal(V.formatAadhaar('234567890124'), '2345 6789 0124');
});

test('PAN: upper-cases, requires the individual (P) holder type', () => {
  assert.deepEqual(plain(V.rules.pan(' abcpe1234f ')), { value: 'ABCPE1234F' });
  assert.match(V.rules.pan('ABCCE1234F').error, /4th character/);
  assert.match(V.rules.pan('ABCP1234F').error, /format/);
  assert.match(V.rules.pan('').error, /Enter/);
});

test('Mobile: strips +91 / 91 / 0 prefixes and separators', () => {
  assert.deepEqual(plain(V.rules.mobile('+91 98765-43210')), { value: '9876543210' });
  assert.deepEqual(plain(V.rules.mobile('09876543210')), { value: '9876543210' });
  assert.deepEqual(plain(V.rules.mobile('919123456789')), { value: '9123456789' });
  assert.deepEqual(plain(V.rules.mobile('9123456789')), { value: '9123456789' });
  assert.match(V.rules.mobile('5123456789').error, /6, 7, 8 or 9/);
  assert.match(V.rules.mobile('98765').error, /10-digit/);
});

test('Name: tidies spaces, rejects digits and symbols', () => {
  assert.deepEqual(plain(V.rules.fullName('  Rahul   Kumar  Das ')), { value: 'Rahul Kumar Das' });
  assert.deepEqual(plain(V.rules.fullName("D'Souza A. Mary-Ann")), { value: "D'Souza A. Mary-Ann" });
  assert.match(V.rules.fullName('R2D2').error, /letters/);
  assert.match(V.rules.fullName('<b>x</b>').error, /letters/);
  assert.match(V.rules.fullName('Al').error, /3–100/);
});

test('Address: needs a 6-digit PIN code', () => {
  assert.deepEqual(plain(V.rules.address('12 Lake Road,\nKolkata 700091')), { value: '12 Lake Road, Kolkata 700091' });
  assert.ok(V.rules.address('Flat 2B, Salt Lake, Kolkata - 700 091').value);
  assert.match(V.rules.address('12 Lake Road, Kolkata, West Bengal').error, /PIN/);
  assert.match(V.rules.address('12 Lake Road 070009 x').error, /PIN/);
  assert.match(V.rules.address('Kolkata').error, /15–300/);
});

test('Email is optional but must be valid when given', () => {
  assert.deepEqual(plain(V.rules.email('')), { value: '' });
  assert.deepEqual(plain(V.rules.email(' Rahul@Example.COM ')), { value: 'rahul@example.com' });
  assert.ok(V.rules.email('rahul@').error);
});

test('validateEmployee reports every bad field at once', () => {
  const result = V.validateEmployee({ fullName: 'Rahul Kumar', aadhaar: '123', pan: 'x' });
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ['aadhaar', 'address', 'mobile', 'pan']);
  assert.equal(V.validateEmployee(null).ok, false);
});

test('the validator source inlined into the page behaves the same', () => {
  const page = app.context.doGet().getContent();
  const match = page.match(/const Validators = ([\s\S]*?);\s*const LIMITS/);
  assert.ok(match, 'inline validators not found in Index.html output');
  // eslint-disable-next-line no-new-func
  const inlined = new Function('return ' + match[1])();
  assert.deepEqual(plain(inlined.rules.aadhaar(VALID_AADHAAR)), { value: VALID_AADHAAR });
  assert.ok(inlined.rules.mobile('12345').error);
  assert.equal(inlined.rules.mlid, undefined);
  assert.deepEqual(plain(inlined.rules.pan('abcpe1234f')), { value: 'ABCPE1234F' });
});
