/**
 * Config.gs — storage helpers, the form's configuration, and validation
 * against the current question list.
 *
 * Form Document Properties (shared by every editor of this form):
 *   fc.config            JSON mapping and options
 *   fc.owner             email of the user whose trigger runs
 *   fc.pending.<respId>  one per request waiting for approval
 *   fc.retry             failed creates waiting to be retried
 *   fc.slots             choice text -> slot start/end
 *   fc.log               last 200 actions
 *   fc.health            last success, last error
 *   fc.alert             day the owner was last alerted
 *
 * Property values are capped at 9 KB, so anything that can grow is chunked
 * by putJson_/getJson_.
 */

var CHUNK_CHARS_ = 3000; // 3,000 chars x up to 3 bytes each stays under the 9 KB value cap

function docProps_() { return PropertiesService.getDocumentProperties(); }
function userProps_() { return PropertiesService.getUserProperties(); }

/** Store any JSON value, splitting it across keys when it is large. */
function putJson_(key, value, props) {
  props = props || docProps_();
  var old = props.getProperty(key);
  var oldChunks = 0;
  if (old && old.indexOf('{"__chunks":') === 0) {
    try { oldChunks = JSON.parse(old).__chunks; } catch (e) { oldChunks = 0; }
  }
  if (value === null || value === undefined) {
    props.deleteProperty(key);
    for (var k = 0; k < oldChunks; k++) props.deleteProperty(key + '#' + k);
    return;
  }
  var s = JSON.stringify(value);
  var batch = {};
  var n = 0;
  if (s.length <= CHUNK_CHARS_) {
    batch[key] = s;
  } else {
    for (var i = 0; i < s.length; i += CHUNK_CHARS_) {
      batch[key + '#' + n] = s.slice(i, i + CHUNK_CHARS_);
      n++;
    }
    batch[key] = JSON.stringify({ __chunks: n });
  }
  props.setProperties(batch, false);
  for (var j = n; j < oldChunks; j++) props.deleteProperty(key + '#' + j);
}

/** Read a value written by putJson_. */
function getJson_(key, fallback, props) {
  props = props || docProps_();
  var s = props.getProperty(key);
  if (s == null || s === '') return fallback;
  try {
    if (s.indexOf('{"__chunks":') === 0) {
      var n = JSON.parse(s).__chunks, parts = [];
      for (var i = 0; i < n; i++) parts.push(props.getProperty(key + '#' + i) || '');
      s = parts.join('');
    }
    return JSON.parse(s);
  } catch (e) {
    console.error('Could not read ' + key + ': ' + e);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

function defaultConfig_() {
  return {
    version: 1,
    active: false,
    calendarId: '',
    calendarName: '',
    tz: '',
    tzCache: {},
    title: '',
    startDate: { itemId: null },
    startTime: { itemId: null },
    end: { mode: 'fixed', minutes: 60, itemId: null },
    location: '',
    description: '',
    guests: { source: 'none', itemId: null, addOwner: false },
    colorId: null,
    pro: {
      conflict: { on: false, action: 'decline' },
      approval: { on: false, notify: [] },
      routes: [],
      updateOnEdit: false,
      meet: false,
      reminders: [],
      slots: null,
      emails: { confirm: null, decline: null }
    }
  };
}

/** Deep-merge saved values over defaults so older configs gain new fields. */
function withDefaults_(cfg) {
  var d = defaultConfig_();
  if (!cfg) return d;
  function merge(base, over) {
    if (over === undefined) return base;
    if (base === null || typeof base !== 'object' || Array.isArray(base)) return over;
    if (over === null || typeof over !== 'object' || Array.isArray(over)) return over;
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = merge(base[k], over[k]); });
    Object.keys(over).forEach(function (k) { if (!(k in out)) out[k] = over[k]; });
    return out;
  }
  return merge(d, cfg);
}

function loadConfig_() {
  var cfg = getJson_('fc.config', null);
  return cfg ? withDefaults_(cfg) : null;
}

function saveConfig_(cfg) {
  putJson_('fc.config', cleanConfig_(cfg));
}

/** Keep only known shapes and sane values; protects against a tampered client. */
function cleanConfig_(raw) {
  var c = withDefaults_(raw);
  function id(v) { return v === null || v === undefined || v === '' ? null : Number(v); }
  function str(v, max) { return String(v == null ? '' : v).slice(0, max || 2000); }
  function num(v, lo, hi, dflt) { v = Number(v); if (!isFinite(v)) return dflt; return Math.max(lo, Math.min(hi, Math.round(v))); }
  var out = defaultConfig_();
  out.active = !!c.active;
  out.calendarId = str(c.calendarId, 300);
  out.calendarName = str(c.calendarName, 300);
  out.tz = str(c.tz, 100);
  out.tzCache = {};
  Object.keys(c.tzCache || {}).slice(0, 50).forEach(function (k) { out.tzCache[str(k, 300)] = str(c.tzCache[k], 100); });
  out.title = str(c.title, 1000);
  out.startDate = { itemId: id(c.startDate && c.startDate.itemId) };
  out.startTime = { itemId: id(c.startTime && c.startTime.itemId) };
  var mode = ['fixed', 'duration', 'endTime', 'endDate'].indexOf(c.end && c.end.mode) >= 0 ? c.end.mode : 'fixed';
  out.end = { mode: mode, minutes: num(c.end && c.end.minutes, 1, 60 * 24 * 14, 60), itemId: id(c.end && c.end.itemId) };
  out.location = str(c.location, 1000);
  out.description = str(c.description, 6000);
  var src = ['none', 'respondent', 'item'].indexOf(c.guests && c.guests.source) >= 0 ? c.guests.source : 'none';
  out.guests = { source: src, itemId: id(c.guests && c.guests.itemId), addOwner: !!(c.guests && c.guests.addOwner) };
  out.colorId = c.colorId && /^\d{1,2}$/.test(String(c.colorId)) ? String(c.colorId) : null;

  var p = c.pro || {};
  var action = ['decline', 'approval', 'flag'].indexOf(p.conflict && p.conflict.action) >= 0 ? p.conflict.action : 'decline';
  out.pro.conflict = { on: !!(p.conflict && p.conflict.on), action: action };
  out.pro.approval = {
    on: !!(p.approval && p.approval.on),
    notify: ((p.approval && p.approval.notify) || []).map(function (e) { return str(e, 200).trim(); })
      .filter(function (e) { return e === 'owner' || isEmail_(e); }).slice(0, 10)
  };
  out.pro.routes = (p.routes || []).slice(0, 25).map(function (r) {
    return { itemId: id(r.itemId), equals: str(r.equals, 500), calendarId: str(r.calendarId, 300),
      calendarName: str(r.calendarName, 300), colorId: r.colorId && /^\d{1,2}$/.test(String(r.colorId)) ? String(r.colorId) : null };
  }).filter(function (r) { return r.itemId && r.calendarId; });
  out.pro.updateOnEdit = !!p.updateOnEdit;
  out.pro.meet = !!p.meet;
  out.pro.reminders = (p.reminders || []).slice(0, 5).map(function (r) {
    return { method: r.method === 'email' ? 'email' : 'popup', minutes: num(r.minutes, 0, 40320, 30) };
  });
  if (p.slots && p.slots.itemId) {
    var s = p.slots;
    out.pro.slots = {
      itemId: id(s.itemId),
      weekdays: (s.weekdays || [1, 2, 3, 4, 5]).map(Number).filter(function (w) { return w >= 1 && w <= 7; }),
      from: /^\d{2}:\d{2}$/.test(s.from) ? s.from : '09:00',
      to: /^\d{2}:\d{2}$/.test(s.to) ? s.to : '17:00',
      minutes: num(s.minutes, 5, 720, 30),
      bufferMinutes: num(s.bufferMinutes, 0, 240, 0),
      daysAhead: num(s.daysAhead, 1, 90, 14),
      minNoticeHours: num(s.minNoticeHours, 0, 720, 12),
      capacity: num(s.capacity, 1, 100, 1)
    };
  }
  function email(e) {
    if (!e || !e.on) return null;
    return { on: true, subject: str(e.subject, 300), body: str(e.body, 5000) };
  }
  out.pro.emails = { confirm: email(p.emails && p.emails.confirm), decline: email(p.emails && p.emails.decline) };
  return out;
}

function isEmail_(s) {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(String(s || '').trim());
}

// ---------------------------------------------------------------------------
// QUESTIONS
// ---------------------------------------------------------------------------

var QUESTION_TYPES_ = ['TEXT', 'PARAGRAPH_TEXT', 'MULTIPLE_CHOICE', 'LIST', 'CHECKBOX', 'SCALE',
  'DATE', 'DATETIME', 'TIME', 'DURATION', 'GRID', 'CHECKBOX_GRID', 'RATING'];

/** The form's questions as plain objects. */
function getQuestions_(form) {
  return form.getItems().map(function (it) {
    var type = String(it.getType());
    if (QUESTION_TYPES_.indexOf(type) < 0) return null;
    var q = { id: it.getId(), title: it.getTitle() || '(Untitled question)', type: type };
    try {
      if (type === 'DATE') q.includesYear = it.asDateItem().includesYear();
      if (type === 'DATETIME') q.includesYear = it.asDateTimeItem().includesYear();
      if (type === 'MULTIPLE_CHOICE') q.choices = it.asMultipleChoiceItem().getChoices().map(function (c) { return c.getValue(); });
      if (type === 'LIST') q.choices = it.asListItem().getChoices().map(function (c) { return c.getValue(); });
      if (type === 'CHECKBOX') q.choices = it.asCheckboxItem().getChoices().map(function (c) { return c.getValue(); });
    } catch (e) { /* item type changed under us */ }
    if (q.choices && q.choices.length > 60) q.choices = q.choices.slice(0, 60);
    return q;
  }).filter(Boolean);
}

/** Normalized key for {{Question}} tokens: case- and space-insensitive. */
function tokenKey_(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

var BUILTIN_TOKENS_ = ['respondent email', 'form title', 'submitted'];
var EMAIL_TOKENS_ = ['event title', 'event time', 'calendar', 'event link', 'reason'];

/** Tokens used in a template that match no question title. */
function unknownTokens_(tpl, questions, extra) {
  var known = {};
  questions.forEach(function (q) { known[tokenKey_(q.title)] = true; });
  BUILTIN_TOKENS_.concat(extra || []).forEach(function (k) { known[k] = true; });
  var bad = [];
  String(tpl || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (m, name) {
    if (!known[tokenKey_(name)] && bad.indexOf(name) < 0) bad.push(name);
    return m;
  });
  return bad;
}

/**
 * Check a config against the form's current questions.
 * Returns [{ level: 'error'|'warn', field, msg, fix?: { type, itemId } }].
 */
function validateConfig_(cfg, questions, collectsEmail) {
  var issues = [];
  var byId = {};
  questions.forEach(function (q) { byId[q.id] = q; });
  function need(itemId, field, label, types) {
    if (!itemId) return null;
    var q = byId[itemId];
    if (!q) { issues.push({ level: 'error', field: field, msg: 'The question mapped to ' + label + ' was deleted. Pick another one.' }); return null; }
    if (types && types.indexOf(q.type) < 0) { issues.push({ level: 'error', field: field, msg: '\'' + q.title + '\' is no longer the right kind of question for ' + label + '.' }); return null; }
    return q;
  }
  function yearCheck(q, field) {
    if (q && (q.type === 'DATE' || q.type === 'DATETIME') && q.includesYear === false) {
      issues.push({ level: 'error', field: field,
        msg: 'The question \'' + q.title + '\' doesn\'t include the year. Turn on \'Include year\' so events land in the right year.',
        fix: { type: 'includeYear', itemId: q.id } });
    }
  }

  if (!cfg.calendarId) issues.push({ level: 'error', field: 'calendar', msg: 'Pick a calendar.' });

  var slots = cfg.pro && cfg.pro.slots;
  var slotQ = slots ? need(slots.itemId, 'slots', 'bookable time slots', ['MULTIPLE_CHOICE', 'LIST']) : null;
  if (!slots) {
    if (!cfg.startDate.itemId) issues.push({ level: 'error', field: 'startDate', msg: 'Pick the question that holds the date.' });
    yearCheck(need(cfg.startDate.itemId, 'startDate', 'Date', ['DATE', 'DATETIME']), 'startDate');
    need(cfg.startTime.itemId, 'startTime', 'Start time', ['TIME']);
    if (cfg.end.mode === 'duration') {
      if (!cfg.end.itemId) issues.push({ level: 'error', field: 'end', msg: 'Pick the duration question.' });
      need(cfg.end.itemId, 'end', 'Duration', ['DURATION']);
    } else if (cfg.end.mode === 'endTime') {
      if (!cfg.end.itemId) issues.push({ level: 'error', field: 'end', msg: 'Pick the end time question.' });
      yearCheck(need(cfg.end.itemId, 'end', 'End time', ['TIME', 'DATETIME']), 'end');
    } else if (cfg.end.mode === 'endDate') {
      if (!cfg.end.itemId) issues.push({ level: 'error', field: 'end', msg: 'Pick the end date question.' });
      yearCheck(need(cfg.end.itemId, 'end', 'End date', ['DATE']), 'end');
    }
  } else if (slotQ === null && slots.itemId && byId[slots.itemId]) {
    // type error already reported
  }

  if (!String(cfg.title || '').trim()) issues.push({ level: 'error', field: 'title', msg: 'Give the event a title.' });

  [['title', 'Event title'], ['location', 'Location'], ['description', 'Description']].forEach(function (f) {
    var bad = unknownTokens_(cfg[f[0]], questions);
    if (bad.length) issues.push({ level: 'warn', field: f[0], msg: f[1] + ': {{' + bad.join('}}, {{') + '}} doesn\'t match any question title, so it will be left blank.' });
  });

  if (cfg.guests.source === 'respondent' && !collectsEmail) {
    issues.push({ level: 'warn', field: 'guests',
      msg: 'This form doesn\'t collect email addresses, so we can\'t invite the person who responded. Turn on email collection in Settings, Responses.' });
  }
  if (cfg.guests.source === 'item') need(cfg.guests.itemId, 'guests', 'Guest email', ['TEXT']);

  (cfg.pro.routes || []).forEach(function (r, i) { need(r.itemId, 'routes', 'routing rule ' + (i + 1)); });

  if (cfg.pro.emails && cfg.pro.emails.confirm) {
    var bc = unknownTokens_(cfg.pro.emails.confirm.subject + ' ' + cfg.pro.emails.confirm.body, questions, EMAIL_TOKENS_);
    if (bc.length) issues.push({ level: 'warn', field: 'emails', msg: 'Confirmation email: {{' + bc.join('}}, {{') + '}} doesn\'t match any question title.' });
  }
  if (cfg.pro.emails && cfg.pro.emails.decline) {
    var bd = unknownTokens_(cfg.pro.emails.decline.subject + ' ' + cfg.pro.emails.decline.body, questions, EMAIL_TOKENS_);
    if (bd.length) issues.push({ level: 'warn', field: 'emails', msg: 'Decline email: {{' + bd.join('}}, {{') + '}} doesn\'t match any question title.' });
  }
  return issues;
}

/** Best guesses for a fresh setup, by question type and title. */
function smartDefaults_(questions, formTitle, collectsEmail) {
  var cfg = defaultConfig_();
  function find(types, re) {
    var hit = null;
    questions.forEach(function (q) { if (!hit && types.indexOf(q.type) >= 0 && (!re || re.test(q.title))) hit = q; });
    return hit;
  }
  var date = find(['DATETIME'], /start|date|when|day/i) || find(['DATE'], /start|date|when|day|from/i) || find(['DATETIME']) || find(['DATE']);
  if (date) cfg.startDate.itemId = date.id;
  if (date && date.type === 'DATE') {
    var st = find(['TIME'], /start|from|begin|time/i) || find(['TIME']);
    if (st) cfg.startTime.itemId = st.id;
    var et = questions.filter(function (q) { return q.type === 'TIME' && q.id !== (st && st.id) && /end|finish|until|to\b/i.test(q.title); })[0];
    var dur = find(['DURATION']);
    var ed = questions.filter(function (q) { return q.type === 'DATE' && q.id !== date.id && /end|return|until|last|to\b/i.test(q.title); })[0];
    if (et) cfg.end = { mode: 'endTime', minutes: 60, itemId: et.id };
    else if (dur) cfg.end = { mode: 'duration', minutes: 60, itemId: dur.id };
    else if (ed && !st) cfg.end = { mode: 'endDate', minutes: 60, itemId: ed.id };
  } else if (date && date.type === 'DATETIME') {
    var edt = questions.filter(function (q) { return q.type === 'DATETIME' && q.id !== date.id; })[0];
    var dur2 = find(['DURATION']);
    if (edt) cfg.end = { mode: 'endTime', minutes: 60, itemId: edt.id };
    else if (dur2) cfg.end = { mode: 'duration', minutes: 60, itemId: dur2.id };
  }
  var name = find(['TEXT'], /name/i);
  var kind = find(['MULTIPLE_CHOICE', 'LIST'], /type|kind|reason|service|room|request/i);
  cfg.title = name && kind ? '{{' + name.title + '}}: {{' + kind.title + '}}'
    : name ? (formTitle ? formTitle + ': ' : '') + '{{' + name.title + '}}'
    : kind ? '{{' + kind.title + '}}'
    : (formTitle || 'Booking');
  var loc = find(['TEXT', 'MULTIPLE_CHOICE', 'LIST'], /room|location|where|venue|place|address|site/i);
  if (loc) cfg.location = '{{' + loc.title + '}}';
  var notes = find(['PARAGRAPH_TEXT']);
  var lines = [];
  if (collectsEmail) lines.push('Requested by {{Respondent email}}');
  if (notes) lines.push('{{' + notes.title + '}}');
  cfg.description = lines.join('\n');
  var em = find(['TEXT'], /e-?mail/i);
  if (collectsEmail) cfg.guests.source = 'respondent';
  else if (em) cfg.guests = { source: 'item', itemId: em.id, addOwner: false };
  return cfg;
}
