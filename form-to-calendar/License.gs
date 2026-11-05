/**
 * License.gs — offline HMAC licence keys, plan gates, the free one-form limit.
 *
 * Key: FCSK-{payload}--{sig}
 *   payload = base64url JSON { "p": "pro"|"domain", "e": "buyer@x.com", "d": "x.com", "x": "2027-10-28" }
 *   sig     = first 8 hex chars of HMAC-SHA256("FCSK-" + payload, LICENSE_SECRET)
 * Valid when the signature matches, x is today or later (UTC), and the user's email
 * equals e (pro) or ends with @d (domain). Stored in User Properties.
 *
 * The form-submit trigger runs as the person who turned it on, so plan checks inside
 * the trigger read that person's licence.
 */

var KEY_PREFIX_ = 'FCSK';

/*
 * THE SECRET lives in Script Properties, not in code, so the code can be shared,
 * pasted into AI tools or put on GitHub without leaking it:
 *   Script editor -> Project Settings (gear) -> Script properties -> Add script property
 *   Property: LICENSE_SECRET   Value: the same secret as your BrightDesk Admin sheet
 * Script properties are per project and not versioned, so the published add-on reads
 * the value straight away. Users can't see them.
 * LICENSE_SECRET_FALLBACK_ is only read when the property is missing; leave it blank.
 */
var LICENSE_SECRET_FALLBACK_ = '';
var SECRET_OVERRIDE_ = null; // EngineTests.gs only

var PRODUCT_URL_ = 'https://brightdesk.dev/form-to-calendar';
var SERVICES_URL_ = 'https://brightdesk.dev/services/';
var BUY_LINKS_ = {
  proYear: 'https://buy.stripe.com/REPLACE_PRO_YEARLY',   // $49 / year
  proMonth: 'https://buy.stripe.com/REPLACE_PRO_MONTHLY', // $12 / month
  org: 'https://buy.stripe.com/REPLACE_ORG_YEARLY'        // $499 / year per domain
};

var planCache_ = null;

function licenseSecret_() {
  if (SECRET_OVERRIDE_) return SECRET_OVERRIDE_;
  var s = '';
  try { s = PropertiesService.getScriptProperties().getProperty('LICENSE_SECRET') || ''; } catch (e) { s = ''; }
  return s || LICENSE_SECRET_FALLBACK_ || '';
}

function hmacHex8_(text) {
  var secret = licenseSecret_();
  if (!secret) throw new Error('LICENSE_SECRET is not set in Script properties.');
  var bytes = Utilities.computeHmacSha256Signature(text, secret);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length < 2 ? '0' + v : v; })
    .join('').slice(0, 8);
}

/** Pure check of a key for an email on a given UTC day. */
function checkLicense_(key, email, todayUtc) {
  key = String(key || '').trim();
  var m = new RegExp('^' + KEY_PREFIX_ + '-([A-Za-z0-9_-]+)--([0-9a-f]{8})$').exec(key);
  if (!m) return { ok: false, msg: 'That doesn\'t look like a Form to Calendar Bookings licence key. It starts with ' + KEY_PREFIX_ + '-.' };
  var expected;
  try { expected = hmacHex8_(KEY_PREFIX_ + '-' + m[1]); } catch (e) {
    console.error(e.message);
    return { ok: false, msg: 'Licence keys can\'t be checked right now. Please contact support at ' + PRODUCT_URL_ + '.' };
  }
  if (expected !== m[2]) return { ok: false, msg: 'That licence key isn\'t valid. Copy it again from your purchase email.' };
  var data;
  try {
    var b64 = m[1];
    while (b64.length % 4) b64 += '=';
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString());
  } catch (e) { return { ok: false, msg: 'That licence key is damaged. Copy it again from your purchase email.' }; }
  if (data.p !== 'pro' && data.p !== 'domain') return { ok: false, msg: 'That licence key isn\'t valid.' };
  if (!data.x || data.x < todayUtc) return { ok: false, msg: 'That licence expired on ' + prettyYmd_(data.x) + '. Renew at ' + PRODUCT_URL_ + '.' };
  email = String(email || '').toLowerCase();
  if (data.p === 'pro' && String(data.e || '').toLowerCase() !== email) {
    return { ok: false, msg: 'This key belongs to ' + data.e + '. You are signed in as ' + email + '.' };
  }
  if (data.p === 'domain' && !(email.length > data.d.length && email.slice(-(data.d.length + 1)) === '@' + String(data.d).toLowerCase())) {
    return { ok: false, msg: 'This Organization key covers @' + data.d + ' accounts. You are signed in as ' + email + '.' };
  }
  return { ok: true, plan: data.p, email: data.e, domain: data.d || '', exp: data.x };
}

function todayUtc_() { return new Date().toISOString().slice(0, 10); }

/** { plan: 'free'|'pro'|'domain', label, exp, key? } for the current user. */
function planInfo_() {
  if (planCache_) return planCache_;
  var key = userProps_().getProperty('fc.license');
  var info = { plan: 'free', label: 'Free plan', exp: null };
  if (key) {
    var r = checkLicense_(key, myEmail_(), todayUtc_());
    if (r.ok) info = { plan: r.plan, label: r.plan === 'domain' ? 'Organization plan (@' + r.domain + ')' : 'Pro', exp: r.exp };
    else info.problem = r.msg;
  }
  planCache_ = info;
  return info;
}

function isPro_() { return planInfo_().plan !== 'free'; }

// ---------------------------------------------------------------------------
// FREE PLAN: one active form per user
// ---------------------------------------------------------------------------

function activeForms_() {
  try { return JSON.parse(userProps_().getProperty('fc.forms') || '[]'); } catch (e) { return []; }
}

function freeFormAllowed_(formId) {
  var list = activeForms_();
  return !list.length || list[0] === formId;
}

/** Record that this user turned on this form. Returns false if the free plan is full. */
function claimForm_(formId) {
  var list = activeForms_();
  if (list.indexOf(formId) >= 0 && (isPro_() || list[0] === formId)) return true;
  if (!isPro_() && list.length && list[0] !== formId) return false;
  list = list.filter(function (id) { return id !== formId; });
  if (isPro_()) list.push(formId); else list = [formId].concat(list);
  userProps_().setProperty('fc.forms', JSON.stringify(list.slice(0, 200)));
  return true;
}

function releaseForm_(formId) {
  var list = activeForms_().filter(function (id) { return id !== formId; });
  userProps_().setProperty('fc.forms', JSON.stringify(list));
}

// ---------------------------------------------------------------------------
// PUBLIC (called from the sidebar)
// ---------------------------------------------------------------------------

function activateLicense(key) {
  var r = checkLicense_(key, myEmail_(), todayUtc_());
  if (!r.ok) return { ok: false, msg: r.msg };
  storeLicense_(String(key).trim());
  return { ok: true, plan: planInfo_() };
}

function removeLicense() {
  userProps_().deleteProperty('fc.license');
  planCache_ = null;
  return { ok: true, plan: planInfo_() };
}

/** Free plan: move the one active form slot to this form. The other form pauses itself. */
function useFreeSlotHere() {
  var id = FormApp.getActiveForm().getId();
  var list = activeForms_().filter(function (x) { return x !== id; });
  userProps_().setProperty('fc.forms', JSON.stringify([id].concat(list)));
  return { ok: true };
}

function storeLicense_(key) {
  userProps_().setProperty('fc.license', key);
  planCache_ = null;
}
