/**
 * Approvals.gs — requests that wait for a yes/no before reaching the calendar.
 *
 * Stored as Document Property fc.pending.<responseId>. Public functions here are
 * thin, validated wrappers; anything that changes approval state ends in _.
 */

function pendingKey_(responseId) { return 'fc.pending.' + responseId; }

function pendingFromDraft_(draft, target, times, warning, submittedAt) {
  return {
    responseId: String(draft.responseId),
    formId: draft.formId || '',
    title: draft.title,
    location: draft.location || '',
    description: draft.description || '',
    guests: draft.guests || [],
    addOwner: !!draft.addOwner,
    requesterEmail: draft.requesterEmail || '',
    respondentLabel: draft.respondentLabel || '',
    answers: (draft.answers || []).slice(0, 40),
    calendarId: target.calendarId,
    calendarName: target.calendarName || target.calendarId,
    colorId: target.colorId || null,
    times: { allDay: times.allDay, start: times.start, end: times.end, startMs: times.startMs, endMs: times.endMs, tz: times.tz },
    startMs: times.startMs,
    endMs: times.endMs,
    allDay: times.allDay,
    when: describeTimes_(times),
    slot: draft.slot || null,
    slotKey: draft.slot ? draft.slot.k : null,
    warning: warning || null,
    submittedAt: submittedAt || Date.now()
  };
}

function savePending_(p) { putJson_(pendingKey_(p.responseId), p); }
function getPending_(responseId) { return getJson_(pendingKey_(responseId), null); }
function deletePending_(responseId) { putJson_(pendingKey_(responseId), null); }

/** Every pending request, oldest first. */
function listPending_() {
  var props = docProps_();
  var all = props.getProperties();
  var out = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('fc.pending.') !== 0 || k.indexOf('#') >= 0) return;
    var p = getJson_(k, null, props);
    if (p) out.push(p);
  });
  out.sort(function (a, b) { return a.submittedAt - b.submittedAt; });
  return out;
}

function enqueuePending_(draft, target, times, cfg, warning, info) {
  var p = pendingFromDraft_(draft, target, times, warning, Date.now());
  savePending_(p);
  info = info || {};
  info.msg = warning ? 'Conflict: ' + warning : '';
  log_('Waiting for approval', draft, info);
  notifyApprovers_(p, cfg);
  if (cfg.pro.slots) safeRefreshSlots_(cfg); // the hold removes the slot from the form
}

/** Draft-shaped object from a pending entry, for createOrUpdate_. */
function draftFromPending_(p) {
  return {
    responseId: p.responseId, formId: p.formId, title: p.title, location: p.location,
    description: p.description, guests: p.guests, addOwner: p.addOwner, slot: p.slot,
    requesterEmail: p.requesterEmail, respondentLabel: p.respondentLabel, answers: p.answers
  };
}

// ---------------------------------------------------------------------------
// PUBLIC (called from the sidebar)
// ---------------------------------------------------------------------------

/** Pending requests for the Requests view, with a live conflict check. */
function getRequests() {
  assertEditor_();
  var cfg = loadConfig_();
  var list = listPending_();
  return list.map(function (p, i) {
    var conflict = p.warning || null;
    if (cfg && i < 15) {
      try {
        var c = conflictsAmong_(listEvents_(p.calendarId, p.startMs, p.endMs), p.times, draftFromPending_(p), p.times.tz,
          (cfg.pro.slots && cfg.pro.slots.capacity) || 1);
        conflict = c ? c.reason : null;
      } catch (e) { /* keep stored warning */ }
    }
    return {
      id: p.responseId, title: p.title, when: p.when, calendar: p.calendarName,
      requester: p.requesterEmail || p.respondentLabel || 'Anonymous', answers: p.answers,
      conflict: conflict, submitted: Utilities.formatDate(new Date(p.submittedAt), (cfg && cfg.tz) || Session.getScriptTimeZone(), 'd MMM, h:mm a')
    };
  });
}

function approveRequest(responseId, force) {
  assertEditor_();
  return approve_(String(responseId), !!force);
}

function declineRequest(responseId, reason) {
  assertEditor_();
  return decline_(String(responseId), String(reason || '').slice(0, 1000));
}

// ---------------------------------------------------------------------------
// PRIVATE
// ---------------------------------------------------------------------------

function approve_(responseId, force) {
  var lock = getLock_();
  if (!lock.tryLock(20000)) return { ok: false, msg: 'Another response is being processed. Try again in a moment.' };
  try {
    var p = getPending_(responseId);
    if (!p) return { ok: false, msg: 'This request was already handled.' };
    var cfg = loadConfig_();
    var draft = draftFromPending_(p);
    var times = p.times;
    if (!force && (cfg.pro.conflict.on || p.slot)) {
      var cap = (cfg.pro.slots && cfg.pro.slots.capacity) || 1;
      var c = conflictsAmong_(listEvents_(p.calendarId, p.startMs, p.endMs), times, draft, times.tz, cap) ||
        pendingConflicts_(listPending_(), p.calendarId, times, draft, cap);
      if (c) return { ok: false, conflict: c.reason, msg: 'This time now conflicts. ' + c.reason + ' Approve anyway?' };
    }
    var target = { calendarId: p.calendarId, calendarName: p.calendarName, colorId: p.colorId };
    var out;
    try {
      // Requests only exist on Pro, so Pro event options (Meet, reminders) apply even if a licence lapsed since.
      out = createOrUpdate_(draft, target, times, cfg, true, getOwner_(), '', null);
    } catch (err) {
      var m = String(err.message || err);
      if (/no longer add events|not found/i.test(m)) {
        m = 'You can\'t add events to ' + p.calendarName + '. Ask ' + (getOwner_() || 'the person who turned this on') +
          ' to approve it, or ask them to share the calendar with you with "Make changes to events".';
      }
      return { ok: false, msg: m };
    }
    deletePending_(responseId);
    log_('Approved', draft, { when: p.when, cal: p.calendarName, link: out.ev.htmlLink, msg: 'Approved by ' + myEmail_() });
    if (draft.requesterEmail) sendApproved_(p, cfg, out.ev);
    if (cfg.pro.slots) safeRefreshSlots_(cfg);
    return { ok: true, link: out.ev.htmlLink };
  } finally { lock.releaseLock(); }
}

function decline_(responseId, reason) {
  var lock = getLock_();
  if (!lock.tryLock(20000)) return { ok: false, msg: 'Another response is being processed. Try again in a moment.' };
  try {
    var p = getPending_(responseId);
    if (!p) return { ok: false, msg: 'This request was already handled.' };
    var cfg = loadConfig_();
    deletePending_(responseId);
    log_('Declined', draftFromPending_(p), { when: p.when, cal: p.calendarName, msg: (reason ? 'Reason: ' + reason + '. ' : '') + 'Declined by ' + myEmail_() });
    if (p.requesterEmail) sendDeclinedByOwner_(p, cfg, reason);
    if (cfg.pro.slots) safeRefreshSlots_(cfg); // frees the held slot
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/** Only editors of this form (or the owner) may approve or decline. */
function assertEditor_() {
  var me = '';
  try { me = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { me = ''; }
  if (!me) throw new Error('Sign in to approve requests.');
  if (me === getOwner_().toLowerCase()) return true;
  var form = FormApp.getActiveForm();
  var editors = [];
  try { editors = form.getEditors().map(function (u) { return String(u.getEmail()).toLowerCase(); }); } catch (e) { editors = []; }
  if (editors.indexOf(me) >= 0) return true;
  var cfg = loadConfig_();
  var notify = (cfg && cfg.pro.approval.notify || []).map(function (s) { return String(s).toLowerCase(); });
  if (notify.indexOf(me) >= 0) return true;
  throw new Error('Only editors of this form can approve or decline requests.');
}
