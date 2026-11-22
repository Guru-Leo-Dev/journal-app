// Local (username + password) accounts: password hashing, signed session tokens, rate limiting.
// Uses only Node's built-in crypto, so there is nothing extra to install.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const TOKEN_PREFIX = 'sm1';
const TOKEN_DAYS = 30;

// ---- passwords (scrypt + random salt) ----
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}
const DUMMY_HASH = 'scrypt:' + '00'.repeat(16) + ':' + '00'.repeat(64); // for equal timing on unknown users
async function verifyPassword(password, stored) {
  const parts = String(stored || DUMMY_HASH).split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  const actual = await scrypt(password, Buffer.from(parts[1], 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected) && stored !== DUMMY_HASH;
}

// ---- session tokens: sm1.<payload>.<hmac> ----
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const mac = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

function signToken(secret, user) {
  const payload = b64u(JSON.stringify({
    sub: user.id, name: user.name, un: user.username,
    exp: Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000,
  }));
  return `${TOKEN_PREFIX}.${payload}.${mac(secret, payload)}`;
}
function verifyToken(secret, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const good = Buffer.from(mac(secret, parts[1]));
  const given = Buffer.from(parts[2]);
  if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!p.sub || !(p.exp > Date.now())) return null;
    return { id: p.sub, name: p.name, username: p.un, email: '' };
  } catch (e) { return null; }
}
const isLocalToken = (t) => String(t || '').startsWith(TOKEN_PREFIX + '.');

// ---- the secret that signs tokens ----
// 1) SESSION_SECRET from the environment (best; required on hosts like Vercel)
// 2) a random one saved in .session-secret next to the app (local use)
// 3) if the disk is read-only (serverless), one derived from DATABASE_URL, which is secret and
//    identical on every server instance, so logins keep working. Set SESSION_SECRET to override.
function loadSecret(dir) {
  const fromEnv = (process.env.SESSION_SECRET || '').trim();
  if (fromEnv.length >= 16) return fromEnv;
  const file = path.join(dir, '.session-secret');
  try { const s = fs.readFileSync(file, 'utf8').trim(); if (s.length >= 16) return s; } catch (e) { /* create it */ }
  const s = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(file, s + '\n', { mode: 0o600 });
    console.log('Created .session-secret (keeps you signed in across restarts). Keep it private.');
    return s;
  } catch (e) {
    const base = (process.env.DATABASE_URL || '').trim();
    if (!base) throw new Error('Set SESSION_SECRET (any long random text) in the environment settings.');
    console.warn('SESSION_SECRET is not set; deriving it from DATABASE_URL. Set SESSION_SECRET for a dedicated secret.');
    return crypto.createHmac('sha256', 'sparse-musings-session-v1').update(base).digest('hex');
  }
}

// ---- input checks ----
const USERNAME_RE = /^[a-z0-9_.-]{3,30}$/;
function validUsername(u) { return USERNAME_RE.test(u); }
function validPassword(p) { return typeof p === 'string' && p.length >= 4 && p.length <= 128; }

// ---- tiny in-memory rate limiter (per key) ----
function createLimiter(max, windowMs) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      return !!h && h.reset > Date.now() && h.n >= max;
    },
    fail(key) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || h.reset <= now) hits.set(key, { n: 1, reset: now + windowMs });
      else h.n++;
      if (hits.size > 5000) hits.clear();
    },
    clear(key) { hits.delete(key); },
  };
}

module.exports = {
  hashPassword, verifyPassword, signToken, verifyToken, isLocalToken, loadSecret,
  validUsername, validPassword, createLimiter,
};
