/**
 * Submit.gs — the form-submit trigger and the fixed pipeline:
 * parse -> route -> dedupe -> conflict -> approve or create -> verify -> log.
 */

/** Installable onFormSubmit trigger handler. */
function handleSubmit(e) {
  if (!e || !e.response || typeof e.response.getId !== 'function') return; // ignore browser calls
  var form = (e.source && typeof e.source.getId === 'function') ? e.source : FormApp.getActiveForm();
  try { docProps_().setProperty('fc.lastRun', String(Date.now())); } // heartbeat: proves the trigger fired
  catch (x) { console.error('Form-submit trigger has no document context: ' + x); }
  var lock = getLock_();
  if (!lock.tryLock(30000)) {
    queueRetry_(e.response.getId(), 'Another response was being processed at the same moment.', '');
    return;
  }
  try {
    var cfg = loadConfig_();
    if (!cfg || !cfg.active) return;
    if (!iAmOwner_()) { removeMyTriggers_(form); return; } // another editor took over; stop this copy
    var pro = isPro_();
    if (!pro && !freeFormAllowed_(form.getId())) {
      log_('Skipped', null, { rid: e.response.getId(), msg: 'Paused: the free plan covers one form. Upgrade to use this one too.' });
      return;
    }
    var before = JSON.stringify(cfg.tzCache || {});
    runOne_(form, e.response, cfg, pro, false);
    runRetries_(form, cfg, pro, { max: 5 });
    if (JSON.stringify(cfg.tzCache || {}) !== before) saveConfig_(cfg);
  } catch (err) {
    // Anything outside the per-response pipeline (storage, licence, config) still leaves a trace.
    console.error('handleSubmit failed: ' + ((err && err.stack) || err));
    try {
      queueRetry_(e.response.getId(), String((err && err.message) || err), '');
      log_('Failed', null, { rid: e.response.getId(), msg: String((err && err.message) || err) + ' It will be retried.' });
    } catch (y) { /* storage itself is unavailable */ }
  } finally {
    lock.releaseLock();
  }
}

function getLock_() {
  var l = null;
  try { l = LockService.getDocumentLock(); } catch (e) { l = null; }
  return l || LockService.getUserLock();
}

/** Run the pipeline for one response and record the outcome. Returns the result word. */
function runOne_(form, response, cfg, pro, isRetry) {
  var rid = response.getId();
  try {
    var result = processResponse_(form, response, cfg, pro, isRetry);
    dropRetry_(rid);
    return result;
  } catch (err) {
    var msg = String((err && err.message) || err);
    var who = '';
    try { who = answersFromResponse_(response, form).respondentEmail; } catch (x) { /* ignore */ }
    if ((err && err.isUserError) || (err && err.noRetry)) {
      dropRetry_(rid);
      log_('Failed', null, { rid: rid, who: who, msg: msg });
      alertOwnerOnce_(cfg, [{ who: who, reason: msg }]);
    } else {
      var entry = queueRetry_(rid, msg, who);
      if (!isRetry) {
        log_('Failed', null, { rid: rid, who: who, msg: msg + ' It will be retried.' });
        alertOwnerOnce_(cfg, [{ who: who, reason: msg }]);
      } else if (entry && entry.tries >= RETRY_MAX_) {
        log_('Failed', null, { rid: rid, who: who, msg: 'Gave up after ' + RETRY_MAX_ + ' tries: ' + msg });
      }
    }
    return 'Failed';
  }
}

/** The pipeline. Throws on failure. */
function processResponse_(form, response, cfg, pro, isRetry) {
  var ans = answersFromResponse_(response, form);
  var slotStore = (pro && cfg.pro.slots) ? getJson_('fc.slots', {}) : {};
  var draft = toDraft_(ans, cfg, { pro: pro, slotMap: slotStore.map || {} });

  if (draft.noSlot) {
    log_('Skipped', draft, { msg: 'No time was chosen because no slots were available.' });
    return 'Skipped';
  }

  var target = pro ? route_(draft, cfg) : { calendarId: cfg.calendarId, calendarName: cfg.calendarName, colorId: cfg.colorId };
  var tz = tzFor_(target.calendarId, cfg);
  var times = buildTimes_(draft, tz);
  var info = { when: describeTimes_(times), cal: target.calendarName || target.calendarId };
  var owner = getOwner_();

  // Dedupe: one event per response, ever.
  var existing = findExisting_(cfg, draft.responseId, target.calendarId);
  var canUpdate = pro && cfg.pro.updateOnEdit;
  if (existing && !canUpdate) {
    info.link = existing.event.htmlLink;
    info.msg = 'Already on the calendar. ' + (pro ? 'Turn on "Update the event when a response is edited" to apply edits.' : 'Edited responses update the event on Pro.');
    log_('Skipped', draft, info);
    return 'Skipped';
  }

  // Edited while waiting for approval: refresh the request instead.
  var pendingNow = getPending_(draft.responseId);
  if (pendingNow) {
    savePending_(pendingFromDraft_(draft, target, times, pendingNow.warning || null, pendingNow.submittedAt));
    info.msg = 'Request updated with the edited answers.';
    log_('Waiting for approval', draft, info);
    return 'Waiting for approval';
  }

  var titlePrefix = '';
  if (pro && (cfg.pro.conflict.on || draft.slot)) {
    var c = findConflict_(target.calendarId, times, draft, cfg, tz);
    if (c) {
      var action = cfg.pro.conflict.on ? cfg.pro.conflict.action : 'decline';
      if (action === 'decline') {
        info.msg = (existing ? 'The edit was not applied. ' : 'Not booked. ') + c.reason;
        log_('Conflict', draft, info);
        sendDecline_(draft, cfg, c.reason, info.when, target);
        if (cfg.pro.slots) safeRefreshSlots_(cfg);
        return 'Conflict';
      }
      if (action === 'approval' && !existing) {
        enqueuePending_(draft, target, times, cfg, c.reason, info);
        return 'Waiting for approval';
      }
      titlePrefix = 'Conflict: ';
    }
  }

  if (pro && cfg.pro.approval.on && !existing) {
    enqueuePending_(draft, target, times, cfg, null, info);
    return 'Waiting for approval';
  }

  var out = createOrUpdate_(draft, target, times, cfg, pro, owner, titlePrefix, existing);
  info.link = out.ev.htmlLink;
  info.msg = (titlePrefix ? 'Added with a conflict: check the calendar. ' : '') + (isRetry ? 'Added on retry.' : '');
  log_(out.updated ? 'Updated' : 'Created', draft, info);

  if (pro && cfg.pro.emails.confirm && draft.requesterEmail) sendConfirm_(draft, cfg, out.ev, info.when, target);
  if (pro && cfg.pro.slots) safeRefreshSlots_(cfg);
  return out.updated ? 'Updated' : 'Created';
}

/** Insert (or patch/move an existing event), then verify it is really there. */
function createOrUpdate_(draft, target, times, cfg, pro, ownerEmail, titlePrefix, existing) {
  var body = buildEventBody_(draft, target, times, cfg, pro, ownerEmail, titlePrefix);
  var calId = target.calendarId, ev, updated = false;
  if (existing) {
    var id = existing.event.id;
    if (existing.calendarId !== calId) moveEvent_(existing.calendarId, id, calId);
    ev = patchEvent_(calId, id, body);
    updated = true;
  } else {
    ev = insertEvent_(calId, body);
  }
  try {
    verifyEvent_(calId, ev.id, times);
  } catch (err) {
    var missing = /not on the calendar/.test(String(err.message));
    var e2 = new Error(err.message);
    e2.noRetry = !missing; // a wrong-time event exists; retrying would not fix it
    throw e2;
  }
  return { ev: ev, updated: updated };
}

// ---------------------------------------------------------------------------
// OWNER
// ---------------------------------------------------------------------------

function getOwner_() { return docProps_().getProperty('fc.owner') || ''; }

function myEmail_() {
  var e = '';
  try { e = Session.getEffectiveUser().getEmail(); } catch (x) { e = ''; }
  if (!e) { try { e = Session.getActiveUser().getEmail(); } catch (y) { e = ''; } }
  return String(e || '').toLowerCase();
}

function iAmOwner_() {
  var owner = getOwner_().toLowerCase(), me = myEmail_();
  return !owner || !me || owner === me;
}

function removeMyTriggers_(form) {
  try {
    ScriptApp.getUserTriggers(form).forEach(function (t) {
      if (t.getHandlerFunction() === 'handleSubmit') ScriptApp.deleteTrigger(t);
    });
  } catch (e) { console.error('Could not remove trigger: ' + e); }
}

// ---------------------------------------------------------------------------
// OWNER ALERT (at most one email per day)
// ---------------------------------------------------------------------------

function alertOwnerOnce_(cfg, failures) {
  try {
    var owner = getOwner_();
    if (!owner) return;
    var tz = (cfg && cfg.tz) || Session.getScriptTimeZone();
    var day = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var a = getJson_('fc.alert', {});
    if (a.day === day) return;
    var queued = getJson_('fc.retry', []).map(function (r) { return { who: r.who, reason: r.reason }; });
    var all = (failures || []).concat(queued);
    var seen = {};
    all = all.filter(function (f) { var k = f.who + '|' + f.reason; if (seen[k]) return false; seen[k] = true; return true; });
    if (sendFailureAlert_(owner, all)) putJson_('fc.alert', { day: day });
  } catch (e) { console.error('Owner alert failed: ' + e); }
}

/** Plain-language fix for a failure reason. */
function fixFor_(reason) {
  var r = String(reason || '');
  if (/include the year/i.test(r)) return 'Open the form, click the date question, open its three-dot menu and turn on Include year.';
  if (/before (start|the start)|before start date/i.test(r)) return 'Ask the person to submit again with an end after the start.';
  if (/does not exist on .* clocks/i.test(r)) return 'That time is skipped by the daylight-saving change. Ask the person to choose another time.';
  if (/no longer has access|no longer add events|not found/i.test(r)) return 'Check the calendar still exists and is shared with you with "Make changes to events". It will retry by itself.';
  if (/limit/i.test(r)) return 'Nothing to do: Google resets this limit within a day and it will retry by itself.';
  if (/different time/i.test(r)) return 'Open the event and check its time. Reply to this email if it keeps happening.';
  if (/no date/i.test(r)) return 'Make the date question required, or check the mapping in Edit setup.';
  if (/temporary/i.test(r)) return 'Nothing to do: it will retry by itself.';
  return 'Open the form, Extensions, Form to Calendar Bookings, Open, and check Edit setup.';
}
