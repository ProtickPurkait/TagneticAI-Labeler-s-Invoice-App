# TagneticAI Client Invoicing

TagneticAI staff fill in a client's details and line items, and get a numbered PDF invoice laid out like
the existing labeler invoices (item rows with units, subtotal, paid and balance). Every invoice is filed in Google Drive and logged in a Google Sheet. It costs nothing to
run: Netlify's free tier plus a Google account.

It is built the same way as the [labeler invoice app](https://tagneticai-invoice-app.netlify.app/) and
the [NDA portal](../nda-app/README.md), which explains the pattern in full: a Netlify page that frames
a Google Apps Script web app running as the owner.

```
Staff member                     Apps Script (runs as you)                Your Google Drive
────────────                     ─────────────────────────                ─────────────────
Fills in client + items  ──►  generateInvoice()                    ──►  TagneticAI Invoices/
(totals update live)             • re-checks every field                  ├─ Invoice 10 - Client.pdf
                                 • numbers it (10, 11, 12 ...)            └─ TagneticAI Invoice Register (Sheet)
                          ◄──    • renders InvoiceTemplate.html → PDF
Downloads PDF (+ optional email to the client)
```

## What it does

- **Layout:** copied from the reference invoice (Invoice 9): logo top right, client on the left and TagneticAI on the right,
  Invoice Date / Due Date / Amount Due / Payment Method, a blue "Invoice N" heading, a striped table of Item, Description,
  Qty (unit underneath), Price and Total, then Subtotal, Total, Paid and Balance.
- **Numbering:** plain 1, 2, 3, no gaps, no yearly restart. `FIRST_NUMBER` in `Config.gs` (10, since the last invoice was 9) sets where it starts.
  The counter advances under a lock, so two people issuing at once never get the same number.
- **Dates** print as `MM/DD/YYYY` like the reference (09/01/2026). Change `DATE_FORMAT` in `Config.gs` for `DD/MM/YYYY`.
  The reference doesn't say which way round it is; check yours reads right.
- **Paid and balance:** enter an amount already paid and the invoice shows the balance due. A fully paid invoice is logged as *Paid*.
- **GST (optional):** the form starts as USD with no GST, like the reference. For Indian clients choose INR and CGST + SGST (client in the
  company's state) or IGST (other state); tax lines are then added under Subtotal. If the client's GSTIN is given, the server refuses a type
  that doesn't match its state, and GSTINs are checked for typos. INR invoices are rounded to the rupee with a "Round off" line.
  There is no HSN/SAC column.
- **Register:** one row per invoice (number, dates, client, amounts, paid, balance, PDF link, Status). Change *Status*
  by hand (for example to *Cancelled*). Columns are found by heading, so you can reorder them or add your own.
- **Access code (optional):** anyone with the link can open the portal, so set `ACCESS_CODE` in `Config.gs`
  to make staff type a code before an invoice can be issued.

## Files

| File | What it is |
|---|---|
| `apps-script/Config.gs` | **Edit this.** Company details and phone, first invoice number, date format, defaults, optional bank details, access code. |
| `apps-script/InvoiceTemplate.html` | The invoice layout. Edit freely and keep the placeholder tags. |
| `apps-script/Invoice.gs` | Field rules, totals arithmetic, number and date formatting. Shared by the page and the server. |
| `apps-script/Code.gs` | Server: `doGet`, `generateInvoice`, `setup`, `previewInvoice`. |
| `apps-script/Index.html` | The staff-facing page (Bootstrap 5). |
| `apps-script/Assets.gs` | The T<GNETIC logo, embedded as image data. |
| `netlify/index.html` | The iframe wrapper. Put your `/exec` URL in it. |
| `tests/` | Tests that run the real `.gs`/`.html` files under Node with stand-ins for Google services. |

## Setup (about 15 minutes)

1. **Create the Apps Script project** at <https://script.google.com> → *New project* → name it *TagneticAI Invoicing*.
   *Project Settings* → tick *Show "appsscript.json" manifest file in editor*. Then create and paste in the files
   from `apps-script/`: `appsscript.json`, `Code.gs`, scripts `Config`, `Assets`, `Invoice`, and HTML files `Index`, `InvoiceTemplate`.
2. **Edit `Config.gs`:** at least `COMPANY_PHONE`, `FIRST_NUMBER` and `ACCESS_CODE`. `BANK_DETAILS` lines with nothing after the colon are skipped,
   so the "Pay to" block only appears once you fill some in. Add `COMPANY_GSTIN` and `COMPANY_PAN` only if you charge GST; without a GSTIN, invoices are issued without tax.
3. **Run `setup`** from the function dropdown and grant the permissions. The log prints links to the *TagneticAI Invoices* folder and register.
4. **Run `previewInvoice`**, open the PDF from the log and adjust the template or config until you like it. Delete the preview afterwards.
5. **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access: Anyone*, and copy the `/exec` URL.
6. **Netlify:** put the URL in `netlify/index.html`, then drag the `netlify` folder onto <https://app.netlify.com/drop>
   (or connect this repo with base and publish directory `invoice-app/netlify`). Rename the site, e.g. `tagneticai-invoicing`.
7. **Test once** end to end, then delete the test row and PDF.

To change things later, edit in the Apps Script editor and use *Deploy → Manage deployments → ✏️ → New version*. The URL stays the same.

## Things to know

- **Invoice numbers can't be reused.** The counter lives in the script's properties. If you delete an invoice, its number stays used.
  Cancel by setting *Status* to *Cancelled* in the register.
- **One GST rate per invoice.** If you bill services at different rates, issue separate invoices.
- **No edits after issue.** To correct an invoice, mark the old one *Cancelled* and issue a new one (credit notes are not built).
- **The `₹` sign** may be missing from the PDF font, so rupee amounts are written as `Rs. 1,000.00`. Dollar amounts use `$`.
- **Client data** (names, addresses, GSTINs) sits in the register. Keep the *TagneticAI Invoices* folder shared with finance only.
  Don't commit a signature image to this repository; it is public. Use `COMPANY_SIGNATURE_FILE_ID` to point at a private Drive file instead.

## Running the tests

Requires Node 18 or newer. No install is needed:

```bash
node --test 'invoice-app/tests/*.test.js'
```
