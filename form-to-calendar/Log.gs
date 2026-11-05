/**
 * Log.gs — ring buffer of the last 200 actions, plus the health line.
 *
 * Entry: { t: ms, r: result, who, when, cal, link, msg, rid }
 * Results: Created, Updated, Waiting for approval, Approved, Declined, Conflict,
 *          Failed, Retrying, Skipped
 */

var LOG_MAX_ = 200;

function log_(result, draft, info) {
  info = info || {};
  var entry = {
    t: Date.now(),
    r: result,
    who: (draft && draft.respondentLabel) || info.who || '',
    when: info.when || '',
    cal: info.cal || '',
    link: info.link || '',
    msg: String(info.msg || '').slice(0, 400),
    rid: (draft && draft.responseId) || info.rid || ''
  };
  try {
    var list = getJson_('fc.log', []);
    list.unshift(entry);
    if (list.length > LOG_MAX_) list = list.slice(0, LOG_MAX_);
    putJson_('fc.log', list);
    var h = getJson_('fc.health', {});
    if (result === 'Created' || result === 'Updated' || result === 'Approved') { h.lastOk = entry.t; }
    if (result === 'Failed') { h.lastErr = entry.t; h.lastErrMsg = entry.msg; }
    putJson_('fc.health', h);
  } catch (e) {
    console.error('Log write failed: ' + e);
  }
  console.log('[fc] ' + result + ' ' + (entry.rid || '') + ' ' + entry.msg);
  return entry;
}

function readLog_() { return getJson_('fc.log', []); }

/** { lastOk, today, failedToday, line } — 'Last event 2:14 PM · 12 today · 0 failed'. */
function healthSummary_(tz) {
  tz = tz || Session.getScriptTimeZone();
  var list = readLog_();
  var h = getJson_('fc.health', {});
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var made = 0, failed = 0;
  list.forEach(function (e) {
    if (Utilities.formatDate(new Date(e.t), tz, 'yyyy-MM-dd') !== today) return;
    if (e.r === 'Created' || e.r === 'Updated' || e.r === 'Approved') made++;
    if (e.r === 'Failed') failed++;
  });
  var last = 'No events yet';
  if (h.lastOk) {
    var sameDay = Utilities.formatDate(new Date(h.lastOk), tz, 'yyyy-MM-dd') === today;
    last = 'Last event ' + Utilities.formatDate(new Date(h.lastOk), tz, sameDay ? 'h:mm a' : 'd MMM, h:mm a');
  }
  return { lastOk: h.lastOk || null, today: made, failedToday: failed, line: last + ' · ' + made + ' today · ' + failed + ' failed' };
}

/** Log rows for the dialog, formatted in the calendar's zone. */
function logRows_(tz) {
  tz = tz || Session.getScriptTimeZone();
  return readLog_().map(function (e) {
    return {
      time: Utilities.formatDate(new Date(e.t), tz, 'd MMM, h:mm a'),
      who: e.who, when: e.when, cal: e.cal, result: e.r, link: e.link, msg: e.msg
    };
  });
}
