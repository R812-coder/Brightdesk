/**
 * Times.gs — answer parsing, time-zone-safe moments, day math.
 *
 * THE BRIGHTDESK DATE RULE (from Timesheet v1.1):
 *  - A published add-on runs JavaScript local-time Date methods in the manifest's
 *    zone (America/New_York) for EVERY user. So no user-chosen wall-clock time is
 *    ever held in, or read out of, a JavaScript Date with local methods.
 *  - Answers arrive as text. Text becomes a moment only through
 *    Utilities.parseDate(text, calendarTz, pattern).
 *  - Never new Date('yyyy-MM-dd'); never setHours/getDate/getDay on user dates.
 *  - Day arithmetic happens on 'yyyy-MM-dd' strings with UTC methods only.
 */

var LOCAL_DT_FORMAT_ = "yyyy-MM-dd'T'HH:mm:ss";

/** An error caused by the response or the setup, not by Google. Never retried. */
function UserError_(message) {
  this.name = 'UserError';
  this.message = message;
  this.isUserError = true;
}
UserError_.prototype = Object.create(Error.prototype);
UserError_.prototype.constructor = UserError_;
UserError_.prototype.toString = function () { return this.message; };

// ---------------------------------------------------------------------------
// CALENDAR-DAY MATH (UTC only — safe in every zone)
// ---------------------------------------------------------------------------

/** 'yyyy-MM-dd' plus n days, using UTC so no zone can shift the day. */
function addDays_(ymd, n) {
  var p = String(ymd).split('-').map(Number);
  var t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return t.toISOString().slice(0, 10);
}

/** True if 'yyyy-MM-dd' is a real calendar day (rejects 2026-02-30). */
function isValidYmd_(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return false;
  var t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
}

/** ISO weekday of a 'yyyy-MM-dd': 1 = Monday ... 7 = Sunday. */
function weekdayIso_(ymd) {
  var p = String(ymd).split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Whole days from a to b ('yyyy-MM-dd'), b - a. */
function daysBetween_(a, b) {
  var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

/** Today's 'yyyy-MM-dd' in a zone. */
function todayYmd_(tz) {
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

var WEEKDAYS_ = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'yyyy-MM-dd' -> 'Sat 14 Nov 2026' without touching any zone. */
function prettyYmd_(ymd) {
  var p = String(ymd).split('-').map(Number);
  return WEEKDAYS_[weekdayIso_(ymd) - 1] + ' ' + p[2] + ' ' + MONTHS_[p[1] - 1] + ' ' + p[0];
}

/** 'yyyy-MM-dd' -> 'Sat 14 Nov' (no year). */
function prettyYmdShort_(ymd) {
  var p = String(ymd).split('-').map(Number);
  return WEEKDAYS_[weekdayIso_(ymd) - 1] + ' ' + p[2] + ' ' + MONTHS_[p[1] - 1];
}

// ---------------------------------------------------------------------------
// ANSWER PARSING (form answers are always strings)
// ---------------------------------------------------------------------------

/**
 * Date or date-time answer -> { date: 'yyyy-MM-dd', time: 'HH:mm' | null }.
 * Accepts '2026-11-14', '2026-11-14 14:30'. Refuses '11-14' (question hides the year).
 */
function parseDateAnswer_(text, questionTitle) {
  var s = String(text == null ? '' : text).trim();
  if (!s) return null;
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(s);
  if (!m) {
    if (/^\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2})?$/.test(s)) {
      throw new UserError_('The question \'' + (questionTitle || 'Date') + '\' doesn\'t include the year. ' +
        'Turn on \'Include year\' so events land in the right year.');
    }
    throw new UserError_('The answer \'' + s + '\' to \'' + (questionTitle || 'Date') + '\' is not a date.');
  }
  var ymd = m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  if (!isValidYmd_(ymd)) throw new UserError_('The date ' + s + ' does not exist.');
  var time = m[4] != null ? pad2_(m[4]) + ':' + m[5] : null;
  if (time && !isValidHm_(time)) throw new UserError_('The time ' + time + ' is not valid.');
  return { date: ymd, time: time };
}

/** Time answer '14:30' or '14:30:00' -> '14:30'. Blank -> null. */
function parseTimeAnswer_(text, questionTitle) {
  var s = String(text == null ? '' : text).trim();
  if (!s) return null;
  var m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) throw new UserError_('The answer \'' + s + '\' to \'' + (questionTitle || 'Time') + '\' is not a time.');
  var hm = pad2_(m[1]) + ':' + m[2];
  if (!isValidHm_(hm)) throw new UserError_('The time ' + s + ' is not valid.');
  return hm;
}

/** Duration answer '01:30:00' (or '1:30') -> minutes. Blank -> null. */
function parseDurationAnswer_(text, questionTitle) {
  var s = String(text == null ? '' : text).trim();
  if (!s) return null;
  var m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) throw new UserError_('The answer \'' + s + '\' to \'' + (questionTitle || 'Duration') + '\' is not a duration.');
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] && Number(m[3]) >= 30 ? 1 : 0);
}

function isValidHm_(hm) {
  var p = hm.split(':').map(Number);
  return p[0] >= 0 && p[0] <= 23 && p[1] >= 0 && p[1] <= 59;
}

function pad2_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

// ---------------------------------------------------------------------------
// MOMENTS IN THE CALENDAR'S ZONE
// ---------------------------------------------------------------------------

/**
 * Wall-clock day + time in a zone -> Date (an absolute moment).
 * A time that does not exist in the zone (clocks jump forward) is REPORTED, never shifted.
 */
function toMoment_(ymd, hm, tz) {
  var text = ymd + ' ' + hm;
  var d = Utilities.parseDate(text, tz, 'yyyy-MM-dd HH:mm');
  if (Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm') !== text) {
    throw new UserError_(hm + ' does not exist on ' + prettyYmd_(ymd) + ' in ' + tz +
      ' because the clocks move forward that night, so no event was created.');
  }
  return d;
}

/** Start of a day in a zone, lenient (only used for conflict windows of all-day events). */
function dayStartMs_(ymd, tz) {
  return Utilities.parseDate(ymd + ' 00:00', tz, 'yyyy-MM-dd HH:mm').getTime();
}

/**
 * Build the Calendar API start/end for one draft. No JS Date ever holds a wall-clock time.
 * d = { startDate, startTime|null, endDate|null, endTime|null, minutes|null }
 */
function buildTimes_(d, tz) {
  if (!d || !d.startDate) throw new UserError_('This response has no date, so no event was created.');
  if (!isValidYmd_(d.startDate)) throw new UserError_('The date ' + d.startDate + ' does not exist.');
  if (d.endDate && !isValidYmd_(d.endDate)) throw new UserError_('The end date ' + d.endDate + ' does not exist.');
  if (d.endDate && d.endDate < d.startDate) {
    throw new UserError_('End date is before start date for this response, so no event was created.');
  }

  if (!d.startTime) { // all-day (also when an optional start time was left blank)
    var lastDay = d.endDate || d.startDate;
    var endYmd = addDays_(lastDay, 1); // end.date is exclusive
    return {
      allDay: true,
      start: { date: d.startDate },
      end: { date: endYmd },
      startMs: dayStartMs_(d.startDate, tz),
      endMs: dayStartMs_(endYmd, tz),
      tz: tz
    };
  }

  var start = toMoment_(d.startDate, d.startTime, tz);
  var end;
  if (d.endTime) {
    end = toMoment_(d.endDate || d.startDate, d.endTime, tz);
  } else {
    var minutes = Number(d.minutes);
    if (!(minutes > 0)) throw new UserError_('The event length is zero, so no event was created.');
    end = new Date(start.getTime() + minutes * 60000); // pure millisecond math, zone-free
  }
  if (end.getTime() <= start.getTime()) {
    throw new UserError_('End time is before start time for this response, so no event was created.');
  }
  return {
    allDay: false,
    start: { dateTime: Utilities.formatDate(start, tz, LOCAL_DT_FORMAT_), timeZone: tz },
    end: { dateTime: Utilities.formatDate(end, tz, LOCAL_DT_FORMAT_), timeZone: tz },
    startMs: start.getTime(),
    endMs: end.getTime(),
    tz: tz
  };
}

/** Times for a booked slot: the slot map already holds local start/end text. */
function slotTimes_(slot, tz) {
  var s = slot.s.split('T'), e = slot.e.split('T');
  return buildTimes_({ startDate: s[0], startTime: s[1].slice(0, 5), endDate: e[0], endTime: e[1].slice(0, 5) }, tz);
}

/** Human line: 'Thu 14 Nov 2026, 10:00–11:00 (America/New_York)'. */
function describeTimes_(t) {
  if (t.allDay) {
    var last = addDays_(t.end.date, -1);
    if (last === t.start.date) return prettyYmd_(t.start.date) + ', all day';
    return prettyYmdShort_(t.start.date) + ' – ' + prettyYmd_(last) + ', all day';
  }
  var sd = t.start.dateTime.slice(0, 10), st = t.start.dateTime.slice(11, 16);
  var ed = t.end.dateTime.slice(0, 10), et = t.end.dateTime.slice(11, 16);
  if (sd === ed) return prettyYmd_(sd) + ', ' + st + '–' + et + ' (' + t.tz + ')';
  return prettyYmd_(sd) + ', ' + st + ' – ' + prettyYmd_(ed) + ', ' + et + ' (' + t.tz + ')';
}

/** Calendar API event start/end -> comparable key (ms for timed, date for all-day). */
function apiTimeKey_(part) {
  if (!part) return '';
  if (part.date) return 'd:' + part.date;
  return 'm:' + new Date(part.dateTime).getTime(); // RFC 3339 with offset = absolute moment
}

function timesKey_(t) {
  return t.allDay ? { s: 'd:' + t.start.date, e: 'd:' + t.end.date } : { s: 'm:' + t.startMs, e: 'm:' + t.endMs };
}
