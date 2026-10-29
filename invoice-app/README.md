# TagneticAI Client Invoicing

TagneticAI staff fill in a client's details and line items, and get a numbered PDF invoice with GST
worked out. Every invoice is filed in Google Drive and logged in a Google Sheet. It costs nothing to
run: Netlify's free tier plus a Google account.

It is built the same way as the [labeler invoice app](https://tagneticai-invoice-app.netlify.app/) and
the [NDA portal](../nda-app/README.md), which explains the pattern in full: a Netlify page that frames
a Google Apps Script web app running as the owner.

```
Staff member                     Apps Script (runs as you)                Your Google Drive
────────────                     ─────────────────────────                ─────────────────
Fills in client + items  ──►  generateInvoice()                    ──►  TagneticAI Invoices/
(totals update live)             • re-checks every field                  ├─ TAI-2026-27-0001 - Client.pdf
                                 • numbers it TAI/2026-27/0001            └─ TagneticAI Invoice Register (Sheet)
                          ◄──    • renders InvoiceTemplate.html → PDF
Downloads PDF (+ optional email to the client)
```

## What it does

- **Numbering:** `TAI/2026-27/0001`, sequential, restarting each Indian financial year (April to March). The
  counter advances under a lock, so two people issuing at once never get the same number.
- **GST:** one rate per invoice, as CGST + SGST (client in the company's state), IGST (other state) or no
  GST (export under LUT, exempt). If the client's GSTIN is given, the server refuses a type that doesn't match its state.
  GSTINs are checked with their check character, so typos are caught.
- **Currency:** INR (rounded to the rupee, with a "Round off" line; amount in lakh/crore words) or USD.
- **Output:** PDF with logo, bill-to, line items, tax lines, amount in words, bank details, terms and an optional signature.
- **Register:** one row per invoice (number, dates, client, GSTIN, amounts, PDF link, Status). Change *Status*
  by hand (for example to *Paid*). Columns are found by heading, so you can reorder them or add your own.
- **Access code (optional):** anyone with the link can open the portal, so set `ACCESS_CODE` in `Config.gs`
  to make staff type a code before an invoice can be issued.

## Files

| File | What it is |
|---|---|
| `apps-script/Config.gs` | **Edit this.** Company details, GSTIN, bank details, terms, numbering prefix, access code. |
| `apps-script/InvoiceTemplate.html` | The invoice layout. Edit freely and keep the placeholder tags. |
| `apps-script/Invoice.gs` | Field rules, GST arithmetic, number formatting, amount in words. Shared by the page and the server. |
| `apps-script/Code.gs` | Server: `doGet`, `generateInvoice`, `setup`, `previewInvoice`. |
| `apps-script/Index.html` | The staff-facing page (Bootstrap 5). |
| `apps-script/Assets.gs` | The T<GNETIC logo, embedded as image data. |
| `netlify/index.html` | The iframe wrapper. Put your `/exec` URL in it. |
| `tests/` | Tests that run the real `.gs`/`.html` files under Node with stand-ins for Google services. |

## Setup (about 15 minutes)

1. **Create the Apps Script project** at <https://script.google.com> → *New project* → name it *TagneticAI Invoicing*.
   *Project Settings* → tick *Show "appsscript.json" manifest file in editor*. Then create and paste in the files
   from `apps-script/`: `appsscript.json`, `Code.gs`, scripts `Config`, `Assets`, `Invoice`, and HTML files `Index`, `InvoiceTemplate`.
2. **Edit `Config.gs`:** at least `COMPANY_GSTIN`, `COMPANY_PAN`, `COMPANY_EMAIL`, `BANK_DETAILS` (lines left empty after the colon are skipped),
   and `ACCESS_CODE`. Without `COMPANY_GSTIN`, invoices are issued without GST.
3. **Run `setup`** from the function dropdown and grant the permissions. The log prints links to the *TagneticAI Invoices* folder and register.
4. **Run `previewInvoice`**, open the PDF from the log and adjust the template or config until you like it. Delete the preview afterwards.
5. **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access: Anyone*, and copy the `/exec` URL.
6. **Netlify:** put the URL in `netlify/index.html`, then drag the `netlify` folder onto <https://app.netlify.com/drop>
   (or connect this repo with base and publish directory `invoice-app/netlify`). Rename the site, e.g. `tagneticai-invoicing`.
7. **Test once** end to end, then delete the test row and PDF.

To change things later, edit in the Apps Script editor and use *Deploy → Manage deployments → ✏️ → New version*. The URL stays the same.

## Things to know

- **Invoice numbers can't be reused.** The counter lives in the script's properties. If you delete an invoice, its number stays used,
  which is what a GST audit trail wants. Cancel by setting *Status* to *Cancelled* in the register.
- **One GST rate per invoice.** If you bill services at different rates, issue separate invoices.
- **No edits after issue.** To correct an invoice, mark the old one *Cancelled* and issue a new one (credit notes are not built).
- **The `₹` sign** may be missing from the PDF font, so the PDF writes amounts without a symbol and names the currency in the column headings.
- **Client data** (names, addresses, GSTINs) sits in the register. Keep the *TagneticAI Invoices* folder shared with finance only.
  Don't commit a signature image to this repository; it is public. Use `COMPANY_SIGNATURE_FILE_ID` to point at a private Drive file instead.

## Running the tests

Requires Node 18 or newer. No install is needed:

```bash
node --test 'invoice-app/tests/*.test.js'
```
