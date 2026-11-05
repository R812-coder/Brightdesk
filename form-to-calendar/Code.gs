/**
 * Form to Calendar Bookings for Google Forms(TM) — BrightDesk
 * Product ID fc · licence prefix FCSK
 *
 * Code.gs — menu, sidebar, dialogs and the public API the sidebar calls.
 *
 * Rules kept here on purpose:
 *  - createAddonMenu(), never createMenu().
 *  - No PropertiesService (or any authorized call) at global scope: it breaks AuthMode.NONE.
 *  - onInstall(e) calls onOpen(e).
 *  - Public (browser-callable) functions have no trailing underscore and validate input;
 *    anything that changes plan, licence or approval state ends in _.
 */

var APP_NAME_ = 'Form to Calendar Bookings';
var APP_VERSION_ = '1.0.1';

function onInstall(e) { onOpen(e); }

function onOpen(e) {
  FormApp.getUi().createAddonMenu()
    .addItem('Open', 'showSidebar')
    .addItem('Requests', 'showRequests')
    .addItem('Activity log', 'showLog')
    .addSeparator()
    .addItem('Help', 'showHelp')
    .addItem('Need something custom built?', 'showCustom')
    .addToUi();
}

function showSidebar() { openSidebar_(''); }
function showRequests() { openSidebar_('requests'); }

function openSidebar_(view) {
  var t = HtmlService.createTemplateFromFile('Sidebar');
  t.initialView = view || '';
  FormApp.getUi().showSidebar(t.evaluate().setTitle(APP_NAME_));
}

function showLog() { showDialog_('Dialog', 'Activity log', 760, 520); }
function showHelp() { showDialog_('Help', 'Help', 640, 560); }

function showCustom() {
  var html = HtmlService.createHtmlOutput(
    '<div style="font:13px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;color:#1F2A37;padding:4px">' +
    '<p style="margin:0 0 12px">BrightDesk builds custom Google Workspace automations: booking flows, approvals, reports and add-ons for your team.</p>' +
    '<a href="' + SERVICES_URL_ + '" target="_blank" rel="noopener" style="background:#15803D;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;display:inline-block;font-weight:600">Open brightdesk.dev/services</a>' +
    '</div>').setWidth(380).setHeight(140);
  FormApp.getUi().showModalDialog(html, 'Need something custom built?');
}

function showDialog_(file, title, w, h) {
  var t = HtmlService.createTemplateFromFile(file);
  FormApp.getUi().showModalDialog(t.evaluate().setWidth(w).setHeight(h), title);
}

/** Template helper: <?!= include_('Styles') ?> */
function include_(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

// ---------------------------------------------------------------------------
// PUBLIC API FOR THE SIDEBAR
// ---------------------------------------------------------------------------

/** Everything the sidebar needs to render. Also runs due retries and slot refresh for the owner. */
function getState() {
  var form = FormApp.getActiveForm();
  var cfg = loadConfig_();
  var me = myEmail_();
  var owner = getOwner_().toLowerCase();
  var plan = planInfo_();
  var pro = plan.plan !== 'free';
  var maintenance = null;

  if (cfg && cfg.active && owner && owner === me) {
    var lock = getLock_();
    if (lock.tryLock(5000)) {
      try {
        var r = runRetries_(form, cfg, pro, { max: 3 });
        if (r.tried) maintenance = { retried: r.tried, ok: r.ok };
        if (pro && cfg.pro.slots) maybeRefreshSlots_(cfg);
      } catch (e) { console.error('Maintenance failed: ' + e); }
      finally { lock.releaseLock(); }
    }
  }

  var questions = getQuestions_(form);
  var collects = collectsEmail_(form);
  var tz = (cfg && cfg.tz) || Session.getScriptTimeZone();
  var forms = activeForms_();
  var approvalsOn = !!(cfg && cfg.pro.approval.on);
  var missed = 0;
  if (cfg && cfg.active && owner && owner === me) {
    try { missed = findMissed_(form).length; } catch (e) { console.error('Missed check failed: ' + e); }
  }
  return {
    missed: missed,
    lastRun: Number(docProps_().getProperty('fc.lastRun')) || null,
    version: APP_VERSION_,
    form: { id: form.getId(), title: form.getTitle(), collectsEmail: collects },
    me: me,
    owner: owner,
    ownerIsMe: !owner || owner === me,
    plan: plan,
    cfg: cfg,
    active: !!(cfg && cfg.active),
    paused: !!(cfg && cfg.active && owner === me && !pro && forms.length && forms[0] !== form.getId()),
    freeSlotTaken: !pro && forms.length > 0 && forms[0] !== form.getId(),
    questions: questions,
    issues: cfg ? validateConfig_(cfg, questions, collects) : [],
    defaults: smartDefaults_(questions, form.getTitle(), collects),
    health: cfg ? healthSummary_(tz) : null,
    failures: getJson_('fc.retry', []).map(function (r) {
      return { who: r.who || 'A response', reason: r.reason, tries: r.tries, fix: fixFor_(r.reason) };
    }),
    pendingCount: approvalsOn || listPendingCountQuick_() ? listPending_().length : 0,
    maintenance: maintenance,
    colors: COLORS_,
    links: { buy: BUY_LINKS_, product: PRODUCT_URL_, services: SERVICES_URL_ },
    hourly: HOURLY_ENABLED_
  };
}

function listPendingCountQuick_() {
  var keys = docProps_().getKeys();
  for (var i = 0; i < keys.length; i++) if (keys[i].indexOf('fc.pending.') === 0) return true;
  return false;
}

function collectsEmail_(form) {
  try { return form.collectsEmail(); } catch (e) { return false; }
}

function listCalendars() {
  return listWritableCalendars_();
}

/**
 * Build the event the latest response (or sample values) would create, without creating it.
 * full = true also checks conflicts and says what would happen.
 */
function previewEvent(rawCfg, full) {
  var form = FormApp.getActiveForm();
  var cfg = cleanConfig_(rawCfg);
  var pro = isPro_();
  if (!cfg.calendarId) return { ok: false, msg: 'Pick a calendar first.' };
  var latest = latestResponse_(form);
  var source = latest ? 'latest' : 'sample';
  var ans;
  try {
    ans = latest ? answersFromResponse_(latest, form) : sampleAnswers_(form, cfg);
  } catch (e) { return { ok: false, msg: String(e.message || e) }; }
  try {
    var slotStore = getJson_('fc.slots', {});
    if (pro && cfg.pro.slots && !latest) {
      var first = Object.keys(slotStore.map || {})[0];
      var sq = ans.byId[cfg.pro.slots.itemId];
      if (sq && first) sq.value = first;
    }
    var draft = toDraft_(ans, cfg, { pro: pro, slotMap: slotStore.map || {} });
    if (draft.noSlot) return { ok: false, source: source, msg: 'Choose a slot to preview. Turn it on to generate the time slots.' };
    var target = pro ? route_(draft, cfg) : { calendarId: cfg.calendarId, calendarName: cfg.calendarName, colorId: cfg.colorId };
    var tz = tzFor_(target.calendarId, cfg);
    var times = buildTimes_(draft, tz);
    var when = describeTimes_(times);
    var guests = draft.guests.slice();
    if (draft.addOwner && myEmail_()) guests.push(myEmail_());
    var line = draft.title + ' · ' + when + (guests.length ? ' · Invite ' + guests.join(', ') : '') + '.';
    var out = {
      ok: true, source: source, line: line, title: draft.title, when: when, calendar: target.calendarName || target.calendarId,
      location: draft.location, description: draft.description, guests: guests, allDay: times.allDay, tz: tz,
      respondent: draft.respondentLabel
    };
    if (full) {
      var outcome = 'Would add this event.';
      if (latest) {
        var existing = findExisting_(cfg, draft.responseId, target.calendarId);
        if (existing) outcome = 'This response is already on the calendar' + (pro && cfg.pro.updateOnEdit ? '; an edit would update it.' : '.');
      }
      if (pro && (cfg.pro.conflict.on || draft.slot)) {
        var c = findConflict_(target.calendarId, times, draft, cfg, tz);
        if (c) {
          var a = cfg.pro.conflict.on ? cfg.pro.conflict.action : 'decline';
          outcome = 'Conflict: ' + c.reason + ' ' + (a === 'decline' ? 'It would be declined' + (draft.requesterEmail ? ' and the person emailed.' : '.') :
            a === 'approval' ? 'It would wait for approval with a warning.' : 'It would be added with "Conflict:" in the title.');
        }
      }
      if (pro && cfg.pro.approval.on && outcome === 'Would add this event.') outcome = 'Would wait for approval, then add this event.';
      out.outcome = outcome + ' Nothing was created.';
    }
    return out;
  } catch (e) {
    return { ok: false, source: source, msg: String(e.message || e) };
  }
}

function latestResponse_(form) {
  try {
    var recent = form.getResponses(new Date(Date.now() - 60 * 86400000));
    if (recent.length) return recent[recent.length - 1];
    var all = form.getResponses();
    return all.length ? all[all.length - 1] : null;
  } catch (e) { return null; }
}

/** Plausible answers for every question, so the preview works before anyone responds. */
function sampleAnswers_(form, cfg) {
  var tz = cfg.tz || (cfg.calendarId ? tzFor_(cfg.calendarId, cfg) : Session.getScriptTimeZone());
  var tomorrow = addDays_(todayYmd_(tz), 1);
  var collects = collectsEmail_(form);
  var ans = { responseId: 'sample', formId: form.getId(), formTitle: form.getTitle(), timestamp: Date.now(),
    respondentEmail: collects ? 'jordan.lee@example.com' : '', byId: {}, list: [] };
  getQuestions_(form).forEach(function (q) {
    var v = 'Sample answer';
    var isEnd = cfg.end && cfg.end.itemId === q.id;
    if (q.type === 'DATE') v = isEnd ? addDays_(tomorrow, 2) : tomorrow;
    else if (q.type === 'DATETIME') v = (isEnd ? tomorrow + ' 11:00' : tomorrow + ' 10:00');
    else if (q.type === 'TIME') v = isEnd ? '11:00' : '10:00';
    else if (q.type === 'DURATION') v = '01:00:00';
    else if (q.type === 'TEXT') v = /e-?mail/i.test(q.title) ? 'jordan.lee@example.com' : /name/i.test(q.title) ? 'Jordan Lee' : 'Sample answer';
    else if (q.type === 'PARAGRAPH_TEXT') v = 'Sample notes';
    else if (q.type === 'MULTIPLE_CHOICE' || q.type === 'LIST') v = (q.choices && q.choices[0]) || 'Option 1';
    else if (q.type === 'CHECKBOX') v = [(q.choices && q.choices[0]) || 'Option 1'];
    else if (q.type === 'SCALE' || q.type === 'RATING') v = '3';
    var e = { id: q.id, title: q.title, type: q.type, value: v };
    ans.byId[q.id] = e;
    ans.list.push(e);
  });
  return ans;
}

/**
 * Save setup; with opts.turnOn also creates the trigger and makes this user the owner.
 * opts = { turnOn: bool, replace: bool }
 */
function saveSetup(rawCfg, opts) {
  opts = opts || {};
  var form = FormApp.getActiveForm();
  var cfg = cleanConfig_(rawCfg);
  var questions = getQuestions_(form);
  var collects = collectsEmail_(form);
  var errors = validateConfig_(cfg, questions, collects).filter(function (i) { return i.level === 'error'; });
  if (errors.length) return { ok: false, issues: errors };

  var pro = isPro_();
  if (!pro && usesPro_(cfg)) return { ok: false, needPro: true, msg: 'Some options you turned on are part of Pro. Upgrade, or turn them off.' };

  // Cache each calendar's own time zone.
  try {
    cfg.tzCache = {};
    cfg.tz = Calendar.Calendars.get(cfg.calendarId).timeZone;
    cfg.tzCache[cfg.calendarId] = cfg.tz;
    (cfg.pro.routes || []).forEach(function (r) {
      if (!cfg.tzCache[r.calendarId]) cfg.tzCache[r.calendarId] = Calendar.Calendars.get(r.calendarId).timeZone;
    });
  } catch (e) {
    return { ok: false, msg: describeApiError_(e, cfg.calendarId) };
  }

  var me = myEmail_();
  var owner = getOwner_().toLowerCase();
  var prev = loadConfig_();
  var lock = getLock_();
  if (!lock.tryLock(20000)) return { ok: false, msg: 'A response is being processed. Try again in a moment.' };
  try {
    if (opts.turnOn) {
      if (owner && owner !== me && prev && prev.active && !opts.replace) {
        return { ok: false, needReplace: true, owner: owner,
          msg: 'Another editor\'s setup is active on this form (running as ' + owner + '). Turning it on here will replace it.' };
      }
      if (!claimForm_(form.getId())) {
        return { ok: false, freeLimit: true, msg: 'Only one form can be active on the free plan. Upgrade to use this one too.' };
      }
      removeMyTriggers_(form);
      ScriptApp.newTrigger('handleSubmit').forForm(form).onFormSubmit().create();
      ensureHourly_(form);
      docProps_().setProperty('fc.owner', me);
      docProps_().setProperty('fc.activatedAt', String(Date.now()));
      cfg.active = true;
    } else {
      cfg.active = !!(prev && prev.active);
    }
    saveConfig_(cfg);
    var slots = null;
    if (pro && cfg.pro.slots && cfg.active) slots = safeRefreshSlots_(cfg);
  } finally { lock.releaseLock(); }
  if (opts.turnOn) maybeWelcome_();
  return { ok: true, slots: slots, state: getState() };
}

/** True when the config turns on anything that needs Pro. */
function usesPro_(cfg) {
  var p = cfg.pro;
  return !!(p.conflict.on || p.approval.on || p.slots || (p.routes && p.routes.length) || p.updateOnEdit || p.meet ||
    (p.reminders && p.reminders.length) || (p.emails.confirm && p.emails.confirm.on) || (p.emails.decline && p.emails.decline.on));
}

/** Turn off for this form. Any editor can do it; the owner's trigger then does nothing. */
function turnOff() {
  var form = FormApp.getActiveForm();
  var lock = getLock_();
  lock.tryLock(20000);
  try {
    var cfg = loadConfig_();
    removeMyTriggers_(form);
    if (cfg) { cfg.active = false; saveConfig_(cfg); }
    if (iAmOwner_()) docProps_().deleteProperty('fc.owner');
    releaseForm_(form.getId());
  } finally { try { lock.releaseLock(); } catch (e) { /* not held */ } }
  return getState();
}

/** Retry every queued failure now (owner only: events are added from the owner's account). */
function retryNow() {
  if (!iAmOwner_()) return { ok: false, msg: 'Only ' + getOwner_() + ' can retry, because events are added from their account.' };
  var form = FormApp.getActiveForm();
  var cfg = loadConfig_();
  if (!cfg) return { ok: false, msg: 'Set up the form first.' };
  var lock = getLock_();
  if (!lock.tryLock(20000)) return { ok: false, msg: 'A response is being processed. Try again in a moment.' };
  var r;
  try { r = runRetries_(form, cfg, isPro_(), { max: 10, force: true }); }
  finally { lock.releaseLock(); }
  return { ok: true, tried: r.tried, fixed: r.ok, state: getState() };
}

/** "Add booking questions for me": name, date (with year), start time, duration, email collection. */
function addBookingQuestions() {
  var form = FormApp.getActiveForm();
  var titles = getQuestions_(form).map(function (q) { return q.title.toLowerCase(); });
  if (titles.indexOf('your name') < 0) form.addTextItem().setTitle('Your name').setRequired(true);
  form.addDateItem().setTitle('Date').setIncludesYear(true).setRequired(true);
  form.addTimeItem().setTitle('Start time').setRequired(true);
  form.addDurationItem().setTitle('Duration').setHelpText('How long you need, for example 1 hour.').setRequired(true);
  try { form.setCollectEmail(true); } catch (e) { /* older forms */ }
  return getState();
}

/**
 * Responses since this was turned on that the trigger never handled (not in the log,
 * retry queue or approval queue). Catches a trigger that stopped, was removed, or never
 * fired (Google test deployments never run installable triggers).
 */
function findMissed_(form) {
  var now = Date.now();
  var since = Number(docProps_().getProperty('fc.activatedAt')) || (now - 7 * 86400000);
  var log = readLog_();
  var floor = Math.max(since, now - 7 * 86400000);
  if (log.length >= LOG_MAX_) floor = Math.max(floor, log[log.length - 1].t); // older entries rotated out
  var seen = {};
  log.forEach(function (e) { if (e.rid) seen[e.rid] = true; });
  getJson_('fc.retry', []).forEach(function (r) { seen[r.id] = true; });
  listPending_().forEach(function (p) { seen[p.responseId] = true; });
  var settle = now - 2 * 60 * 1000; // a response submitted in the last 2 minutes may still be in flight
  return form.getResponses(new Date(floor)).filter(function (r) {
    var t = r.getTimestamp() ? r.getTimestamp().getTime() : 0;
    return !seen[r.getId()] && t <= settle;
  }).slice(-50);
}

/** "Add them now": run missed responses through the normal pipeline (owner only). */
function processMissed() {
  if (!iAmOwner_()) return { ok: false, msg: 'Only ' + getOwner_() + ' can add these, because events are added from their account.' };
  var form = FormApp.getActiveForm();
  var cfg = loadConfig_();
  if (!cfg || !cfg.active) return { ok: false, msg: 'Turn it on first.' };
  var lock = getLock_();
  if (!lock.tryLock(20000)) return { ok: false, msg: 'A response is being processed. Try again in a moment.' };
  var tried = 0, added = 0, other = 0;
  try {
    var pro = isPro_();
    findMissed_(form).slice(0, 20).forEach(function (r) {
      tried++;
      var res = runOne_(form, r, cfg, pro, false);
      if (res === 'Created' || res === 'Updated') added++; else other++;
    });
  } finally { lock.releaseLock(); }
  return { ok: true, tried: tried, added: added, other: other, state: getState() };
}

/** Bookable slots need a choice question; add one when the form has none. */
function addSlotQuestion() {
  var form = FormApp.getActiveForm();
  var item = form.addMultipleChoiceItem().setTitle('Choose a time').setRequired(true);
  item.setChoiceValues([NO_SLOTS_CHOICE_]);
  return { ok: true, itemId: item.getId(), state: getState() };
}

/** "Fix it": turn on Include year for a date question. */
function fixIncludeYear(itemId) {
  var item = FormApp.getActiveForm().getItemById(Number(itemId));
  if (!item) return { ok: false, msg: 'That question no longer exists.' };
  var type = String(item.getType());
  if (type === 'DATE') item.asDateItem().setIncludesYear(true);
  else if (type === 'DATETIME') item.asDateTimeItem().setIncludesYear(true);
  else return { ok: false, msg: 'That question is not a date question.' };
  return { ok: true, state: getState() };
}

/** Rows for the Activity log dialog. */
function getLogRows() {
  var cfg = loadConfig_();
  var tz = (cfg && cfg.tz) || Session.getScriptTimeZone();
  return { tz: tz, rows: logRows_(tz) };
}

function openLogFromSidebar() { showLog(); }
function openHelpFromSidebar() { showHelp(); }
