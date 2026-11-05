/**
 * Retry.gs — failed creates are retried on the next submission and every time the
 * owner opens the sidebar, at most every 15 minutes each, up to 24 tries.
 *
 * HOURLY TRIGGER: off by default. Turn HOURLY_ENABLED_ to true ONLY if the
 * Expiration Date Reminders scope spike proved that an add-on time trigger can reach
 * the active document with a *.currentonly scope. No new scope is needed for it
 * (script.scriptapp already covers time triggers), but it is a second trigger per form.
 */

var RETRY_MAX_ = 24;
var RETRY_GAP_MS_ = 15 * 60 * 1000;
var HOURLY_ENABLED_ = false;

/** Add or bump a retry entry. Returns the entry. */
function queueRetry_(responseId, reason, who) {
  var list = getJson_('fc.retry', []);
  var now = Date.now();
  var entry = null;
  list.forEach(function (r) { if (r.id === responseId) entry = r; });
  if (entry) {
    entry.tries = (entry.tries || 0) + 1;
    entry.last = now;
    entry.reason = String(reason).slice(0, 300);
    if (who) entry.who = who;
  } else {
    entry = { id: responseId, tries: 1, first: now, last: now, reason: String(reason).slice(0, 300), who: who || '' };
    list.push(entry);
  }
  list = list.filter(function (r) { return r.tries <= RETRY_MAX_; }).slice(-100);
  putJson_('fc.retry', list);
  return entry;
}

function dropRetry_(responseId) {
  var list = getJson_('fc.retry', []);
  var next = list.filter(function (r) { return r.id !== responseId; });
  if (next.length !== list.length) putJson_('fc.retry', next);
}

/** Retry queued responses. opts = { max, force }. Returns { tried, ok }. */
function runRetries_(form, cfg, pro, opts) {
  opts = opts || {};
  var list = getJson_('fc.retry', []);
  var now = Date.now(), tried = 0, ok = 0;
  for (var i = 0; i < list.length && tried < (opts.max || 5); i++) {
    var r = list[i];
    if (!opts.force && now - (r.last || 0) < RETRY_GAP_MS_) continue;
    if (r.tries >= RETRY_MAX_) continue;
    var response = null;
    try { response = form.getResponse(r.id); } catch (e) { response = null; }
    if (!response) { dropRetry_(r.id); continue; } // response deleted
    tried++;
    var result = runOne_(form, response, cfg, pro, true);
    if (result !== 'Failed') ok++;
  }
  return { tried: tried, ok: ok };
}

/** Optional hourly job (see HOURLY_ENABLED_). */
function hourlyJob(e) {
  if (!HOURLY_ENABLED_) return;
  var lock = getLock_();
  if (!lock.tryLock(10000)) return;
  try {
    var cfg = loadConfig_();
    if (!cfg || !cfg.active || !iAmOwner_()) return;
    var form = FormApp.getActiveForm();
    var pro = isPro_();
    runRetries_(form, cfg, pro, { max: 10 });
    if (pro && cfg.pro.slots) safeRefreshSlots_(cfg);
  } finally { lock.releaseLock(); }
}

function ensureHourly_(form) {
  if (!HOURLY_ENABLED_) return;
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'hourlyJob'; });
  if (!has) ScriptApp.newTrigger('hourlyJob').timeBased().everyHours(1).create();
}
