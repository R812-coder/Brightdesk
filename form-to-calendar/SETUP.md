# Form to Calendar Bookings for Google Forms™ — Setup, Testing & Publishing

Product ID `fc` · licence prefix `FCSK` · Google Forms editor add-on · Apps Script V8 · Advanced Calendar service.
v1.0.1 · built 2026-10-29 from "Add-on #3: Research, Validation and Build Blueprint". Covers blueprint Rounds 2–4 (engine, sidebar, Pro, licensing) in code. Rounds 1 and 5–7 are manual steps below.

---

## 1. What's in the folder

| File | What it does |
|---|---|
| `appsscript.json` | Manifest: the six scopes, Advanced Calendar service v3. No `addOns` block. |
| `Code.gs` | Menu, sidebar, dialogs, and every function the sidebar calls (`getState`, `saveSetup`, `previewEvent`, `turnOff`, `retryNow`, ...) |
| `Config.gs` | Chunked storage (property values are capped at 9 KB), config shape, validation, smart defaults |
| `Mapper.gs` | Form response → plain answers → event draft; `{{Question}}` tokens; routing by answer |
| `Times.gs` | Answer parsing, time-zone-safe moments, UTC day math, daylight-saving gap detection |
| `Calendar.gs` | Calendar API calls: list, insert, patch, move, verify, find by response ID, conflicts |
| `Submit.gs` | `handleSubmit(e)` trigger and the pipeline: parse → route → dedupe → conflict → approve or create → verify → log |
| `Approvals.gs` | Pending queue, `approveRequest` / `declineRequest` (editor-checked wrappers around `approve_` / `decline_`) |
| `Slots.gs` | Bookable slots: generate, remove busy and taken, write choices to the question |
| `Retry.gs` | Retry queue (24 tries, 15 min apart). Optional hourly job, **off** (`HOURLY_ENABLED_ = false`) |
| `Mail.gs` | Owner failure alert (max one a day), approval notices, requester emails, welcome email |
| `Log.gs` | Last 200 actions and the health line |
| `License.gs` | HMAC keys, plans, free one-form limit, **Stripe links to fill in**. Secret comes from the `LICENSE_SECRET` script property |
| `EngineTests.gs` | `runEngineTests()`: 77 checks across 5 time zones and both 2026 US DST weekends |
| `Sidebar.html`, `Styles.html`, `Client.html` | Setup wizard, dashboard, requests, upgrade |
| `Dialog.html` | Activity log (760 × 520) |
| `Help.html` | In-app help |
| `tools/make-license.js` | **Not uploaded.** Optional command-line key maker. The BrightDesk Admin sheet is the main one |
| `.claspignore` | Keeps `tools/` and this file out of `clasp push` |

---

## 2. Two settings

**a. Licence secret: reuse your existing one.** Nothing goes in the code. After pasting (section 3): script editor → **Project Settings** (gear) → scroll to **Script properties** → **Add script property** → Property `LICENSE_SECRET`, Value: the same secret Timesheet and your Admin sheet use → **Save script properties**. Do the same in the BrightDesk Admin sheet's script project (section 10). One secret is safe across products: each product's keys carry their own prefix and the signature covers it, so a Timesheet key can never unlock Form to Calendar or the reverse (tested).

**b. Stripe Payment Links.** In Stripe: Product catalog → Add product "Form to Calendar Bookings Pro" with two prices ($49/year, $12/month), and a product "Form to Calendar Bookings Organization" ($499/year). Payment Links → New for each. Paste the three `https://buy.stripe.com/...` links into `BUY_LINKS_` in `License.gs`. The sidebar adds `?prefilled_email=` so the buyer's Google email is filled in. Hook them to the same key-email flow as Timesheet.

You can paste and test with the placeholders left in; only Buy and real keys need them.

---

## 3. Put the code into Apps Script

### Option A: paste into the editor
1. [script.google.com](https://script.google.com) → **New project** → rename it **Form to Calendar Bookings**.
2. Gear icon (**Project Settings**) → tick **Show "appsscript.json" manifest file in editor**.
3. **Editor** (`< >` icon) → click `appsscript.json` → replace everything with ours → Save (Cmd+S).
4. Click `Code.gs` → replace with ours.
5. For each of `Config`, `Mapper`, `Times`, `Calendar`, `Submit`, `Approvals`, `Slots`, `Retry`, `Mail`, `Log`, `License`, `EngineTests`: **+** next to Files → **Script** → type the name without `.gs` → paste.
6. For each of `Sidebar`, `Styles`, `Client`, `Dialog`, `Help`: **+** → **HTML** → name without `.html` → paste.
7. Left bar, **Services**: you should see **Google Calendar API** (identifier `Calendar`). If not: **+** → Google Calendar API → v3 → identifier `Calendar` → Add.

### Option B: clasp
```bash
npm i -g @google/clasp
clasp login
cd form-to-calendar
clasp create --type standalone --title "Form to Calendar Bookings"
clasp push
```

### Run the engine tests (2 minutes)
1. Open `EngineTests.gs`. In the toolbar function picker choose **runEngineTests** → **Run**.
2. First run asks for permissions: **Review permissions** → your account → **Advanced** → **Go to Form to Calendar Bookings (unsafe)** → **Allow**. (Normal for unverified scripts.)
3. **Execution log** must end with `Engine tests: 77 passed, 0 failed`. (The licence checks use a throwaway test secret, not yours.) Any `FAIL` line: send it to me.

---

## 4. Round 1 from the blueprint (do these first)

**Step 1, claim the name.** Search the Marketplace for "Form to Calendar Bookings" and "form to calendar". Confirm no exact match. Create the Cloud project "Form to Calendar Bookings" (section 7) and placeholder pages brightdesk.dev/form-to-calendar, /privacy, /terms.

**Step 2, time-zone spike (15 minutes, now using the real add-on code).**
1. Google Calendar → **+ Other calendars** → **Create new calendar** → name "Perth test" → time zone **(GMT+08:00) Perth** → Create.
2. Install on a test form (next section) and pick "Perth test" in Step 1.
3. Submit 14 Nov 2026, 10:00, 1 hour.
4. Open Calendar with your Calendar settings set to New York: the event must show **Fri 13 Nov, 9 PM–10 PM**. Switch your Calendar time zone to Perth: **Sat 14 Nov, 10 AM–11 AM**.
5. Submit the same form with no start time: an all-day event on 14 Nov in both views.

**Step 3, trigger spike.** Google's test deployments never run installable triggers ("Installable triggers aren't supported", developers.google.com/apps-script/add-ons/test), so this needs the bound copy in section 5b. If the event appears there after an incognito submission, `handleSubmit` received `e.response` and could call the Calendar API. For the hourly trigger: read the Expiration Date Reminders spike result. Only if it proved a time trigger can reach the form with a `currentonly` scope, set `HOURLY_ENABLED_ = true` in `Retry.gs`. Otherwise leave it off; retries run on each submission and each time the owner opens the sidebar, and Help already says so.

---

## 5. Install it on a test form

1. Drive → **New** → **Google Forms** → **Blank form**. Title it "Room bookings test". Leave it empty.
2. Back in the script editor: **Deploy** → **Test deployments**.
3. **Select type** (gear) → **Editor Add-on** → **Create new test** → Version **Latest code** → Config **Installed and enabled** → Test document: **Select doc** → your form → **Save test**.
4. Tick the saved test → **Execute**. The form opens in a new tab.
5. In the form: **Extensions** (puzzle-piece icon in the top bar, or the three-dot menu) → **Form to Calendar Bookings** → **Open**. Approve the permissions screen; it lists exactly the six scopes.
6. In the sidebar: **Add booking questions for me** → pick a calendar → check the mapping and preview → Next → **Test with latest response** → **Turn on**. You should see "On. Running as you@...".
7. In the form click **Publish** (newer forms must be published before they take responses), copy the responder link, open it in an incognito window and submit.
8. **In a test deployment no event appears by itself. That's Google's rule, not a bug:** test deployments don't run form-submit triggers. Close and reopen the sidebar: the dashboard says "1 response since you turned this on hasn't been added" → **Add it now**. That runs the exact same pipeline, so it proves times, all-day, invites, verify and the log. The event appears and Activity log shows "Created".

### 5b. Test the real trigger with a bound copy (10 minutes)
1. Turn the test deployment off on your test form (sidebar → **Turn off**) so two copies don't both act.
2. Make a second blank form, "Trigger test". In it: **Extensions → Apps Script**. This opens a script that belongs to the form. Click **Untitled project** at the top and rename it **Form to Calendar Bookings** (a bound script's menu is named after the project).
3. Paste every file exactly as in section 3 (manifest included). Save. Add the `LICENSE_SECRET` script property here too if you'll test Pro.
4. Back in the form, reload the page. **Extensions → Form to Calendar Bookings → Open** (first time: approve permissions).
5. Set it up and **Turn on**, publish the form, submit from incognito. Within about 30 seconds the event is on the calendar and Activity log says "Created". In the script editor, **Executions** (left bar) shows a `handleSubmit` run with status Completed.
6. If nothing appears: open **Executions**. A failed `handleSubmit` shows the error; send it to me. No run at all means the trigger wasn't created: check **Triggers** (alarm-clock icon) for a `handleSubmit` / From form / On form submit row.

The bound copy is only for testing. The published add-on runs triggers the same way the bound copy does.

### Test Pro without paying
```bash
cd form-to-calendar
FC_SECRET="your existing secret" node tools/make-license.js itsrayan2005@gmail.com pro 2027-10-29
```
Or use the Admin sheet: **BrightDesk Admin → Generate licence key** → Form to Calendar Bookings, untick "Email the key". Sidebar → **Upgrade** (or flip any Pro switch) → paste the key in **Licence key** → **Enter licence key**.

---

## 6. What was already verified here, and what only real Google can prove

Verified before delivery (simulated Apps Script runtime with real IANA time zones):
- 77 engine checks: Perth/New York/London/Kolkata/LA times, both 2026 US DST weekends, non-existent 02:30 reported, all-day, multi-day, end before start, missing year, slots, conflicts, licence keys.
- 67 end-to-end checks through `handleSubmit` (including missed-response detection and Add them now) against fake Forms/Calendar/Mail/triggers: create, verify, duplicate trigger fire (no second event), blank time → all-day, user errors not retried, API error → retry → Retry now succeeds, verify catches a wrong-time event, one alert email per day, free one-form limit, free can't save Pro options, editor takeover warning and old trigger removing itself, 200-entry log under the 9 KB property cap, conflict decline + email, update on edit, route to a Perth calendar and move on edit, approvals (non-editor refused, editor approves, decline with reason), slots written, taken slot removed, stale slot choice declined.
- 17 licence checks: keys from your old Admin generator validate in the patched Timesheet code; new Admin-sheet Timesheet keys validate in the original Timesheet code; Admin-sheet Form to Calendar keys validate in `License.gs`; keys never cross products; the old public `generateSignature` really could forge a key.
- Every sidebar screen rendered at 300 px with no script errors.

Only a real account can prove (run the blueprint's Test plan on a Gmail and a Workspace account):
- Calendar API behaviour: invites (`sendUpdates: 'all'`), Meet links on Gmail accounts, guest-invite limits.
- That a published add-on's form-submit trigger can rewrite slot choices with `forms.currentonly`.
- `form.getEditors()` under `forms.currentonly` (if it throws, only the owner and listed approvers can approve).
- Email collection: `form.collectsEmail()` and `getRespondentEmail()` with "Verified" vs "Responder input".

---

## 7. Publishing (Round 5)

Scopes must match exactly in three places: `appsscript.json`, the OAuth consent screen, and Marketplace SDK.

1. **Cloud project**: console.cloud.google.com → New project "Form to Calendar Bookings". Copy its **project number** (Dashboard).
2. Script editor → Project Settings → **Google Cloud Platform (GCP) Project** → **Change project** → paste the number → Set project.
3. In the Cloud project: **APIs & Services → Library** → enable **Google Calendar API** and **Google Workspace Marketplace SDK**.
4. **OAuth consent screen** (Google Auth Platform → Branding / Audience / Data access): External; app name "Form to Calendar Bookings"; support email; 120×120 logo; homepage `https://brightdesk.dev/form-to-calendar`; privacy and terms URLs; authorized domain `brightdesk.dev`. Data access → Add scopes, exactly:
   - `https://www.googleapis.com/auth/forms.currentonly`
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/script.scriptapp`
   - `https://www.googleapis.com/auth/script.send_mail`
   - `https://www.googleapis.com/auth/script.container.ui`
   - `https://www.googleapis.com/auth/userinfo.email`
5. **Deploy → New deployment** → type **Add-on** → description "1.0.0" → Deploy. Note the version number.
6. **Marketplace SDK → App Configuration**: Visibility Public · Installation settings: Individual + Admin install · App integration: tick **Editor add-on** (not Google Workspace add-on) → **Forms add-on** · Script ID (Project Settings) and the version number · the same six scopes · developer links. Save.
7. **Store listing**: copy from the blueprint's Listing section (name, 175-char short description, long description). Category Productivity. Icons 32×32 and 128×128 (green arrow from three lines into a checked square; no calendar page, no Google colors), 220×140 banner with an amber NEW pill, five 1280×800 screenshots. Support, privacy, terms URLs. Submit.
8. **OAuth verification**: `calendar` is sensitive, not restricted → no CASA. Submit with a YouTube demo (unlisted) that shows each scope in use: reading the form's questions, an event appearing in Calendar, the owner email, the trigger running on a submission. If asked why full `calendar`: listing calendars the user can write to, and checking conflicts (free/busy) before booking. Expect 4–6 weeks; do Round 6 content meanwhile.
9. **Every resubmission**: Deploy → Manage deployments → pencil (Edit) → Version: **New version** → Deploy; then Marketplace SDK → App Configuration → new version number → Save.

---

## 8. Not built yet (later rounds)

- Rating request after the third event (Round 7, step 20): needs the live listing URL first.
- Five "Make a copy" template forms, website pages, icon/banner/screenshots, YouTube demo (Rounds 6–7).
- Stripe → key email automation: reuse Timesheet's flow with `tools/make-license.js`.

## 9. Known limits (say these plainly in Help and the listing)

- Runs as the person who turned it on. If they leave, events stop; the dashboard shows "Running as".
- Without the hourly trigger, failed events retry on the next submission or when the owner opens the sidebar, and slots refresh on each submission and sidebar open. A meeting added straight into Calendar is still caught at submit.
- Slot choices replace the slot question's choices (any "go to section" branching on that question is lost).
- Google's limits: 100 email recipients a day on Gmail accounts, 1,500 on Workspace; daily guest-invite limits. Failures are logged and retried.
- Best effort, never "guaranteed".

---

## 10. Licensing across BrightDesk (Admin sheet and Timesheet patch)

Two files ship alongside this folder:

**`brightdesk-admin/KeyGenerator.gs`** replaces the Admin sheet's old KeyGenerator.gs.
1. Admin sheet → **Extensions → Apps Script** → replace KeyGenerator.gs with the new file → Save.
2. **Project Settings → Script properties → Add** `LICENSE_SECRET` = your existing secret. The new file has no secret in it.
3. Reload the sheet → **BrightDesk Admin → Check setup**: both products must say OK.
4. **BrightDesk Admin → Validate a key** → paste one Timesheet key you sold before. It must say YES.
5. Selling a key from now on: **Generate licence key** → product, buyer email, plan, expiry, Stripe payment ID → **Generate key**. It is copied to your clipboard, emailed to the buyer (untick to skip), and logged in the **Keys** tab.

What changed from the old generator: only Timesheet (ct) and Form to Calendar (fc) remain; keys always go to the Keys tab (the old one wrote to whichever tab was open); one dialog instead of three prompts; Organization keys; refuses an Organization key for gmail.com and similar; emails the buyer; self-checks every key before handing it over.

**`timesheet-patch/LicenseKey.gs`** is Timesheet's file with one security fix. Ship it as v1.2:
1. Timesheet script → replace LicenseKey.gs → put your secret back in `LICENSE_SECRET` **or** add the `LICENSE_SECRET` script property (either works; the property wins).
2. Run **adminCheckLicenseSecret** from the editor: the log must say "Script property" or "LICENSE_SECRET constant", never "NOWHERE".
3. Search the Timesheet project for `generateSignature(`: nothing outside LicenseKey.gs should call it (the sidebar never needs it).
4. Deploy → Manage deployments → Edit → New version → Marketplace SDK → App Configuration → new version → Save. No scope change, so no new review of scopes.

Why: in the old file `generateSignature` was public. Any public server function can be called from the sidebar through `google.script.run`, so anyone who opened DevTools on the sidebar could have the add-on sign a payload of their choice and mint a valid Timesheet key for any email and any expiry. Renaming it `generateSignature_` makes it uncallable from the browser. The key format is unchanged, so every key you've sold keeps working.

Deliberately NOT changed in Timesheet, and why:
- **Binding keys to the user's Google email.** Form to Calendar does this; Timesheet doesn't. Turning it on now would lock out any paying customer whose Stripe email differs from their Google account. Do it only for keys issued from now on, if at all.
- **The 7-day hard-stop trial.** Your own notes say it hurts the install-count flywheel; moving Timesheet to a permanent free tier with a ceiling is a product decision, not a licence fix.
- **Revocation.** Offline keys can't be revoked. A refunded buyer keeps a working key until its expiry, so keep expiries at one year.
