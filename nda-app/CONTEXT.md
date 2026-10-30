# TagneticAI NDA Portal: context for continuing work

Paste this into a new chat to pick up where we left off. Last updated October 30, 2026.

## What it is

A self-service portal for new TagneticAI employees. They enter their details, get a filled-in NDA
in the company's own format, sign it by hand, and send the signed copy back. HR gets every NDA and
signed copy filed in Google Drive and logged in a Google Sheet.

It copies the technique of the existing labeler invoice app (`tagneticai-invoice-app.netlify.app`):

```
Browser -> Netlify page (static index.html, one full-screen <iframe>)
        -> Google Apps Script web app (/exec URL), running as the owner's Google account
           doGet() serves Index.html; the page calls server functions with google.script.run
        -> Drive (PDFs, signed copies), Sheets (register), Gmail (emails)
```

- **Live web app:** `https://script.google.com/macros/s/AKfycbxNRNGR-tV4QHYJOD-duu9d05SangK0sFKCv1ZwSSzWtKZc2mFOYZcLGIf-tsLz9NC3tA/exec`
  (deployed as *Execute as: Me*, *Who has access: Anyone*). Netlify serves `nda-app/netlify/index.html`, which frames it.
- **Code:** GitHub `ProtickPurkait/TagneticAI-Labeler-s-Invoice-App` (**public** repository), branch
  `claude/awesome-dijkstra-ulqwml`, folder `nda-app/`. The owner copies files from there into the Apps Script editor.
- **Owner:** a personal Gmail account. It owns the Apps Script project, the Drive folder and the register,
  and it sends all emails. `HR_EMAIL` is currently set to that same address.

## Employee flow

1. **Enter details:** full name (as on PAN), residential address (must include a 6-digit PIN), Aadhaar, PAN,
   mobile (+91) and email (required), then tick "details are correct".
   - Aadhaar is checked with the Verhoeff checksum and must not start with 0 or 1.
   - PAN must look like `AAAAA9999A`, with `P` as the 4th character (individual).
   - The same rules run in the browser and on the server.
2. **Generate:** the NDA PDF downloads in the browser and is emailed to them, with a reference number
   `TAI-NDA-YYMMDD-XXXXX`. A register row is added with status *Awaiting signed copy*.
3. **Sign:** print, sign under *Receiving Party* on the last page, initial every page, scan or photograph.
4. **Return**, either way:
   - **Reply to the NDA email with the signed pages attached (preferred).** It really comes from their address.
     Every 15 minutes `collectEmailedNdas` files replies from the address registered for that NDA:
     attachments go to *Signed NDAs*, the register shows *Signed copy received*, and the conversation gets
     the Gmail label **NDA filed**.
   - **Upload on the portal (backup)** with the reference number + mobile number. HR is then emailed
     *"Re: Your TagneticAI NDA (ref)"* with the employee's name as the sender name, Reply-To set to the employee,
     and the pages attached. It is still sent from the owner's address, because Apps Script cannot send as anyone else.

## The NDA document (`NdaTemplate.html`)

- **Wording:** the company's Canva NDA word for word, clauses 1–7: Definition, Obligations, Exceptions,
  IP & General Skills, Return of Materials, Term (3 years, trade secrets indefinitely), and Governing Law
  (India, courts in Kolkata).
- **Layout copies the Canva design:**
  - purple Georgia title with the T<GNETIC logo badge
  - two-column Disclosing/Receiving Party block with a faint logo watermark
  - purple clause text, black bullet points, dark rules
  - pink left bar
  - signature boxes, with the company's box pre-signed using the owner's signature image
- **Additions to the Canva NDA:** reference number under the title; Aadhaar (masked `XXXX XXXX 1234`),
  PAN and mobile lines; date filled in as "June 17th, 2026". Canva's leftover template hint was dropped.
- **Parties:** Disclosing Party is "TagneticAI LLP", F/NO-1 A MAINAK APT, F/N-1A, GROUND FLOOR C/F-10/1,
  JYANGRA GHOSPARA, KOL-59 NORTH 24 PARGANAS 700059.
- **Rendering:** Google's HTML-to-PDF converter turns it into a PDF. It supports less CSS than a browser,
  so the pink bar and the watermark may not appear.

## Files

| File (`nda-app/`) | Purpose |
|---|---|
| `apps-script/Config.gs` | Settings: `COMPANY_NAME` "TagneticAI", `COMPANY_LEGAL_NAME`, `COMPANY_ADDRESS`, `COMPANY_SIGNATURE_FILE_ID` (Drive PNG of the signature), `REF_PREFIX` "TAI-NDA", `MASK_AADHAAR` true, `HR_EMAIL`, `MAX_UPLOAD_FILES` 6, `MAX_UPLOAD_MB` 15 |
| `apps-script/Code.gs` | `doGet`, `setup`, `collectEmailedNdas(e)` (15-min trigger), `previewNda`, `generateNda`, `uploadSignedNda`, plus helpers (`notifyHr_`, `fileEmailedThread_`, `mailboxOf_`, `imageDataUri_`, register helpers) |
| `apps-script/Validation.gs` | `buildValidators_()`, shared by server and page (the page inlines its source) |
| `apps-script/Index.html` | The employee page (Bootstrap 5, logo header, generate form, upload form) |
| `apps-script/NdaTemplate.html` | The NDA document |
| `apps-script/Assets.gs` | Logo badge and watermark as base64 PNG data URIs (two very long lines) |
| `apps-script/appsscript.json` | V8, Asia/Kolkata, web app settings |
| `netlify/index.html` | The iframe wrapper with the live `/exec` URL |
| `tests/` | `node --test 'nda-app/tests/*.test.js'`, 36 tests. `gas-harness.js` stands in for Apps Script services, including Apps Script's URL sanitising |
| `README.md` | Setup guide, HR notes, privacy and legal notes |

## In Google Drive / Gmail (owner's account)

- Folder **TagneticAI NDAs**, containing:
  - **Generated NDAs/** (PDFs)
  - **Signed NDAs/** (scans; files named `<ref>_signed_…` for uploads and `<ref>_emailed_<gmail-id>_…` for email replies)
  - **TagneticAI NDA Register** (Sheet)
  - **Company signature (NDA portal).png** (private)
- **Register columns:** Generated At, NDA Ref, Full Name, Mobile, Email, Address, PAN, Aadhaar, NDA PDF,
  Status, Signed Copy, Signed At. Columns are found by their heading. The existing sheet also has an old,
  unused "MLID" column, which is harmless.
- **Gmail label:** "NDA filed".

## Decisions and lessons (don't undo these)

1. **Images use the raw tag `<?!= … ?>`, never `<?= … ?>`.** The escaping tag sanitises `data:` URLs into
   `#zSoyz`, which made the logo and signature vanish from PDFs. `imageDataUri_()` only lets real base64
   PNG/JPEG through.
2. **No Apps Script email can come from the employee's address.** That is why signed copies come back as
   email replies.
3. **Saving code doesn't change the live app.** Use *Deploy → Manage deployments → edit → Version: New version*,
   which keeps the URL. *New deployment* would create a new URL.
4. **Re-run `setup` after updates that need new permissions** (Gmail, triggers). It installs the 15-minute
   trigger and checks the last 14 days of replies straight away. It is safe to run again.
5. **The repository is public.** Never commit the signature image or private data. The signature lives
   in the owner's private Drive and is referenced by file ID.
6. **To test email replies,** reply from an address other than the owner's; the owner's own messages are skipped.
7. **No scriptlet syntax inside HTML comments in templates.** Apps Script parses those too, and it breaks the template.
8. **MLID was removed** (not used at TagneticAI). Portal uploads are checked with reference number + mobile.
9. **Aadhaar is masked** (UIDAI guidance). The full number is only checked, never stored.
10. **`collectEmailedNdas` only runs with a valid trigger ID**, so web visitors can't set it off.
    `setup` and `previewNda` can be called by anyone with the link. That is low risk, and they could be
    locked to the owner later.
11. **The owner prefers full file contents in chat to copy and paste,** not diffs. `Assets.gs` is too long
    for chat, so send it as an attachment or a GitHub link.

## Status and open items

- **Live and used by employees.** Several NDAs have been generated and signed copies received.
- **Waiting for the owner to apply the email-reply version** (commit `ed4657c`): paste `Code.gs`,
  `Validation.gs` and `Index.html`, run `setup` and allow the Gmail and trigger permissions, deploy a new
  version, then test a reply from a non-owner address.
- **Not yet confirmed:** that Google's PDF output shows the logo and signature after the image fix
  (run `previewNda`). The pink bar and watermark may not show.
- **Possible next steps:**
  - add the red "TagneticAI LLP – Designated Partner" stamp (needs the image)
  - lock `setup` and `previewNda` to the owner
  - use a separate HR mailbox, so names show in the inbox list instead of "me"
  - legal review: define "Company"/"Employee" against "Disclosing/Receiving Party"; whether to use e-stamp paper
- **Limit to keep in mind:** a personal Gmail account can send email to about 100 recipients a day from Apps Script.
