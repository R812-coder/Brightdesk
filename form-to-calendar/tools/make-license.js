#!/usr/bin/env node
/**
 * tools/make-license.js — generate Form to Calendar Bookings licence keys locally.
 * NOT uploaded to Apps Script (listed in .claspignore).
 *
 * Optional: the BrightDesk Admin sheet (KeyGenerator.gs) is the main way to make keys.
 *   FC_SECRET="same value as the LICENSE_SECRET script property" node tools/make-license.js buyer@acme.com pro 2027-10-29
 *   FC_SECRET="..." node tools/make-license.js admin@acme.com domain 2027-10-29 acme.com
 *
 * Expiry defaults to one year from today when omitted.
 */
const crypto = require('crypto');

const PREFIX = 'FCSK';
const secret = process.env.FC_SECRET;
const [email, plan = 'pro', expArg, domainArg] = process.argv.slice(2);

function fail(msg) { console.error(msg); process.exit(1); }

if (!secret) fail('Set FC_SECRET to the same value as the LICENSE_SECRET script property.');
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Usage: node tools/make-license.js buyer@x.com [pro|domain] [yyyy-mm-dd] [domain.com]');
if (plan !== 'pro' && plan !== 'domain') fail('Plan must be "pro" or "domain".');

let exp = expArg;
if (!exp) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  exp = d.toISOString().slice(0, 10);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) fail('Expiry must be yyyy-mm-dd.');

const domain = (domainArg || email.split('@')[1]).toLowerCase();
const data = plan === 'pro' ? { p: 'pro', e: email.toLowerCase(), d: domain, x: exp } : { p: 'domain', e: email.toLowerCase(), d: domain, x: exp };
const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(PREFIX + '-' + payload).digest('hex').slice(0, 8);

console.log(`${PREFIX}-${payload}--${sig}`);
