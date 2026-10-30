/**
 * Field rules shared by the browser and the server.
 *
 * Code.gs calls this directly. Index.html inlines this same function's source
 * (buildValidators_.toString()), so the form and the server always apply identical
 * rules. Keep it self-contained: no Apps Script services and no references to CONFIG.
 */
function buildValidators_() {
  // Verhoeff checksum tables. The last digit of every Aadhaar number is a Verhoeff check digit.
  var D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  var P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];

  function verhoeffValid(digits) {
    var c = 0;
    var reversed = digits.split('').reverse();
    for (var i = 0; i < reversed.length; i++) {
      c = D[c][P[i % 8][Number(reversed[i])]];
    }
    return c === 0;
  }

  function squash(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  var rules = {
    fullName: function (raw) {
      var v = squash(raw);
      if (!v) return { error: 'Enter your full name.' };
      if (v.length < 3 || v.length > 100) return { error: 'Name must be 3–100 characters.' };
      if (!/^[A-Za-z][A-Za-z .'-]*$/.test(v)) {
        return { error: 'Use English letters only (spaces, . \' - allowed), exactly as on your PAN card.' };
      }
      return { value: v };
    },

    address: function (raw) {
      var v = squash(raw);
      if (!v) return { error: 'Enter your residential address.' };
      if (v.length < 15 || v.length > 300) return { error: 'Address must be 15–300 characters.' };
      if (!/(^|\D)[1-9][0-9]{2} ?[0-9]{3}(\D|$)/.test(v)) return { error: 'Include your 6-digit PIN code in the address.' };
      return { value: v };
    },

    aadhaar: function (raw) {
      var v = String(raw == null ? '' : raw).replace(/[\s-]/g, '');
      if (!v) return { error: 'Enter your 12-digit Aadhaar number.' };
      if (!/^[0-9]{12}$/.test(v)) return { error: 'Aadhaar must be exactly 12 digits.' };
      if (/^[01]/.test(v)) return { error: 'Aadhaar numbers never start with 0 or 1. Please re-check.' };
      if (!verhoeffValid(v)) return { error: 'This is not a valid Aadhaar number (checksum failed). Please re-check each digit.' };
      return { value: v };
    },

    pan: function (raw) {
      var v = String(raw == null ? '' : raw).replace(/\s/g, '').toUpperCase();
      if (!v) return { error: 'Enter your PAN.' };
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)) return { error: 'PAN format is 5 letters, 4 digits, 1 letter (e.g. ABCPE1234F).' };
      if (v.charAt(3) !== 'P') return { error: 'The 4th character of an individual\'s PAN is "P". Please re-check.' };
      return { value: v };
    },

    mobile: function (raw) {
      var v = String(raw == null ? '' : raw).replace(/[\s()-]/g, '').replace(/^(\+?91|0)(?=[0-9]{10}$)/, '');
      if (!v) return { error: 'Enter your mobile number.' };
      if (!/^[6-9][0-9]{9}$/.test(v)) return { error: 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.' };
      return { value: v };
    },

    // The NDA is emailed here, and the employee returns it by replying from this address.
    email: function (raw) {
      var v = String(raw == null ? '' : raw).trim();
      if (!v) return { error: 'Enter your email address. Your NDA is sent there.' };
      if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return { error: 'Enter a valid email address.' };
      return { value: v.toLowerCase() };
    },
  };

  function validateEmployee(input) {
    var value = {};
    var errors = {};
    Object.keys(rules).forEach(function (field) {
      var result = rules[field](input ? input[field] : '');
      if (result.error) errors[field] = result.error;
      else value[field] = result.value;
    });
    return Object.keys(errors).length ? { ok: false, errors: errors } : { ok: true, value: value };
  }

  function maskAadhaar(digits) {
    return 'XXXX XXXX ' + digits.slice(-4);
  }

  function formatAadhaar(digits) {
    return digits.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1 $2 $3');
  }

  return {
    rules: rules,
    validateEmployee: validateEmployee,
    verhoeffValid: verhoeffValid,
    maskAadhaar: maskAadhaar,
    formatAadhaar: formatAadhaar,
  };
}

function validators_() {
  return buildValidators_();
}
