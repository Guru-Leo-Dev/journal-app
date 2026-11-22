// Sparse Musings - Express + Supabase (PostgreSQL) backend
require('dotenv').config();
const path = require('path');
const express = require('express');
const { Pool, types } = require('pg');
const local = require('./auth-local');

const PORT = Number(process.env.PORT) || 3000;
// Supabase Auth (Google sign-in). The URL and anon/publishable key are public by design.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();
// Pages written before sign-in existed (saved under the name "leo") are handed to the person
// who signs in with OWNER_EMAIL the first time they log in.
const LEGACY_NAME = (process.env.JOURNAL_NAME || 'leo').trim() || 'leo';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').trim().toLowerCase();

// Which sign-in methods are on: local (username + password in the database), google, or both
const AUTH_MODE = (process.env.AUTH_MODE || 'local').trim().toLowerCase();
if (!['local', 'google', 'both'].includes(AUTH_MODE)) {
  console.error('AUTH_MODE must be local, google or both (got "' + AUTH_MODE + '"). Check .env');
  process.exit(1);
}
const USE_LOCAL = AUTH_MODE === 'local' || AUTH_MODE === 'both';
const USE_GOOGLE = AUTH_MODE === 'google' || AUTH_MODE === 'both';
const ALLOW_SIGNUP = String(process.env.ALLOW_SIGNUP || 'true').trim().toLowerCase() !== 'false';
// With local sign-in, the account with this username receives the pages written before accounts existed
const OWNER_USERNAME = (process.env.OWNER_USERNAME || LEGACY_NAME).trim().toLowerCase();
const SESSION_SECRET = USE_LOCAL ? local.loadSecret(__dirname) : '';

// Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifts)
types.setTypeParser(1082, (v) => v);

// ---------- Supabase connection ----------
// DATABASE_URL is the connection string from Supabase (Connect -> Session pooler).
function buildDbConfig() {
  const raw = (process.env.DATABASE_URL || '').trim();
  if (!raw || raw.includes('[YOUR-PASSWORD]')) {
    throw new Error(
      'DATABASE_URL is missing. Copy .env.example to .env and paste your Supabase connection string ' +
        '(with your real database password) into it. See README.md.'
    );
  }
  const u = new URL(raw);
  return {
    host: u.hostname,
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    // Supabase requires TLS. Its certificate chain isn't in Node's default trust store,
    // so we encrypt the connection without verifying the chain (fine for a personal app).
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

const MAX_TITLE = 150;
const MAX_CONTENT = 5000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

async function initDatabase() {
  const pool = new Pool(buildDbConfig());
  // Idle connections can be dropped by the pooler; don't crash on that.
  pool.on('error', (err) => console.error('Idle database client error:', err.message));

  // Creates / upgrades the tables (safe to run every start)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id    UUID         NULL,
      name       VARCHAR(50)  NULL,
      "date"     DATE         NOT NULL,
      title      VARCHAR(150) NOT NULL,
      content    TEXT         NOT NULL,
      mood       SMALLINT     NULL CHECK (mood BETWEEN 1 AND 5),
      created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal_prologue (
      user_id    UUID         NULL,
      name       VARCHAR(50)  NULL,
      intro      TEXT         NULL,
      quote      VARCHAR(300) NULL,
      loves      TEXT         NULL,
      goals      TEXT         NULL,
      updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal_users (
      id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      username      VARCHAR(30)  NOT NULL,
      display_name  VARCHAR(50)  NOT NULL,
      password_hash TEXT         NOT NULL,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON journal_users (lower(username))');
  // Upgrade from the single-user (name = 'leo') version
  await pool.query('ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS user_id UUID NULL');
  await pool.query('ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS uq_name_date');
  await pool.query('ALTER TABLE journal_entries ALTER COLUMN name DROP NOT NULL');
  await pool.query('ALTER TABLE journal_prologue ADD COLUMN IF NOT EXISTS user_id UUID NULL');
  await pool.query('ALTER TABLE journal_prologue DROP CONSTRAINT IF EXISTS journal_prologue_pkey');
  await pool.query('ALTER TABLE journal_prologue ALTER COLUMN name DROP NOT NULL');
  // One page per day per user, one prologue per user
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_user_date ON journal_entries (user_id, "date")');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_prologue_user ON journal_prologue (user_id)');
  // Lock the tables away from Supabase's public Data API. This server connects as the
  // database owner (which bypasses RLS), so the app still works, but nobody can read
  // anyone's journal through the public anon key.
  await pool.query('ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY');
  await pool.query('ALTER TABLE journal_prologue ENABLE ROW LEVEL SECURITY');
  await pool.query('ALTER TABLE journal_users ENABLE ROW LEVEL SECURITY');
  return pool;
}

const clean = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);


// ---------- auth: check the login token on every API call ----------
const tokenCache = new Map(); // token -> { user, exp }
const claimed = new Set();    // users whose legacy pages were already handed over

async function verifyGoogleToken(token) {
  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u || !u.id) return null;
  const meta = u.user_metadata || {};
  const user = {
    id: u.id,
    email: String(u.email || '').toLowerCase(),
    name: String(meta.full_name || meta.name || (u.email || '').split('@')[0] || 'friend').slice(0, 50),
  };
  tokenCache.set(token, { user, exp: Date.now() + 60 * 1000 });
  if (tokenCache.size > 500) tokenCache.clear();
  return user;
}

// A token is either one of ours (local sign-in) or a Google/Supabase one
async function verifyToken(token) {
  if (local.isLocalToken(token)) return USE_LOCAL ? local.verifyToken(SESSION_SECRET, token) : null;
  return USE_GOOGLE ? verifyGoogleToken(token) : null;
}

async function claimLegacyPages(pool, user) {
  const isOwner = (OWNER_EMAIL && user.email === OWNER_EMAIL) || (user.username && user.username === OWNER_USERNAME);
  if (!isOwner || claimed.has(user.id)) return;
  claimed.add(user.id);
  try {
    await pool.query(
      `UPDATE journal_entries SET user_id = $1
       WHERE user_id IS NULL AND name = $2
         AND NOT EXISTS (SELECT 1 FROM journal_entries x WHERE x.user_id = $1 AND x."date" = journal_entries."date")`,
      [user.id, LEGACY_NAME]
    );
    await pool.query(
      `UPDATE journal_prologue SET user_id = $1
       WHERE user_id IS NULL AND name = $2
         AND NOT EXISTS (SELECT 1 FROM journal_prologue x WHERE x.user_id = $1)`,
      [user.id, LEGACY_NAME]
    );
  } catch (err) {
    claimed.delete(user.id);
    console.error('Could not hand over the old pages:', err.message);
  }
}

function requireUser(pool) {
  return async (req, res, next) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ error: 'Please sign in.' });
    try {
      const user = await verifyToken(m[1]);
      if (!user) return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
      req.user = user;
      await claimLegacyPages(pool, user);
      next();
    } catch (err) {
      console.error('Auth check failed:', err.message);
      res.status(500).json({ error: 'Could not check your login.' });
    }
  };
}

async function main() {
  if (USE_GOOGLE && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
    throw new Error('AUTH_MODE=' + AUTH_MODE + ' needs SUPABASE_URL and SUPABASE_ANON_KEY in .env');
  }
  const pool = await initDatabase();
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // Public: tells the browser which sign-in methods to show
  app.get('/api/config', (_req, res) => {
    const cfg = { mode: AUTH_MODE, local: USE_LOCAL, allowSignup: USE_LOCAL && ALLOW_SIGNUP, google: null };
    if (USE_GOOGLE) cfg.google = { supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY };
    res.json(cfg);
  });

  // ---------- local accounts: register / log in ----------
  const loginLimiter = local.createLimiter(8, 15 * 60 * 1000);     // failed log-ins per IP+username
  const signupLimiter = local.createLimiter(10, 60 * 60 * 1000);   // sign-ups per IP

  function sessionFor(row) {
    const user = { id: row.id, username: row.username, name: row.display_name, email: '' };
    return { token: local.signToken(SESSION_SECRET, user), user: { name: user.name, username: user.username } };
  }

  if (USE_LOCAL) {
    app.post('/api/auth/register', async (req, res) => {
      if (!ALLOW_SIGNUP) return res.status(403).json({ error: 'New accounts are turned off.' });
      const username = String(req.body.username || '').trim().toLowerCase();
      const password = req.body.password;
      const displayName = clean(req.body.displayName, 50) || username;
      if (signupLimiter.blocked(req.ip)) return res.status(429).json({ error: 'Too many sign-ups. Try again later.' });
      if (!local.validUsername(username)) {
        return res.status(400).json({ error: 'Username: 3-30 letters, numbers, dot, dash or underscore.' });
      }
      if (!local.validPassword(password)) return res.status(400).json({ error: 'Password must be 4-128 characters.' });
      try {
        signupLimiter.fail(req.ip);
        const hash = await local.hashPassword(password);
        const { rows } = await pool.query(
          `INSERT INTO journal_users (username, display_name, password_hash) VALUES ($1, $2, $3)
           RETURNING id, username, display_name`,
          [username, displayName, hash]
        );
        res.status(201).json(sessionFor(rows[0]));
      } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'That username is taken.' });
        console.error(err);
        res.status(500).json({ error: 'Could not create the account.' });
      }
    });

    app.post('/api/auth/login', async (req, res) => {
      const username = String(req.body.username || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const key = req.ip + '|' + username;
      if (loginLimiter.blocked(key)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
      try {
        const { rows } = await pool.query(
          'SELECT id, username, display_name, password_hash FROM journal_users WHERE lower(username) = $1',
          [username]
        );
        const row = rows[0];
        const ok = await local.verifyPassword(password.slice(0, 128), row && row.password_hash);
        if (!row || !ok) {
          loginLimiter.fail(key);
          return res.status(401).json({ error: 'Wrong username or password.' });
        }
        loginLimiter.clear(key);
        res.json(sessionFor(row));
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not sign you in.' });
      }
    });
  }

  // Everything below needs a signed-in user
  app.use(['/api/entries', '/api/prologue', '/api/auth/me'], requireUser(pool));
  app.get('/api/auth/me', (req, res) => res.json({ name: req.user.name, username: req.user.username || '', email: req.user.email || '' }));

  // ---------- journal pages ----------

  // All pages, oldest first (the book reads front to back)
  app.get('/api/entries', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, name, "date", title, content, mood FROM journal_entries WHERE user_id = $1 ORDER BY "date" ASC, id ASC',
        [req.user.id]
      );
      res.json({ name: req.user.name, entries: rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load entries.' });
    }
  });

  // Create a page, or update it if that day already has one
  app.post('/api/entries', async (req, res) => {
    const date = String(req.body.date || '').trim();
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').replace(/\r\n/g, '\n').trim();
    let mood = req.body.mood;
    mood = mood === null || mood === undefined || mood === '' ? null : Number(mood);

    if (!isRealDate(date)) return res.status(400).json({ error: 'Please pick a valid date.' });
    if (!title) return res.status(400).json({ error: 'Please give the page a title.' });
    if (!content) return res.status(400).json({ error: 'The page is empty - write something!' });
    if (title.length > MAX_TITLE) return res.status(400).json({ error: `Title is too long (max ${MAX_TITLE}).` });
    if (content.length > MAX_CONTENT) return res.status(400).json({ error: `Entry is too long (max ${MAX_CONTENT}).` });
    if (mood !== null && !(Number.isInteger(mood) && mood >= 1 && mood <= 5)) {
      return res.status(400).json({ error: 'Mood must be between 1 and 5.' });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO journal_entries (user_id, name, "date", title, content, mood)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, "date") DO UPDATE
           SET title = EXCLUDED.title, content = EXCLUDED.content, mood = EXCLUDED.mood, updated_at = now()
         RETURNING id, name, "date", title, content, mood`,
        [req.user.id, req.user.name, date, title, content, mood]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not save the entry.' });
    }
  });

  app.delete('/api/entries/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Bad id.' });
    try {
      await pool.query('DELETE FROM journal_entries WHERE id = $1 AND user_id = $2', [id, req.user.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not delete the entry.' });
    }
  });

  // ---------- prologue (the intro page) ----------

  app.get('/api/prologue', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT intro, quote, loves, goals FROM journal_prologue WHERE user_id = $1',
        [req.user.id]
      );
      const r = rows[0] || {};
      res.json({ intro: r.intro || '', quote: r.quote || '', loves: r.loves || '', goals: r.goals || '' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not load the prologue.' });
    }
  });

  app.put('/api/prologue', async (req, res) => {
    const intro = clean(req.body.intro, 450);
    const quote = clean(req.body.quote, 140);
    const loves = clean(req.body.loves, 300);
    const goals = clean(req.body.goals, 300);
    try {
      await pool.query(
        `INSERT INTO journal_prologue (user_id, name, intro, quote, loves, goals)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE
           SET intro = EXCLUDED.intro, quote = EXCLUDED.quote, loves = EXCLUDED.loves,
               goals = EXCLUDED.goals, updated_at = now()`,
        [req.user.id, req.user.name, intro, quote, loves, goals]
      );
      res.json({ intro, quote, loves, goals });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not save the prologue.' });
    }
  });

  app.listen(PORT, () => {
    console.log(`Sparse Musings is open at http://localhost:${PORT}  (sign-in: ${AUTH_MODE})`);
  });
}

main().catch((err) => {
  console.error('Failed to start. Check DATABASE_URL in .env\n', err.message);
  process.exit(1);
});
