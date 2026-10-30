# TagneticAI Employee NDA Portal

New employees open one link, type in their details, download a ready-to-sign NDA, sign it by hand,
and upload the signed pages. HR gets every NDA and signed copy filed in Google Drive and logged in
a Google Sheet. It costs nothing to run: Netlify's free tier plus a Google account.

It uses the same technique as the
[labeler invoice app](https://tagneticai-invoice-app.netlify.app/), described below.

---

## How the invoice app works

Opening `tagneticai-invoice-app.netlify.app` and following what it loads shows four layers:

```
Browser
 └─ tagneticai-invoice-app.netlify.app            static index.html (~1 KB): a single full-screen <iframe>
     └─ script.google.com/macros/s/<id>/exec      Google Apps Script web app
         ├─ doGet()             serves the Bootstrap form (HtmlService)
         ├─ submitInvoice(data) the form calls this with google.script.run
         └─ createInvoicePDF()  builds the PDF; Drive / Sheets / Gmail calls run as the owner
```

1. **Netlify is only a wrapper.** `index.html` has no logic: one `<iframe>` sized to `100vw × 100vh`,
   pointing at the Apps Script `/exec` URL. Netlify provides the short, friendly link.
2. **Apps Script is the whole app.** `doGet()` returns an HTML page. The page posts the form to the
   server functions with `google.script.run.withSuccessHandler(...).submitInvoice(payload)`. The function
   names are visible in the page's bootstrap data: `doGet`, `submitInvoice`, `createInvoicePDF`.
3. **It runs as the owner.** The deployment is *Execute as: Me*, *Who has access: Anyone*, so anonymous
   visitors can use it. Every file, sheet row and email is created with the owner's Google account.
4. **Framing is allowed explicitly.** Apps Script pages refuse to load inside another site's iframe unless
   `doGet()` calls `.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)`. The inner sandbox
   also has `allow-downloads`, so the page can hand the browser a file directly.

Only the browser side can be seen from outside. The server code is private to the script owner, so the
NDA server code in this folder was written from scratch to fit that pattern.

---

## How the NDA app works

```
Employee                         Apps Script (runs as you)                Your Google Drive
────────                         ─────────────────────────                ─────────────────
1. Fills in details      ──►  generateNda()                         ──►  TagneticAI NDAs/
   (checked as they type)        • re-checks every field                  ├─ Generated NDAs/  (PDF per employee)
                                 • fills NdaTemplate.html → PDF           ├─ Signed NDAs/     (uploaded scans)
                          ◄──    • logs a row in the register             └─ TagneticAI NDA Register (Sheet)
2. Downloads PDF (+ optional email copy)
   Prints, signs, initials every page
3. Uploads scan/photos   ──►  uploadSignedNda()                    ──►  Signed NDAs/ + register row → "Signed copy received"
   with reference no. + mobile   • ref + mobile must match a register row (optional email to HR)
```

### What is checked

| Field | Rule |
|---|---|
| Full name | English letters, spaces, `.` `'` `-`; 3–100 characters. Extra spaces are removed. |
| Address | 15–300 characters and must include a 6-digit PIN code. |
| Aadhaar | 12 digits, cannot start with 0 or 1, and must pass the **Verhoeff checksum** that UIDAI uses, so almost every single-digit typo or swapped pair is caught. |
| PAN | `AAAAA9999A` format, upper-cased, 4th letter must be `P` (individual). |
| Mobile | 10 digits starting 6–9. `+91`, `91`, `0`, spaces and dashes are stripped. |
| Email | Optional. If given, the NDA is emailed to the employee as well. |

The same rules run in the browser, for instant feedback, and on the server, so they can't be bypassed.
They are written once, in `Validation.gs`, and `Index.html` inlines that function's source when the
page is served.

### Files

| File | What it is |
|---|---|
| `apps-script/Config.gs` | **Edit this.** Company name and address, optional pre-applied stamp/signature, HR email, Aadhaar masking. |
| `apps-script/NdaTemplate.html` | **The NDA.** Your Canva NDA's wording and layout, with the employee's details filled in. Edit the text freely and keep the placeholder tags. |
| `apps-script/Assets.gs` | The T<GNETIC logo badge and watermark from the Canva NDA, embedded as image data. |
| `apps-script/Code.gs` | Server: `doGet`, `generateNda`, `uploadSignedNda`, `setup`, `previewNda`. |
| `apps-script/Validation.gs` | Field rules shared by the page and the server. |
| `apps-script/Index.html` | The employee-facing page (Bootstrap 5, same look as the invoice app). |
| `apps-script/appsscript.json` | Manifest: V8 runtime, Asia/Kolkata time zone, web-app access settings. |
| `netlify/index.html` | The iframe wrapper. Put your `/exec` URL in it. |
| `tests/` | Tests that run the real `.gs`/`.html` files under Node with stand-ins for Google services. |

---

## Setup (about 15 minutes)

Use the Google account that should own the NDAs. A Google Workspace account (e.g. `hr@tagneticai.com`)
is best: the files stay in company Drive, and it can send 1,500 emails a day instead of 100.

### 1. Create the Apps Script project
1. Go to <https://script.google.com> → **New project**. Rename it to *TagneticAI NDA Portal*.
2. **Project Settings** (gear icon) → tick **Show "appsscript.json" manifest file in editor**.
3. Back in **Editor**, create these files and paste in the contents from `apps-script/`:
   - `appsscript.json`: replace its contents.
   - `Code.gs`: replace the default contents.
   - **+ → Script** three times, naming them `Config`, `Assets` and `Validation`. The editor adds `.gs` itself.
   - **+ → HTML**, name it `Index`, then **+ → HTML**, name it `NdaTemplate`. The editor adds `.html` itself.
4. Edit `Config.gs`: `HR_EMAIL`, and optionally `COMPANY_SIGNATURE_FILE_ID` (see [Company signature](#company-signature)). Then save (Ctrl/Cmd + S).

### 2. Create the Drive folders and register
1. In the function dropdown at the top, pick **`setup`** → **Run**.
2. Google asks for permission. Click **Review permissions**, choose the account, then **Advanced → Go to
   TagneticAI NDA Portal (unsafe)** → **Allow**. The "unsafe" warning appears for any script you write
   yourself that Google hasn't reviewed.
3. The **Execution log** prints links to the new *TagneticAI NDAs* folder and *NDA Register* sheet.

### 3. Check the document
Pick **`previewNda`** → **Run**, then open the PDF link from the log. Adjust `NdaTemplate.html` or
`Config.gs` and run it again until you're happy. Delete the preview PDFs afterwards.

Google's HTML-to-PDF converter handles less styling than a web browser. The layout is built so that if
it drops the decorative extras (the pink side bar and the faint logo watermark), the text, tables, logo
badge and signature boxes still come out right.

### 4. Deploy the web app
1. **Deploy → New deployment** → gear icon → **Web app**.
2. *Execute as*: **Me**. *Who has access*: **Anyone**. "Anyone" is needed for the Netlify iframe to work
   for people who aren't signed in to Google.
3. **Deploy** → copy the **Web app URL** (ends in `/exec`).

### 5. Put it on Netlify
1. Open `netlify/index.html` and replace `https://script.google.com/macros/s/PASTE_YOUR_DEPLOYMENT_ID_HERE/exec`
   with your URL.
2. Either drag the `netlify` folder onto <https://app.netlify.com/drop>, **or** connect this GitHub repo in
   Netlify with *Base directory* `nda-app/netlify`, no build command, *Publish directory* `nda-app/netlify`.
3. **Site configuration → Change site name**, e.g. `tagneticai-nda-portal` → `https://tagneticai-nda-portal.netlify.app`.

### 6. Test it
Go through the whole flow once with your own details, on a phone as well as a computer. Then delete
the test row from the register and the test files from Drive.

### Changing things later
Edit the files in the Apps Script editor, then go to **Deploy → Manage deployments → ✏️ (edit) →
Version: New version → Deploy**. The URL stays the same, so Netlify needs no change. Choosing
*New deployment* instead would create a new URL.

---

## For HR

- **Register columns:** Generated At, NDA Ref, Full Name, Mobile, Email, Address, PAN, Aadhaar,
  NDA PDF, Status, Signed Copy, Signed At. Filter *Status = Awaiting signed copy* to chase people up.
  Columns are found by their heading, so you can reorder them or add your own; just keep those headings.
- **If an employee made a typo,** they correct the form and generate again. Each attempt gets its own
  reference number; the newest one is the one they upload against.
- **Re-uploads,** for example a missed page, are kept alongside the earlier files.
- **Signed-copy emails:** with `HR_EMAIL` set, each upload emails HR *"Re: Your TagneticAI NDA (ref)"* with the
  employee's name as the sender name and the signed pages attached (only Drive links above 20 MB). Reply
  goes to the employee's email, if they gave one. It is sent from the account that runs the script, because
  Gmail doesn't let a script send as someone else. If `HR_EMAIL` is that same account, Gmail's inbox list
  shows these as "me"; a separate HR mailbox shows the employee's name there too.
- **Company signature:** see below.

### Company signature

Your Canva NDAs go out already stamped and signed by the Designated Partner. The portal can do the same:

1. Make a PNG of the signature (and stamp, if you use one) on a transparent background. A photo of the
   signature works once the paper is removed, or export just those elements from Canva with
   *Transparent background* ticked.
2. Upload it to the *TagneticAI NDAs* Drive folder. Open it, and copy the file ID from the link
   (`https://drive.google.com/file/d/`**`THIS-PART`**`/view`).
3. Paste the ID into `COMPANY_SIGNATURE_FILE_ID` in `Config.gs`, run `previewNda` to check it, and
   deploy a new version.

The signature stays in your private Drive. Don't add it to this repository: the repository is public,
and anything committed stays downloadable in its history.

The trade-off: anyone who has the portal link can then produce a company-signed NDA in any name.
If you'd rather not, leave it blank. The *Disclosing Party* box stays empty, and you sign it by hand
when the employee's signed copy comes in.

---

## Privacy and legal notes

- **Aadhaar is masked by default.** UIDAI rules restrict storing and displaying full Aadhaar numbers, so
  the full number is only used to check validity. Only `XXXX XXXX 1234` is printed on the NDA and stored.
  If your lawyer says the full number must appear, set `MASK_AADHAAR: false`.
- **No public links.** The PDF goes straight from the script to the employee's browser (and email). No Drive
  file is ever shared with "anyone with the link". Keep the *TagneticAI NDAs* folder shared with HR only:
  it holds PAN numbers, addresses and phone numbers.
- **DPDP Act, 2023.** You are collecting personal data. Tell employees why, keep it only as long as you need
  it, and limit who can open the register.
- **The NDA wording is your existing Canva NDA, word for word.** Three things are new: a reference
  number under the title, the employee's Aadhaar/PAN/mobile lines, and the date filled in
  automatically. Canva's leftover template hint (*"Use this NDA to protect confidential information shared
  during early-stage discussions..."*) has been dropped. Points worth raising with your lawyer:
  - The clauses refer to "the Company" and "the Employee", but the parties are introduced only as
    "Disclosing Party" and "Receiving Party". Adding *(the "Company")* and *(the "Employee")* after the
    names would tie the terms together.
  - Whether it should be executed on e-stamp paper so it is admissible in evidence.
- **Who can use it:** anyone with the link can open the portal and generate an NDA, just like the
  invoice app. Uploading to an NDA requires both its reference number and the mobile number given for it.

---

## Running the tests

Requires Node 18 or newer. No install is needed:

```bash
node --test 'nda-app/tests/*.test.js'
```

`tests/gas-harness.js` stands in for the Google services the app uses (HtmlService, DriveApp,
SpreadsheetApp, MailApp, …). The tests run the real `Code.gs`, `Validation.gs` and HTML templates
against it. They cover field validation, generating the PDF and logging it, Aadhaar masking, HTML/formula
escaping, and the signed-copy upload checks.
