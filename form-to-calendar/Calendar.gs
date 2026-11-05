/**
 * Calendar.gs — everything that talks to the Calendar API (Advanced Calendar service).
 *
 * Events are written as JSON with local dateTime text + timeZone, or date for
 * all-day, so no JavaScript Date ever carries a user's wall-clock time.
 */

var COLORS_ = [
  { id: '1', name: 'Lavender', hex: '#7986CB' }, { id: '2', name: 'Sage', hex: '#33B679' },
  { id: '3', name: 'Grape', hex: '#8E24AA' }, { id: '4', name: 'Flamingo', hex: '#E67C73' },
  { id: '5', name: 'Banana', hex: '#F6BF26' }, { id: '6', name: 'Tangerine', hex: '#F4511E' },
  { id: '7', name: 'Peacock', hex: '#039BE5' }, { id: '8', name: 'Graphite', hex: '#616161' },
  { id: '9', name: 'Blueberry', hex: '#3F51B5' }, { id: '10', name: 'Basil', hex: '#0B8043' },
  { id: '11', name: 'Tomato', hex: '#D50000' }
];

/** Calendars the user can add events to: [{ id, name, tz, primary }]. */
function listWritableCalendars_() {
  var out = [], token = null;
  do {
    var page = Calendar.CalendarList.list({ minAccessRole: 'writer', maxResults: 250, pageToken: token, showHidden: false });
    (page.items || []).forEach(function (c) {
      out.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, tz: c.timeZone || '', primary: !!c.primary });
    });
    token = page.nextPageToken;
  } while (token);
  out.sort(function (a, b) { return (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || a.name.localeCompare(b.name); });
  return out;
}

/** The calendar's own time zone. Cached in the config; looked up when missing. */
function tzFor_(calendarId, cfg) {
  if (cfg && cfg.tzCache && cfg.tzCache[calendarId]) return cfg.tzCache[calendarId];
  if (cfg && calendarId === cfg.calendarId && cfg.tz) return cfg.tz;
  var tz = '';
  try { tz = Calendar.Calendars.get(calendarId).timeZone; } catch (e) {
    throw new Error(describeApiError_(e, calendarId));
  }
  if (!tz) throw new Error('Google Calendar did not report a time zone for this calendar.');
  if (cfg) { cfg.tzCache = cfg.tzCache || {}; cfg.tzCache[calendarId] = tz; }
  return tz;
}

/** Draft + target + times -> Calendar API event resource. Pure. */
function buildEventBody_(draft, target, times, cfg, pro, ownerEmail, titlePrefix) {
  var body = {
    summary: (titlePrefix || '') + draft.title,
    start: times.start,
    end: times.end,
    extendedProperties: { private: { fcResponseId: String(draft.responseId), fcFormId: String(draft.formId || '') } }
  };
  if (draft.location) body.location = draft.location;
  if (draft.description) body.description = draft.description;
  var guests = (draft.guests || []).slice();
  if (draft.addOwner && ownerEmail && guests.indexOf(ownerEmail.toLowerCase()) < 0) guests.push(ownerEmail.toLowerCase());
  if (guests.length) body.attendees = guests.map(function (e) { return { email: e }; });
  var color = target.colorId || cfg.colorId;
  if (color) body.colorId = String(color);
  if (draft.slot) body.extendedProperties['private'].fcSlot = draft.slot.k;
  if (pro && cfg.pro.reminders && cfg.pro.reminders.length) {
    body.reminders = { useDefault: false, overrides: cfg.pro.reminders.map(function (r) { return { method: r.method, minutes: r.minutes }; }) };
  }
  if (pro && cfg.pro.meet) {
    body.conferenceData = { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  return body;
}

function insertEvent_(calendarId, body) {
  try {
    return Calendar.Events.insert(body, calendarId, {
      sendUpdates: body.attendees ? 'all' : 'none',
      conferenceDataVersion: body.conferenceData ? 1 : 0
    });
  } catch (e) { throw new Error(describeApiError_(e, calendarId)); }
}

function patchEvent_(calendarId, eventId, body) {
  try {
    var patch = JSON.parse(JSON.stringify(body));
    if (patch.conferenceData) delete patch.conferenceData; // keep the existing Meet link
    return Calendar.Events.patch(patch, calendarId, eventId, {
      sendUpdates: patch.attendees ? 'all' : 'none', conferenceDataVersion: 1
    });
  } catch (e) { throw new Error(describeApiError_(e, calendarId)); }
}

function moveEvent_(fromCalendarId, eventId, toCalendarId) {
  try { return Calendar.Events.move(fromCalendarId, eventId, toCalendarId, { sendUpdates: 'none' }); }
  catch (e) { throw new Error(describeApiError_(e, toCalendarId)); }
}

function getEvent_(calendarId, eventId) {
  try { return Calendar.Events.get(calendarId, eventId); } catch (e) { return null; }
}

/** Re-read the event and compare times. Throws when it is missing or wrong. */
function verifyEvent_(calendarId, eventId, times) {
  var ev = getEvent_(calendarId, eventId);
  if (!ev || ev.status === 'cancelled') {
    throw new Error('Google Calendar reported the event as created, but it is not on the calendar.');
  }
  var want = timesKey_(times);
  if (apiTimeKey_(ev.start) !== want.s || apiTimeKey_(ev.end) !== want.e) {
    throw new Error('The event was created at a different time than requested. It has been left on the calendar for you to check.');
  }
  return ev;
}

/** The event made from this response, if any. */
function findByResponse_(calendarId, responseId) {
  try {
    var res = Calendar.Events.list(calendarId, {
      privateExtendedProperty: 'fcResponseId=' + responseId, showDeleted: false, maxResults: 5, singleEvents: true
    });
    var items = (res.items || []).filter(function (e) { return e.status !== 'cancelled'; });
    return items[0] || null;
  } catch (e) { throw new Error(describeApiError_(e, calendarId)); }
}

/** Look for this response's event on every calendar the config can write to. */
function findExisting_(cfg, responseId, preferredCalendarId) {
  var cals = [preferredCalendarId, cfg.calendarId].concat((cfg.pro.routes || []).map(function (r) { return r.calendarId; }));
  var seen = {};
  for (var i = 0; i < cals.length; i++) {
    var c = cals[i];
    if (!c || seen[c]) continue;
    seen[c] = true;
    var ev = findByResponse_(c, responseId);
    if (ev) return { calendarId: c, event: ev };
  }
  return null;
}

/** All events overlapping [minMs, maxMs). */
function listEvents_(calendarId, minMs, maxMs) {
  var out = [], token = null, guard = 0;
  do {
    var page;
    try {
      page = Calendar.Events.list(calendarId, {
        timeMin: new Date(minMs).toISOString(), timeMax: new Date(maxMs).toISOString(),
        singleEvents: true, showDeleted: false, maxResults: 2500, pageToken: token
      });
    } catch (e) { throw new Error(describeApiError_(e, calendarId)); }
    out = out.concat(page.items || []);
    token = page.nextPageToken;
  } while (token && ++guard < 10);
  return out;
}

/** Event resource -> { startMs, endMs, allDay } in the given zone. */
function eventSpan_(ev, tz) {
  if (ev.start && ev.start.date) {
    return { allDay: true, startMs: dayStartMs_(ev.start.date, tz), endMs: dayStartMs_(ev.end.date, tz) };
  }
  return { allDay: false, startMs: new Date(ev.start.dateTime).getTime(), endMs: new Date(ev.end.dateTime).getTime() };
}

/**
 * Pure conflict filter: does any event block [times]?
 * Ignores cancelled, free ('transparent') events, the same response's own event,
 * and all-day events unless the request itself is all-day.
 * Slot bookings count events with the same fcSlot against capacity instead.
 */
function conflictsAmong_(events, times, draft, tz, capacity) {
  var blocking = [], sameSlot = 0;
  events.forEach(function (ev) {
    if (!ev || ev.status === 'cancelled' || ev.transparency === 'transparent') return;
    var priv = (ev.extendedProperties && ev.extendedProperties['private']) || {};
    if (priv.fcResponseId && String(priv.fcResponseId) === String(draft.responseId)) return;
    if (draft.slot && priv.fcSlot && priv.fcSlot === draft.slot.k) { sameSlot++; return; }
    var span = eventSpan_(ev, tz);
    if (span.allDay && !times.allDay) return;
    if (span.startMs < times.endMs && span.endMs > times.startMs) blocking.push(ev);
  });
  if (draft.slot && sameSlot >= (capacity || 1)) return { reason: 'That time is fully booked.', events: [] };
  if (blocking.length) {
    return { reason: 'It overlaps \'' + (blocking[0].summary || 'Busy') + '\'' + (blocking.length > 1 ? ' and ' + (blocking.length - 1) + ' more' : '') + '.', events: blocking };
  }
  return null;
}

/** Pending holds on the same calendar that overlap. Pure. */
function pendingConflicts_(pendings, calendarId, times, draft, capacity) {
  var same = 0, overlap = null;
  pendings.forEach(function (p) {
    if (!p || p.calendarId !== calendarId || String(p.responseId) === String(draft.responseId)) return;
    if (draft.slot && p.slotKey && p.slotKey === draft.slot.k) { same++; return; }
    if (p.startMs < times.endMs && p.endMs > times.startMs && (times.allDay || !p.allDay)) overlap = p;
  });
  if (draft.slot && same >= (capacity || 1)) return { reason: 'That time is held by a request waiting for approval.' };
  if (overlap) return { reason: 'It overlaps a request waiting for approval (\'' + overlap.title + '\').' };
  return null;
}

/** Full conflict check against the calendar and the approval queue. */
function findConflict_(calendarId, times, draft, cfg, tz) {
  var cap = (cfg.pro.slots && cfg.pro.slots.capacity) || 1;
  var c = conflictsAmong_(listEvents_(calendarId, times.startMs, times.endMs), times, draft, tz, cap);
  if (c) return c;
  return pendingConflicts_(listPending_(), calendarId, times, draft, cap);
}

/** Calendar API error -> plain words. */
function describeApiError_(e, calendarId) {
  var raw = String((e && e.message) || e);
  if (/not ?found|404/i.test(raw)) return 'The calendar ' + (calendarId || '') + ' was not found, or this account no longer has access to it.';
  if (/forbidden|403|writer access|insufficient/i.test(raw) && !/limit|quota/i.test(raw)) {
    return 'This account can no longer add events to the calendar ' + (calendarId || '') + '. Ask its owner to share it with "Make changes to events".';
  }
  if (/usage limit|quota|rate ?limit|too many/i.test(raw)) return 'Google\'s calendar limit for this account was reached. It will be retried automatically.';
  if (/invitation|attendee/i.test(raw) && /limit/i.test(raw)) return 'Google\'s daily limit on guest invitations was reached. It will be retried automatically.';
  if (/backend|internal|503|500|timed? ?out/i.test(raw)) return 'Google Calendar had a temporary problem. It will be retried automatically.';
  return 'Google Calendar said: ' + raw.slice(0, 300);
}
