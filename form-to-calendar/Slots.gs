/**
 * Slots.gs — bookable time slots (Pro).
 *
 * Rules: { itemId, weekdays:[1..7], from:'09:00', to:'17:00', minutes, bufferMinutes,
 *          daysAhead, minNoticeHours, capacity }
 * Choices are written as 'Tue 17 Nov 2026, 10:00–10:30' in the calendar's zone.
 * fc.slots = { at: ms, map: { choiceText: { s, e, k } } } so submit never parses dates.
 */

var SLOT_CHOICE_CAP_ = 200;

function hmToMin_(hm) { var p = hm.split(':').map(Number); return p[0] * 60 + p[1]; }
function minToHm_(m) { return pad2_(Math.floor(m / 60)) + ':' + pad2_(m % 60); }

/** Pure: open slots given busy events and pending holds. */
function generateSlots_(rules, tz, nowMs, events, pendings, calendarId) {
  var today = Utilities.formatDate(new Date(nowMs), tz, 'yyyy-MM-dd');
  var earliest = nowMs + (rules.minNoticeHours || 0) * 3600000;
  var step = rules.minutes + (rules.bufferMinutes || 0);
  var fromMin = hmToMin_(rules.from), toMin = hmToMin_(rules.to);
  var out = [];
  for (var i = 0; i <= rules.daysAhead && out.length < SLOT_CHOICE_CAP_; i++) {
    var ymd = addDays_(today, i);
    if (rules.weekdays.indexOf(weekdayIso_(ymd)) < 0) continue;
    for (var m = fromMin; m + rules.minutes <= toMin && out.length < SLOT_CHOICE_CAP_; m += step) {
      var st = minToHm_(m), et = minToHm_(m + rules.minutes);
      var times;
      try { times = buildTimes_({ startDate: ymd, startTime: st, endTime: et }, tz); } catch (e) { continue; } // DST gap
      if (times.startMs < earliest) continue;
      var slot = { s: ymd + 'T' + st + ':00', e: ymd + 'T' + et + ':00', k: ymd + 'T' + st + ':00' };
      var probe = { responseId: '__slot__', slot: slot };
      if (conflictsAmong_(events, times, probe, tz, rules.capacity)) continue;
      if (pendingConflicts_(pendings, calendarId, times, probe, rules.capacity)) continue;
      out.push({ text: prettyYmd_(ymd) + ', ' + st + '–' + et, s: slot.s, e: slot.e, k: slot.k });
    }
  }
  return out;
}

/** Recompute open slots and write them to the slot question. */
function refreshSlots_(cfg, form) {
  var rules = cfg.pro.slots;
  if (!rules) return null;
  form = form || FormApp.getActiveForm();
  var tz = tzFor_(cfg.calendarId, cfg);
  var now = Date.now();
  var horizon = now + (rules.daysAhead + 2) * 86400000;
  var events = listEvents_(cfg.calendarId, now, horizon);
  var slots = generateSlots_(rules, tz, now, events, listPending_(), cfg.calendarId);
  var texts = slots.length ? slots.map(function (s) { return s.text; }) : [NO_SLOTS_CHOICE_];
  writeChoices_(form, rules.itemId, texts);
  var map = {};
  slots.forEach(function (s) { map[s.text] = { s: s.s, e: s.e, k: s.k }; });
  putJson_('fc.slots', { at: now, map: map });
  return { count: slots.length, first: texts[0], last: texts[texts.length - 1] };
}

function writeChoices_(form, itemId, texts) {
  var item = form.getItemById(itemId);
  if (!item) throw new UserError_('The bookable time slots question was deleted. Pick another in Edit setup.');
  var type = String(item.getType());
  var typed = type === 'MULTIPLE_CHOICE' ? item.asMultipleChoiceItem() : type === 'LIST' ? item.asListItem() : null;
  if (!typed) throw new UserError_('The bookable time slots question must be multiple choice or a dropdown.');
  var current = typed.getChoices().map(function (c) { return c.getValue(); });
  if (current.join('\n') === texts.join('\n')) return;
  typed.setChoiceValues(texts);
}

/** Never lets a slot refresh break the submission that triggered it. */
function safeRefreshSlots_(cfg) {
  try { return refreshSlots_(cfg); } catch (e) {
    log_('Failed', null, { msg: 'Could not refresh time slots: ' + (e.message || e) });
    return null;
  }
}

/** Sidebar open: refresh if older than 10 minutes (keeps slots current without an hourly trigger). */
function maybeRefreshSlots_(cfg) {
  var s = getJson_('fc.slots', {});
  if (s.at && Date.now() - s.at < 10 * 60 * 1000) return null;
  return safeRefreshSlots_(cfg);
}
