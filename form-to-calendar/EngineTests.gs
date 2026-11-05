/**
 * EngineTests.gs — run runEngineTests() from the Apps Script editor (Run menu).
 * Pure functions only: no calendar, form or email is touched.
 * Covers New York, Perth, London, Kolkata and Los Angeles, both 2026 US DST weekends,
 * all-day, multi-day, end-before-start and missing year.
 */

function runEngineTests() {
  var T = { pass: 0, fail: 0, lines: [] };
  function ok(cond, name, detail) {
    if (cond) { T.pass++; } else { T.fail++; T.lines.push('FAIL ' + name + (detail ? ' :: ' + detail : '')); }
  }
  function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
  function throwsUser(fn, re, name) {
    try { fn(); ok(false, name, 'did not throw'); }
    catch (e) { ok(e && e.isUserError && (!re || re.test(e.message)), name, String(e && e.message)); }
  }
  function fmt(ms, tz) { return Utilities.formatDate(new Date(ms), tz, 'yyyy-MM-dd HH:mm'); }

  var NY = 'America/New_York', PER = 'Australia/Perth', LON = 'Europe/London', KOL = 'Asia/Kolkata', LA = 'America/Los_Angeles';

  // --- Day math --------------------------------------------------------------
  eq(addDays_('2026-11-14', 1), '2026-11-15', 'addDays basic');
  eq(addDays_('2026-12-31', 1), '2027-01-01', 'addDays year end');
  eq(addDays_('2028-02-28', 1), '2028-02-29', 'addDays leap');
  eq(addDays_('2026-03-01', -1), '2026-02-28', 'addDays back');
  eq(weekdayIso_('2026-11-14'), 6, 'weekday Saturday');
  eq(weekdayIso_('2026-11-16'), 1, 'weekday Monday');
  ok(!isValidYmd_('2026-02-30'), 'invalid day rejected');
  eq(prettyYmd_('2026-11-14'), 'Sat 14 Nov 2026', 'pretty date');

  // --- Answer parsing --------------------------------------------------------
  eq(parseDateAnswer_('2026-11-14'), { date: '2026-11-14', time: null }, 'parse date');
  eq(parseDateAnswer_('2026-11-14 14:30'), { date: '2026-11-14', time: '14:30' }, 'parse datetime');
  throwsUser(function () { parseDateAnswer_('11-14', 'Preferred date'); }, /Preferred date.*doesn't include the year/, 'missing year refused');
  eq(parseTimeAnswer_('9:05'), '09:05', 'parse time pads');
  eq(parseTimeAnswer_(''), null, 'blank time');
  eq(parseDurationAnswer_('01:30:00'), 90, 'duration 1:30');
  eq(parseDurationAnswer_('00:45:00'), 45, 'duration 45');

  // --- Times in every zone ---------------------------------------------------
  var p = buildTimes_({ startDate: '2026-11-14', startTime: '10:00', minutes: 60 }, PER);
  eq(p.start, { dateTime: '2026-11-14T10:00:00', timeZone: PER }, 'Perth start text');
  eq(fmt(p.startMs, PER), '2026-11-14 10:00', 'Perth 10:00 in Perth');
  eq(fmt(p.startMs, NY), '2026-11-13 21:00', 'Perth 10:00 is 21:00 previous day in New York');
  eq(p.end.dateTime, '2026-11-14T11:00:00', 'Perth end');

  var k = buildTimes_({ startDate: '2026-11-14', startTime: '10:00', minutes: 30 }, KOL);
  eq(new Date(k.startMs).toISOString(), '2026-11-14T04:30:00.000Z', 'Kolkata +05:30');

  var lon = buildTimes_({ startDate: '2026-07-01', startTime: '09:00', minutes: 60 }, LON);
  eq(new Date(lon.startMs).toISOString(), '2026-07-01T08:00:00.000Z', 'London summer time');

  var la = buildTimes_({ startDate: '2026-11-14', startTime: '10:00', endTime: '11:15' }, LA);
  eq(new Date(la.startMs).toISOString(), '2026-11-14T18:00:00.000Z', 'Los Angeles PST');
  eq(la.end.dateTime, '2026-11-14T11:15:00', 'end time question');

  var allDay = buildTimes_({ startDate: '2026-11-14', startTime: null }, NY);
  eq([allDay.start, allDay.end], [{ date: '2026-11-14' }, { date: '2026-11-15' }], 'all-day, end exclusive');
  var multi = buildTimes_({ startDate: '2026-11-14', endDate: '2026-11-16' }, PER);
  eq([multi.start.date, multi.end.date], ['2026-11-14', '2026-11-17'], 'multi-day 14-16 inclusive');

  eq(buildTimes_({ startDate: '2026-11-14', startTime: '10:00', minutes: 90 }, NY).end.dateTime, '2026-11-14T11:30:00', 'duration 90');
  eq(buildTimes_({ startDate: '2026-11-14', startTime: '10:00', minutes: 45 }, NY).end.dateTime, '2026-11-14T10:45:00', 'fixed 45');

  // DST: no hour shift on either 2026 US weekend; a missing hour is reported.
  eq(new Date(buildTimes_({ startDate: '2026-03-08', startTime: '10:00', minutes: 60 }, NY).startMs).toISOString(), '2026-03-08T14:00:00.000Z', 'NY spring-forward day 10:00 EDT');
  eq(new Date(buildTimes_({ startDate: '2026-03-07', startTime: '10:00', minutes: 60 }, NY).startMs).toISOString(), '2026-03-07T15:00:00.000Z', 'NY day before 10:00 EST');
  eq(new Date(buildTimes_({ startDate: '2026-11-01', startTime: '10:00', minutes: 60 }, NY).startMs).toISOString(), '2026-11-01T15:00:00.000Z', 'NY fall-back day 10:00 EST');
  throwsUser(function () { buildTimes_({ startDate: '2026-03-08', startTime: '02:30', minutes: 30 }, NY); }, /does not exist/, 'NY 02:30 on 8 Mar reported');
  throwsUser(function () { buildTimes_({ startDate: '2026-03-29', startTime: '01:30', minutes: 30 }, LON); }, /does not exist/, 'London 01:30 on 29 Mar reported');
  var acrossGap = buildTimes_({ startDate: '2026-03-08', startTime: '01:00', minutes: 120 }, NY);
  eq(acrossGap.end.dateTime, '2026-03-08T04:00:00', 'two real hours across the gap end at 04:00');
  ok(!!buildTimes_({ startDate: '2026-11-01', startTime: '01:30', minutes: 30 }, LA), 'LA ambiguous 01:30 accepted');

  throwsUser(function () { buildTimes_({ startDate: '2026-11-14', startTime: '10:00', endTime: '09:00' }, NY); }, /End time is before start time/, 'end before start');
  throwsUser(function () { buildTimes_({ startDate: '2026-11-16', endDate: '2026-11-14' }, NY); }, /End date is before start date/, 'end date before start');

  eq(describeTimes_(p), 'Sat 14 Nov 2026, 10:00–11:00 (Australia/Perth)', 'describe timed');
  eq(describeTimes_(multi), 'Sat 14 Nov – Mon 16 Nov 2026, all day', 'describe multi-day');

  // --- Mapper ------------------------------------------------------------------
  var ans = fakeAnswers_([
    [1, 'Your name', 'TEXT', 'Jordan Lee'],
    [2, 'Room', 'MULTIPLE_CHOICE', 'Gym'],
    [3, 'Date', 'DATE', '2026-11-14'],
    [4, 'Start time', 'TIME', '10:00'],
    [5, 'Duration', 'DURATION', '01:30:00'],
    [6, 'Notes', 'PARAGRAPH_TEXT', 'Bring cones\nand balls'],
    [7, 'Last day', 'DATE', '2026-11-16'],
    [8, 'Equipment', 'CHECKBOX', ['Nets', 'Balls']]
  ], 'jordan@acme.com');
  var cfg = withDefaults_({
    calendarId: 'primary', title: '{{Room}} booking: {{your  name}}', startDate: { itemId: 3 }, startTime: { itemId: 4 },
    end: { mode: 'duration', minutes: 60, itemId: 5 }, location: '{{Room}}', description: 'Requested by {{Respondent email}}\n{{Notes}}\nGear: {{Equipment}}',
    guests: { source: 'respondent', itemId: null, addOwner: false }
  });
  var d = toDraft_(ans, cfg, { pro: false });
  eq(d.title, 'Gym booking: Jordan Lee', 'title tokens, case and space insensitive');
  eq(d.description, 'Requested by jordan@acme.com\nBring cones\nand balls\nGear: Nets, Balls', 'description keeps line breaks');
  eq([d.startDate, d.startTime, d.minutes], ['2026-11-14', '10:00', 90], 'draft times');
  eq(d.guests, ['jordan@acme.com'], 'respondent invited');
  eq(d.respondentLabel, 'Jordan Lee', 'respondent label');

  ans.byId[4].value = '';
  eq(toDraft_(ans, cfg, { pro: false }).startTime, null, 'blank start time -> all-day');
  ans.byId[4].value = '10:00';

  var cfgEnd = withDefaults_(JSON.parse(JSON.stringify(cfg)));
  cfgEnd.end = { mode: 'endDate', minutes: 60, itemId: 7 };
  var dm = toDraft_(ans, cfgEnd, { pro: false });
  eq([dm.startTime, dm.endDate], [null, '2026-11-16'], 'end date mode is all-day multi-day');

  var cfgR = withDefaults_(JSON.parse(JSON.stringify(cfg)));
  cfgR.pro.routes = [{ itemId: 2, equals: 'gym', calendarId: 'gym@group.calendar.google.com', colorId: '11' }];
  eq(route_(d, cfgR).calendarId, 'gym@group.calendar.google.com', 'route by answer');
  eq(route_(d, cfgR).colorId, '11', 'route color');
  cfgR.pro.routes[0].equals = 'Hall';
  eq(route_(d, cfgR).calendarId, 'primary', 'no match -> default');

  var noYear = fakeAnswers_([[3, 'Date', 'DATE', '11-14']], '');
  throwsUser(function () { toDraft_(noYear, cfg, { pro: false }); }, /include the year/, 'draft refuses missing year');

  // --- Event body -------------------------------------------------------------
  var body = buildEventBody_(d, { calendarId: 'primary', colorId: null }, buildTimes_(d, NY), cfg, false, 'owner@acme.com', '');
  eq(body.extendedProperties['private'].fcResponseId, 'R1', 'event tagged with response id');
  eq(body.attendees, [{ email: 'jordan@acme.com' }], 'attendees');
  ok(!body.conferenceData && !body.reminders, 'no Pro fields on free');

  // --- Slots -------------------------------------------------------------------
  var slot = parseSlotText_('Tue 17 Nov 2026, 10:00–10:30');
  eq(slot, { s: '2026-11-17T10:00:00', e: '2026-11-17T10:30:00', k: '2026-11-17T10:00:00' }, 'parse slot text');
  var now = Utilities.parseDate('2026-11-16 08:00', NY, 'yyyy-MM-dd HH:mm').getTime(); // Monday 08:00 NY
  var rules = { weekdays: [1, 2, 3, 4, 5], from: '09:00', to: '10:00', minutes: 30, bufferMinutes: 0, daysAhead: 1, minNoticeHours: 0, capacity: 1 };
  var gen = generateSlots_(rules, NY, now, [], [], 'primary');
  eq(gen.map(function (s) { return s.text; }), ['Mon 16 Nov 2026, 09:00–09:30', 'Mon 16 Nov 2026, 09:30–10:00',
    'Tue 17 Nov 2026, 09:00–09:30', 'Tue 17 Nov 2026, 09:30–10:00'], 'generate slots');
  var busy = [{ status: 'confirmed', summary: 'Staff meeting', start: { dateTime: '2026-11-16T09:15:00-05:00' }, end: { dateTime: '2026-11-16T09:45:00-05:00' } }];
  eq(generateSlots_(rules, NY, now, busy, [], 'primary').length, 2, 'busy event removes both overlapping slots');
  var taken = [{ status: 'confirmed', start: { dateTime: '2026-11-17T09:00:00-05:00' }, end: { dateTime: '2026-11-17T09:30:00-05:00' }, extendedProperties: { 'private': { fcSlot: '2026-11-17T09:00:00', fcResponseId: 'X' } } }];
  eq(generateSlots_(rules, NY, now, taken, [], 'primary').length, 3, 'booked slot removed');
  rules.capacity = 2;
  eq(generateSlots_(rules, NY, now, taken, [], 'primary').length, 4, 'capacity 2 keeps a half-full slot');

  // --- Conflicts ---------------------------------------------------------------
  var t = buildTimes_({ startDate: '2026-11-16', startTime: '09:00', minutes: 60 }, NY);
  var dr = { responseId: 'R9' };
  ok(!!conflictsAmong_(busy, t, dr, NY, 1), 'overlap is a conflict');
  ok(!conflictsAmong_([{ status: 'confirmed', transparency: 'transparent', start: busy[0].start, end: busy[0].end }], t, dr, NY, 1), 'free event ignored');
  ok(!conflictsAmong_([{ status: 'cancelled', start: busy[0].start, end: busy[0].end }], t, dr, NY, 1), 'cancelled ignored');
  ok(!conflictsAmong_([{ status: 'confirmed', start: busy[0].start, end: busy[0].end, extendedProperties: { 'private': { fcResponseId: 'R9' } } }], t, dr, NY, 1), 'own event ignored');
  var allDayEv = [{ status: 'confirmed', start: { date: '2026-11-16' }, end: { date: '2026-11-17' } }];
  ok(!conflictsAmong_(allDayEv, t, dr, NY, 1), 'all-day event does not block a timed request');
  ok(!!conflictsAmong_(allDayEv, buildTimes_({ startDate: '2026-11-16' }, NY), dr, NY, 1), 'all-day blocks all-day');
  var edge = [{ status: 'confirmed', start: { dateTime: '2026-11-16T10:00:00-05:00' }, end: { dateTime: '2026-11-16T11:00:00-05:00' } }];
  ok(!conflictsAmong_(edge, t, dr, NY, 1), 'back-to-back is not a conflict');
  ok(!!pendingConflicts_([{ responseId: 'P1', calendarId: 'primary', startMs: t.startMs, endMs: t.endMs, title: 'Held' }], 'primary', t, dr, 1), 'pending hold blocks');

  // --- Config ------------------------------------------------------------------
  var qsList = [{ id: 3, title: 'Date', type: 'DATE', includesYear: false }, { id: 4, title: 'Start time', type: 'TIME' }];
  var issues = validateConfig_(withDefaults_({ calendarId: 'primary', title: 'X {{Nope}}', startDate: { itemId: 3 }, startTime: { itemId: 4 } }), qsList, false);
  ok(issues.some(function (i) { return i.fix && i.fix.type === 'includeYear'; }), 'validate flags missing year with fix');
  ok(issues.some(function (i) { return /Nope/.test(i.msg); }), 'validate flags unknown token');
  var gone = validateConfig_(withDefaults_({ calendarId: 'primary', title: 'X', startDate: { itemId: 99 } }), qsList, false);
  ok(gone.some(function (i) { return /deleted/.test(i.msg); }), 'validate flags deleted question');
  eq(cleanConfig_({ end: { mode: 'evil', minutes: -5 } }).end.mode, 'fixed', 'clean rejects bad mode');

  // --- Licence (uses a throwaway test secret, never your real one) --------------
  var savedOverride = SECRET_OVERRIDE_;
  SECRET_OVERRIDE_ = 'engine-test-secret';
  function key(obj) {
    var payload = Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, '');
    return KEY_PREFIX_ + '-' + payload + '--' + hmacHex8_(KEY_PREFIX_ + '-' + payload);
  }
  var good = key({ p: 'pro', e: 'buyer@acme.com', d: 'acme.com', x: '2027-10-28' });
  ok(checkLicense_(good, 'buyer@acme.com', '2026-10-29').ok, 'valid pro key');
  ok(!checkLicense_(good, 'other@acme.com', '2026-10-29').ok, 'pro key wrong email');
  ok(!checkLicense_(good, 'buyer@acme.com', '2027-10-29').ok, 'expired key');
  ok(!checkLicense_(good.slice(0, -1) + (good.slice(-1) === 'a' ? 'b' : 'a'), 'buyer@acme.com', '2026-10-29').ok, 'tampered key');
  var dom = key({ p: 'domain', e: 'admin@acme.com', d: 'acme.com', x: '2027-10-28' });
  ok(checkLicense_(dom, 'anyone@acme.com', '2026-10-29').ok, 'domain key, same domain');
  ok(!checkLicense_(dom, 'anyone@notacme.com', '2026-10-29').ok, 'domain key, other domain');
  ok(!checkLicense_(dom, 'anyone@evil-acme.com', '2026-10-29').ok, 'domain key, suffix trick');
  SECRET_OVERRIDE_ = 'a-different-secret';
  ok(!checkLicense_(good, 'buyer@acme.com', '2026-10-29').ok, 'key signed with another secret');
  SECRET_OVERRIDE_ = savedOverride;

  var summary = 'Engine tests: ' + T.pass + ' passed, ' + T.fail + ' failed';
  console.log([summary].concat(T.lines).join('\n'));
  return { passed: T.pass, failed: T.fail, failures: T.lines };
}

/** [[id, title, type, value], ...] -> answers object like answersFromResponse_. */
function fakeAnswers_(rows, respondentEmail) {
  var a = { responseId: 'R1', formId: 'F1', formTitle: 'Room bookings', timestamp: 0, respondentEmail: respondentEmail || '', byId: {}, list: [] };
  rows.forEach(function (r) {
    var e = { id: r[0], title: r[1], type: r[2], value: r[3] };
    a.byId[r[0]] = e;
    a.list.push(e);
  });
  return a;
}
