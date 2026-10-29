# TagneticAI Labeler Tools

| Folder | What it is |
|---|---|
| [`invoice-app/`](invoice-app/README.md) | Client invoicing. TagneticAI staff enter a client and line items, and get a numbered PDF invoice with GST, filed in Drive and logged in a Sheet. |
| [`nda-app/`](nda-app/README.md) | Employee NDA portal. New employees enter their name, address, Aadhaar, PAN and mobile number, download a filled-in NDA, sign it by hand, and upload the signed pages. |

Both are built the same way as the [labeler invoice app](https://tagneticai-invoice-app.netlify.app/):
a Netlify page that frames a Google Apps Script web app, which saves PDFs to Drive and logs rows in a
Google Sheet. [`nda-app/README.md`](nda-app/README.md) explains how that pattern works and how to
set up the NDA portal.
