/**
 * Mapper.gs — FormResponse -> plain answers -> event draft.
 *
 * answersFromResponse_ is the only function here that touches FormApp.
 * Everything else is pure, so EngineTests.gs can feed it fake answers.
 */

var NO_SLOTS_CHOICE_ = 'No times available, please check back';

/** FormResponse -> { responseId, formId, formTitle, timestamp, respondentEmail, byId, list }. */
function answersFromResponse_(response, form) {
  var out = {
    responseId: response.getId(),
    formId: form ? form.getId() : '',
    formTitle: form ? form.getTitle() : '',
    timestamp: response.getTimestamp() ? response.getTimestamp().getTime() : Date.now(),
    respondentEmail: '',
    byId: {},
    list: []
  };
  try { out.respondentEmail = String(response.getRespondentEmail() || '').trim(); } catch (e) { /* not collected */ }
  response.getItemResponses().forEach(function (ir) {
    var item = ir.getItem();
    var v = ir.getResponse();
    var entry = { id: item.getId(), title: item.getTitle(), type: String(item.getType()), value: normalizeValue_(v) };
    out.byId[entry.id] = entry;
    out.list.push(entry);
  });
  return out;
}

/** Arrays stay arrays (checkboxes); grids become 'row: answer' text; everything else a string. */
function normalizeValue_(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) {
    if (v.length && Array.isArray(v[0])) return v.map(function (row) { return (row || []).join(', '); }).join('; ');
    return v.map(String);
  }
  return String(v);
}

/** Display text for one answer, with dates written out. */
function answerText_(entry) {
  if (!entry) return '';
  var v = entry.value;
  if (Array.isArray(v)) return v.join(', ');
  v = String(v || '');
  try {
    if (entry.type === 'DATE') {
      var d = parseDateAnswer_(v, entry.title);
      return d ? prettyYmd_(d.date) : '';
    }
    if (entry.type === 'DATETIME') {
      var dt = parseDateAnswer_(v, entry.title);
      return dt ? prettyYmd_(dt.date) + (dt.time ? ', ' + dt.time : '') : '';
    }
  } catch (e) { return v; }
  return v;
}

/** Fill {{Question title}} tokens. extra = { 'event time': '...', ... } */
function fillTemplate_(tpl, ans, extra) {
  var map = {};
  (ans.list || []).forEach(function (e) { map[tokenKey_(e.title)] = answerText_(e); });
  map['respondent email'] = ans.respondentEmail || '';
  if (!('email' in map)) map['email'] = ans.respondentEmail || '';
  map['form title'] = ans.formTitle || '';
  map['submitted'] = ans.timestamp ? new Date(ans.timestamp).toISOString().slice(0, 10) : '';
  Object.keys(extra || {}).forEach(function (k) { map[tokenKey_(k)] = extra[k]; });
  return String(tpl || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (m, name) {
    var k = tokenKey_(name);
    return k in map ? map[k] : '';
  });
}

function emailsIn_(value) {
  var arr = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
  return arr.map(function (s) { return String(s).trim(); }).filter(isEmail_);
}

/**
 * Answers + config -> draft. Pure.
 * opts = { pro: bool, slotMap: { choiceText: { s, e, k } } }
 */
function toDraft_(ans, cfg, opts) {
  opts = opts || {};
  var d = {
    responseId: ans.responseId,
    formId: ans.formId,
    startDate: null, startTime: null, endDate: null, endTime: null, minutes: null,
    slot: null, noSlot: false,
    title: '', location: '', description: '',
    guests: [], addOwner: !!(cfg.guests && cfg.guests.addOwner),
    requesterEmail: '', respondentLabel: '',
    answers: (ans.list || []).map(function (e) { return { t: e.title, v: String(answerText_(e)).slice(0, 500) }; }),
    ans: ans
  };
  var get = function (itemId) { return itemId ? ans.byId[itemId] : null; };

  var slots = opts.pro && cfg.pro && cfg.pro.slots;
  if (slots) {
    var se = get(slots.itemId);
    var text = se ? String(Array.isArray(se.value) ? se.value[0] : se.value).trim() : '';
    if (!text || text === NO_SLOTS_CHOICE_) {
      d.noSlot = true;
    } else {
      var slot = (opts.slotMap && opts.slotMap[text]) || parseSlotText_(text);
      if (!slot) throw new UserError_('The time \'' + text + '\' is not a bookable slot, so no event was created.');
      d.slot = slot;
      var sp = slot.s.split('T'), ep = slot.e.split('T');
      d.startDate = sp[0]; d.startTime = sp[1].slice(0, 5); d.endDate = ep[0]; d.endTime = ep[1].slice(0, 5);
    }
  } else {
    var de = get(cfg.startDate.itemId);
    var parsed = de ? parseDateAnswer_(de.value, de.title) : null;
    if (!parsed) throw new UserError_('This response has no date, so no event was created.');
    d.startDate = parsed.date;
    d.startTime = parsed.time;
    if (!d.startTime && cfg.startTime.itemId) {
      var te = get(cfg.startTime.itemId);
      d.startTime = te ? parseTimeAnswer_(te.value, te.title) : null; // blank -> all-day
    }
    var mode = cfg.end.mode;
    var fallback = Number(cfg.end.minutes) > 0 ? Number(cfg.end.minutes) : 60;
    var ee = get(cfg.end.itemId);
    if (mode === 'fixed') {
      d.minutes = fallback;
    } else if (mode === 'duration') {
      d.minutes = (ee ? parseDurationAnswer_(ee.value, ee.title) : null) || fallback;
    } else if (mode === 'endTime') {
      if (ee && ee.type === 'DATETIME') {
        var edt = parseDateAnswer_(ee.value, ee.title);
        if (edt) { d.endDate = edt.date; d.endTime = edt.time; }
      } else if (ee) {
        d.endTime = parseTimeAnswer_(ee.value, ee.title);
      }
      if (!d.endTime) d.minutes = fallback;
    } else if (mode === 'endDate') {
      var ed = ee ? parseDateAnswer_(ee.value, ee.title) : null;
      d.endDate = ed ? ed.date : null;
      d.startTime = null; // end-date events are all-day
    }
  }

  d.title = fillTemplate_(cfg.title, ans).replace(/\s+/g, ' ').trim().slice(0, 1000) || ans.formTitle || 'Form response';
  d.location = fillTemplate_(cfg.location, ans).trim().slice(0, 1000);
  d.description = fillTemplate_(cfg.description, ans).trim().slice(0, 8000);

  var g = cfg.guests || {};
  if (g.source === 'respondent' && isEmail_(ans.respondentEmail)) d.guests.push(ans.respondentEmail.toLowerCase());
  if (g.source === 'item') {
    var ge = get(g.itemId);
    if (ge) emailsIn_(ge.value).forEach(function (e) { d.guests.push(e.toLowerCase()); });
  }
  d.guests = d.guests.filter(function (e, i, a) { return a.indexOf(e) === i; }).slice(0, 50);

  d.requesterEmail = isEmail_(ans.respondentEmail) ? ans.respondentEmail : (d.guests[0] || '');
  var nameEntry = (ans.list || []).filter(function (e) { return e.type === 'TEXT' && /name/i.test(e.title) && e.value; })[0];
  d.respondentLabel = (nameEntry && String(nameEntry.value).slice(0, 80)) || d.requesterEmail || 'Anonymous';
  return d;
}

/** First matching routing rule wins, otherwise the default calendar. Pure. */
function route_(draft, cfg) {
  var routes = (cfg.pro && cfg.pro.routes) || [];
  for (var i = 0; i < routes.length; i++) {
    var r = routes[i];
    var e = draft.ans && draft.ans.byId[r.itemId];
    if (!e) continue;
    var want = tokenKey_(r.equals);
    var vals = Array.isArray(e.value) ? e.value : [e.value];
    var hit = vals.some(function (v) { return tokenKey_(v) === want; });
    if (hit) return { calendarId: r.calendarId, calendarName: r.calendarName || r.calendarId, colorId: r.colorId || cfg.colorId || null, route: i };
  }
  return { calendarId: cfg.calendarId, calendarName: cfg.calendarName || cfg.calendarId, colorId: cfg.colorId || null, route: -1 };
}

/**
 * Fallback for a slot choice that is no longer in fc.slots (the respondent loaded
 * the form before the choices were refreshed): 'Tue 14 Nov 2026, 10:00–10:30'.
 */
function parseSlotText_(text) {
  var m = /^(?:[A-Za-z]{3}\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s*(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!m) return null;
  var mon = MONTHS_.indexOf(m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase());
  if (mon < 0) return null;
  var ymd = m[3] + '-' + pad2_(mon + 1) + '-' + pad2_(m[1]);
  if (!isValidYmd_(ymd)) return null;
  var st = pad2_(m[4]) + ':' + m[5], et = pad2_(m[6]) + ':' + m[7];
  var endYmd = et <= st ? addDays_(ymd, 1) : ymd;
  return { s: ymd + 'T' + st + ':00', e: endYmd + 'T' + et + ':00', k: ymd + 'T' + st + ':00' };
}
