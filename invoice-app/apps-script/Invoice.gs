/**
 * Invoice rules and arithmetic shared by the browser and the server.
 *
 * Code.gs calls this directly. Index.html inlines this same function's source
 * (buildInvoiceLib_.toString()), so the live totals on the form and the PDF always agree.
 * Keep it self-contained: no Apps Script services and no references to CONFIG.
 *
 * Money is handled in minor units (paise / cents) as whole numbers.
 */
function buildInvoiceLib_() {
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CURRENCIES = {
    INR: { symbol: '₹', name: 'Indian Rupees', minor: 'Paise', indian: true },
    USD: { symbol: '$', name: 'US Dollars', minor: 'Cents', indian: false },
  };
  var TAX_MODES = { intra: 'CGST + SGST', inter: 'IGST', none: 'No GST' };
  var GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function clean(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  // GSTIN: 2-digit state code, the holder's PAN, entity number, "Z", and a base-36 check character.
  function gstinValid(gstin) {
    if (!/^(0[1-9]|[1-2][0-9]|3[0-8])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return false;
    var sum = 0;
    for (var i = 0; i < 14; i++) {
      var product = GSTIN_CHARS.indexOf(gstin.charAt(i)) * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(product / 36) + (product % 36);
    }
    return GSTIN_CHARS.charAt((36 - (sum % 36)) % 36) === gstin.charAt(14);
  }

  function parseIsoDate(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '');
    if (!m) return null;
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
    return d;
  }

  function toIso(d) {
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }

  function addDays(iso, days) {
    var d = parseIsoDate(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return toIso(d);
  }

  // "2026-10-29" -> "29 Oct 2026"
  function displayDate(iso) {
    var d = parseIsoDate(iso);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  // Indian financial year, April to March: "2026-10-29" -> "2026-27"
  function financialYear(iso) {
    var d = parseIsoDate(iso);
    var start = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    return start + '-' + ('0' + ((start + 1) % 100)).slice(-2);
  }

  function formatGrouped(whole, indian) {
    var digits = String(whole);
    if (digits.length <= 3) return digits;
    var tail = digits.slice(-3);
    var rest = digits.slice(0, -3);
    return rest.replace(indian ? /\B(?=(\d{2})+(?!\d))/g : /\B(?=(\d{3})+(?!\d))/g, ',') + ',' + tail;
  }

  // 123456 (paise) -> "1,234.56"; no currency symbol (the PDF font may lack the rupee sign).
  function formatMoney(minor, currency) {
    var cur = CURRENCIES[currency] || CURRENCIES.INR;
    var sign = minor < 0 ? '-' : '';
    var abs = Math.abs(minor);
    return sign + formatGrouped(Math.floor(abs / 100), cur.indian) + '.' + ('0' + (abs % 100)).slice(-2);
  }

  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function below1000(n) {
    var parts = [];
    if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + ' Hundred'); n = n % 100; }
    if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); }
    else if (n > 0) { parts.push(ONES[n]); }
    return parts.join(' ');
  }

  function wholeToWords(n, indian) {
    if (n === 0) return 'Zero';
    var units = indian
      ? [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]
      : [[1000000000, 'Billion'], [1000000, 'Million'], [1000, 'Thousand']];
    var parts = [];
    units.forEach(function (u) {
      if (n >= u[0]) { parts.push(wholeToWords(Math.floor(n / u[0]), indian) + ' ' + u[1]); n = n % u[0]; }
    });
    if (n > 0) parts.push(below1000(n));
    return parts.join(' ');
  }

  // 118000 (paise) -> "Indian Rupees One Thousand One Hundred Eighty Only"
  function amountInWords(minor, currency) {
    var cur = CURRENCIES[currency] || CURRENCIES.INR;
    var whole = Math.floor(minor / 100);
    var fraction = minor % 100;
    var text = cur.name + ' ' + wholeToWords(whole, cur.indian);
    if (fraction) text += ' and ' + wholeToWords(fraction, false) + ' ' + cur.minor;
    return text + ' Only';
  }

  function toMinor(text) {
    return Math.round(Number(text) * 100);
  }

  // Line amount = quantity x rate, rounded to the nearest paisa.
  function lineAmount(quantity, rateMinor) {
    return Math.round(quantity * rateMinor);
  }

  // items: [{ quantity, rateMinor }]. taxMode: 'intra' | 'inter' | 'none'. Rupee invoices are rounded
  // to the nearest rupee; the difference is shown as "Round off".
  function computeTotals(items, taxMode, gstRate, currency) {
    var subtotal = 0;
    items.forEach(function (item) { subtotal += lineAmount(item.quantity, item.rateMinor); });
    var tax = taxMode === 'none' ? 0 : Math.round(subtotal * gstRate / 100);
    var cgst = 0, sgst = 0, igst = 0;
    if (taxMode === 'intra') { cgst = Math.floor(tax / 2); sgst = tax - cgst; }
    if (taxMode === 'inter') { igst = tax; }
    var exact = subtotal + tax;
    var total = currency === 'INR' ? Math.round(exact / 100) * 100 : exact;
    return { subtotal: subtotal, cgst: cgst, sgst: sgst, igst: igst, tax: tax, roundOff: total - exact, total: total };
  }

  var rules = {
    clientName: function (v) {
      var s = clean(v);
      if (s.length < 2 || s.length > 100) return { error: 'Enter the client\'s name (2 to 100 characters).' };
      return { value: s };
    },
    clientAddress: function (v) {
      var s = clean(v);
      if (s.length < 10 || s.length > 300) return { error: 'Enter the client\'s address (10 to 300 characters).' };
      return { value: s };
    },
    clientGstin: function (v) {
      var s = String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
      if (!s) return { value: '' };
      if (!gstinValid(s)) return { error: 'That is not a valid GSTIN. Check all 15 characters, or leave it blank.' };
      return { value: s };
    },
    clientEmail: function (v) {
      var s = clean(v);
      if (!s) return { value: '' };
      if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return { error: 'Enter a valid email address, or leave it blank.' };
      return { value: s };
    },
    invoiceDate: function (v) {
      var s = clean(v);
      var d = parseIsoDate(s);
      if (!d || d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2100) return { error: 'Pick a valid invoice date.' };
      return { value: s };
    },
    dueDays: function (v) {
      var s = clean(v);
      if (!/^\d{1,3}$/.test(s) || Number(s) > 180) return { error: 'Enter the number of days to pay (0 to 180).' };
      return { value: Number(s) };
    },
    currency: function (v) {
      return CURRENCIES[v] ? { value: v } : { error: 'Choose a currency.' };
    },
    taxMode: function (v) {
      return TAX_MODES[v] ? { value: v } : { error: 'Choose how GST applies.' };
    },
    gstRate: function (v) {
      var s = clean(v);
      var n = Number(s);
      if (s === '' || isNaN(n) || n < 0 || n > 40 || Math.round(n * 100) !== n * 100) return { error: 'Enter a GST rate between 0 and 40.' };
      return { value: n };
    },
    notes: function (v) {
      var s = String(v == null ? '' : v).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (s.length > 500) return { error: 'Keep notes under 500 characters.' };
      return { value: s };
    },
  };

  function validateItem(item) {
    var errors = {};
    var description = clean(item && item.description);
    if (description.length < 2 || description.length > 200) errors.description = 'Describe the service (2 to 200 characters).';
    var quantityText = clean(item && item.quantity);
    var quantity = Number(quantityText);
    if (quantityText === '' || isNaN(quantity) || quantity <= 0 || quantity > 1000000 || Math.round(quantity * 1000) !== quantity * 1000) {
      errors.quantity = 'Quantity must be above 0, with at most 3 decimals.';
    }
    var rateText = clean(item && item.rate);
    var rate = Number(rateText);
    if (rateText === '' || isNaN(rate) || rate < 0 || rate > 1000000000 || Math.round(rate * 100) !== rate * 100) {
      errors.rate = 'Rate must be 0 or more, with at most 2 decimals.';
    }
    var sac = clean(item && item.sac).toUpperCase();
    if (sac && !/^\d{4,8}$/.test(sac)) errors.sac = 'HSN/SAC is 4 to 8 digits.';
    var unit = clean(item && item.unit);
    if (unit.length > 20) errors.unit = 'Keep the unit short.';
    if (Object.keys(errors).length) return { errors: errors };
    return { value: { description: description, quantity: quantity, rateMinor: toMinor(rateText), sac: sac, unit: unit } };
  }

  /**
   * Checks the whole form. companyGstin (may be '') is used to check that the GST type matches the
   * client's state. Returns { ok: true, value } or { ok: false, errors, itemErrors }.
   */
  function validateInvoice(input, companyGstin) {
    input = input || {};
    var value = {};
    var errors = {};
    Object.keys(rules).forEach(function (field) {
      var result = rules[field](input[field]);
      if (result.error) errors[field] = result.error;
      else value[field] = result.value;
    });

    var itemErrors = [];
    var items = [];
    var rawItems = Array.isArray(input.items) ? input.items : [];
    if (rawItems.length < 1 || rawItems.length > 20) errors.items = 'Add between 1 and 20 line items.';
    else {
      rawItems.forEach(function (raw, i) {
        var result = validateItem(raw);
        if (result.errors) itemErrors[i] = result.errors;
        else items.push(result.value);
      });
      if (itemErrors.length) errors.items = 'Fix the highlighted line items.';
    }
    value.items = items;

    // GST type must agree with where the client is, when both GSTINs are known.
    if (!errors.taxMode && !errors.clientGstin && value.taxMode !== 'none' && value.clientGstin && companyGstin) {
      var sameState = value.clientGstin.slice(0, 2) === companyGstin.slice(0, 2);
      if (sameState && value.taxMode === 'inter') errors.taxMode = 'The client is in the same state: use CGST + SGST.';
      if (!sameState && value.taxMode === 'intra') errors.taxMode = 'The client is in a different state: use IGST.';
    }
    if (!errors.taxMode && value.taxMode !== 'none' && !companyGstin) {
      errors.taxMode = 'The company GSTIN is not set up, so GST cannot be charged.';
    }

    if (Object.keys(errors).length) return { ok: false, errors: errors, itemErrors: itemErrors };
    return { ok: true, value: value };
  }

  return {
    CURRENCIES: CURRENCIES,
    TAX_MODES: TAX_MODES,
    rules: rules,
    validateItem: validateItem,
    validateInvoice: validateInvoice,
    gstinValid: gstinValid,
    parseIsoDate: parseIsoDate,
    addDays: addDays,
    displayDate: displayDate,
    financialYear: financialYear,
    formatMoney: formatMoney,
    amountInWords: amountInWords,
    computeTotals: computeTotals,
    lineAmount: lineAmount,
    toMinor: toMinor,
  };
}

function invoiceLib_() {
  return buildInvoiceLib_();
}
