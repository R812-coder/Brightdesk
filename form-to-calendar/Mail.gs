/**
 * Mail.gs — every email, in plain professional HTML. No emoji.
 * Email never blocks an event: failures are logged and the pipeline continues.
 */

var DEFAULT_CONFIRM_ = {
  subject: 'Booked: {{Event title}}',
  body: 'Hello,\n\nYour request is booked for {{Event time}}.\n\n{{Event title}}\n\nIf your email address was included, a calendar invitation is on its way too.'
};
var DEFAULT_DECLINE_ = {
  subject: 'We couldn\'t book your request',
  body: 'Hello,\n\nWe couldn\'t book your request for {{Event time}}.\n\nReason: {{Reason}}\n\nPlease submit the form again with a different time.'
};

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textToHtml_(s) { return esc_(s).replace(/\r?\n/g, '<br>'); }

/** Shared layout. button = { label, url } */
function emailShell_(heading, innerHtml, button, footerHtml) {
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;color:#1F2A37;font-size:14px;line-height:1.55;max-width:560px">' +
    (heading ? '<h2 style="font-size:18px;margin:0 0 12px;color:#1F2A37">' + esc_(heading) + '</h2>' : '') +
    innerHtml +
    (button ? '<p style="margin:20px 0"><a href="' + esc_(button.url) + '" style="background:#15803D;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block;font-weight:600">' + esc_(button.label) + '</a></p>' : '') +
    '<p style="color:#5B6573;font-size:12px;margin-top:24px;border-top:1px solid #E3E6EA;padding-top:12px">' +
    (footerHtml || 'Sent by Form to Calendar Bookings for Google Forms&trade;.') + '</p></div>';
}

/** Send, respecting Google's daily quota. Returns true when sent. */
function sendMail_(to, subject, htmlBody, opts) {
  opts = opts || {};
  try {
    if (MailApp.getRemainingDailyQuota() < 1) {
      log_('Failed', null, { msg: 'Google\'s daily email limit for this account was reached, so the email to ' + to + ' was not sent.' });
      return false;
    }
    var msg = { to: to, subject: subject.slice(0, 250), htmlBody: htmlBody, name: opts.name || 'Form to Calendar Bookings' };
    if (opts.replyTo && isEmail_(opts.replyTo)) msg.replyTo = opts.replyTo;
    MailApp.sendEmail(msg);
    return true;
  } catch (e) {
    log_('Failed', null, { msg: 'Email to ' + to + ' was not sent: ' + (e.message || e) });
    return false;
  }
}

/** The form's title, or 'your form' when it has none (getTitle() can be blank). */
function formTitleSafe_() {
  var t = '';
  try { t = String(FormApp.getActiveForm().getTitle() || '').trim(); } catch (e) { t = ''; }
  return t || 'your form';
}

/** Display name on emails to respondents: the form's title, else the product name. */
function senderName_() {
  var t = formTitleSafe_();
  return t === 'your form' ? 'Form to Calendar Bookings' : t.slice(0, 60);
}

function formEditUrlSafe_() {
  try { return FormApp.getActiveForm().getEditUrl(); } catch (e) { return 'https://docs.google.com/forms/'; }
}

/** Fill a requester template; ans may be absent (approvals), then only email tokens fill. */
function fillEmail_(tpl, draftOrPending, extra) {
  var ans = draftOrPending.ans || {
    list: (draftOrPending.answers || []).map(function (a) { return { title: a.t, type: 'TEXT', value: a.v }; }),
    respondentEmail: draftOrPending.requesterEmail, formTitle: formTitleSafe_()
  };
  return fillTemplate_(tpl, ans, extra);
}

// ---------------------------------------------------------------------------
// OWNER
// ---------------------------------------------------------------------------

function sendFailureAlert_(owner, failures) {
  var n = failures.length || 1;
  var rows = failures.slice(0, 20).map(function (f) {
    return '<li style="margin-bottom:10px"><strong>' + esc_(f.who || 'A response') + '</strong><br>' + esc_(f.reason) +
      '<br><span style="color:#5B6573">Fix: ' + esc_(fixFor_(f.reason)) + '</span></li>';
  }).join('');
  var html = emailShell_('Some responses did not become events',
    '<p>Form to Calendar Bookings could not add ' + n + ' event' + (n === 1 ? '' : 's') + ' from <strong>' + esc_(formTitleSafe_()) + '</strong>.</p>' +
    '<ul style="padding-left:18px">' + rows + '</ul>' +
    '<p>Problems from Google are retried automatically. You get at most one of these emails a day. ' +
    'To see every attempt, open the form, then Extensions, Form to Calendar Bookings, Activity log.</p>',
    { label: 'Open the form', url: formEditUrlSafe_() });
  return sendMail_(owner, 'Form to Calendar Bookings could not add ' + n + ' event' + (n === 1 ? '' : 's'), html);
}

function notifyApprovers_(p, cfg) {
  var owner = getOwner_();
  var to = [];
  (cfg.pro.approval.notify && cfg.pro.approval.notify.length ? cfg.pro.approval.notify : ['owner']).forEach(function (e) {
    var addr = e === 'owner' ? owner : e;
    if (isEmail_(addr) && to.indexOf(addr.toLowerCase()) < 0) to.push(addr.toLowerCase());
  });
  if (!to.length && owner) to.push(owner);
  if (!to.length) return;
  var answers = (p.answers || []).slice(0, 20).map(function (a) {
    return '<tr><td style="padding:4px 12px 4px 0;color:#5B6573;vertical-align:top">' + esc_(a.t) + '</td><td style="padding:4px 0">' + esc_(a.v) + '</td></tr>';
  }).join('');
  var html = emailShell_('New request waiting for approval',
    '<p><strong>' + esc_(p.title) + '</strong><br>' + esc_(p.when) + '<br>Calendar: ' + esc_(p.calendarName) +
    (p.requesterEmail ? '<br>From: ' + esc_(p.requesterEmail) : '') + '</p>' +
    (p.warning ? '<p style="color:#B54708"><strong>Conflict:</strong> ' + esc_(p.warning) + '</p>' : '') +
    (answers ? '<table style="border-collapse:collapse;font-size:13px;margin:8px 0">' + answers + '</table>' : '') +
    '<p>To approve or decline, open the form, then Extensions, Form to Calendar Bookings, Requests.</p>',
    { label: 'Review requests', url: formEditUrlSafe_() });
  sendMail_(to.join(','), 'Request waiting for approval: ' + p.title, html);
}

// ---------------------------------------------------------------------------
// REQUESTER (Pro)
// ---------------------------------------------------------------------------

function requesterExtra_(title, when, calName, link, reason) {
  return { 'event title': title, 'event time': when, 'calendar': calName || '', 'event link': link || '', 'reason': reason || '' };
}

function sendConfirm_(draft, cfg, ev, when, target) {
  var t = cfg.pro.emails.confirm && cfg.pro.emails.confirm.on ? cfg.pro.emails.confirm : null;
  if (!t || !draft.requesterEmail) return;
  var extra = requesterExtra_(draft.title, when, target.calendarName, ev && ev.htmlLink, '');
  var subject = fillEmail_(t.subject || DEFAULT_CONFIRM_.subject, draft, extra);
  var body = fillEmail_(t.body || DEFAULT_CONFIRM_.body, draft, extra);
  sendMail_(draft.requesterEmail, subject, emailShell_('', '<p>' + textToHtml_(body) + '</p>', null, esc_(senderName_())),
    { name: senderName_(), replyTo: getOwner_() });
}

function sendDecline_(draft, cfg, reason, when, target) {
  if (!draft.requesterEmail) return;
  var t = cfg.pro.emails.decline && cfg.pro.emails.decline.on ? cfg.pro.emails.decline : DEFAULT_DECLINE_;
  var extra = requesterExtra_(draft.title, when, target && target.calendarName, '', reason);
  var subject = fillEmail_(t.subject || DEFAULT_DECLINE_.subject, draft, extra);
  var body = fillEmail_(t.body || DEFAULT_DECLINE_.body, draft, extra);
  sendMail_(draft.requesterEmail, subject, emailShell_('', '<p>' + textToHtml_(body) + '</p>', null, esc_(senderName_())),
    { name: senderName_(), replyTo: getOwner_() });
}

function sendApproved_(p, cfg, ev) {
  var t = cfg.pro.emails.confirm && cfg.pro.emails.confirm.on ? cfg.pro.emails.confirm : DEFAULT_CONFIRM_;
  var extra = requesterExtra_(p.title, p.when, p.calendarName, ev && ev.htmlLink, '');
  var subject = fillEmail_(t.subject || DEFAULT_CONFIRM_.subject, p, extra);
  var body = fillEmail_(t.body || DEFAULT_CONFIRM_.body, p, extra);
  sendMail_(p.requesterEmail, subject, emailShell_('', '<p>' + textToHtml_(body) + '</p>', null, esc_(senderName_())),
    { name: senderName_(), replyTo: getOwner_() });
}

function sendDeclinedByOwner_(p, cfg, reason) {
  var t = cfg.pro.emails.decline && cfg.pro.emails.decline.on ? cfg.pro.emails.decline : DEFAULT_DECLINE_;
  var extra = requesterExtra_(p.title, p.when, p.calendarName, '', reason || 'The request was declined.');
  var subject = fillEmail_(t.subject || DEFAULT_DECLINE_.subject, p, extra);
  var body = fillEmail_(t.body || DEFAULT_DECLINE_.body, p, extra);
  sendMail_(p.requesterEmail, subject, emailShell_('', '<p>' + textToHtml_(body) + '</p>', null, esc_(senderName_())),
    { name: senderName_(), replyTo: getOwner_() });
}

// ---------------------------------------------------------------------------
// WELCOME (once per user, guarded by a sent flag)
// ---------------------------------------------------------------------------

function maybeWelcome_() {
  try {
    var up = userProps_();
    if (up.getProperty('fc.welcomeSent')) return;
    var me = myEmail_();
    if (!me) return;
    up.setProperty('fc.welcomeSent', String(Date.now())); // set first so a failure never repeats it
    var html = emailShell_('Form to Calendar Bookings is on',
      '<p>Each new response to <strong>' + esc_(formTitleSafe_()) + '</strong> now becomes an event in your calendar, at the right time in that calendar\'s time zone.</p>' +
      '<p>Three things worth knowing:</p><ul style="padding-left:18px">' +
      '<li>It runs from your account, even when the form is closed.</li>' +
      '<li>If an event can\'t be added, you get one email a day saying which and how to fix it.</li>' +
      '<li>Open the form, then Extensions, Form to Calendar Bookings, Activity log to see every response it handled.</li></ul>' +
      '<p>Pro adds conflict checks, approvals, bookable time slots and routing by answer: ' + esc_(PRODUCT_URL_) + '</p>',
      { label: 'Need something custom built?', url: SERVICES_URL_ },
      'BrightDesk &middot; <a href="' + PRODUCT_URL_ + '" style="color:#5B6573">brightdesk.dev</a>');
    MailApp.sendEmail({ to: me, subject: 'Form to Calendar Bookings is on', htmlBody: html, name: 'BrightDesk' });
  } catch (e) {
    console.error('Welcome email failed: ' + e);
  }
}
