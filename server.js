// Sparse Musings - Express + Supabase (PostgreSQL) backend
require('dotenv').config();
const path = require('path');
const express = require('express');
const { Pool, types } = require('pg');

const PORT = Number(process.env.PORT) || 3000;
const AUTHOR = (process.env.JOURNAL_NAME || 'leo').trim() || 'leo'; // hardcoded owner

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

  // Creates the tables if you haven't run supabase-schema.sql yet (safe to run every start)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name       VARCHAR(50)  NOT NULL DEFAULT 'leo',
      "date"     DATE         NOT NULL,
      title      VARCHAR(150) NOT NULL,
      content    TEXT         NOT NULL,
      mood       SMALLINT     NULL CHECK (mood BETWEEN 1 AND 5),
      created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
      CONSTRAINT uq_name_date UNIQUE (name, "date")
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal_prologue (
      name       VARCHAR(50)  PRIMARY KEY,
      intro      TEXT         NULL,
      quote      VARCHAR(300) NULL,
      loves      TEXT         NULL,
      goals      TEXT         NULL,
      updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `);
  // Lock the tables away from Supabase's public Data API. This server connects as the
  // database owner (which bypasses RLS), so the app still works, but nobody can read
  // your journal through the public anon key.
  await pool.query('ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY');
  await pool.query('ALTER TABLE journal_prologue ENABLE ROW LEVEL SECURITY');
  return pool;
}

const clean = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);

async function main() {
  const pool = await initDatabase();
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // ---------- journal pages ----------

  // All pages, oldest first (the book reads front to back)
  app.get('/api/entries', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, name, "date", title, content, mood FROM journal_entries WHERE name = $1 ORDER BY "date" ASC, id ASC',
        [AUTHOR]
      );
      res.json({ name: AUTHOR, entries: rows });
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
        `INSERT INTO journal_entries (name, "date", title, content, mood)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name, "date") DO UPDATE
           SET title = EXCLUDED.title, content = EXCLUDED.content, mood = EXCLUDED.mood, updated_at = now()
         RETURNING id, name, "date", title, content, mood`,
        [AUTHOR, date, title, content, mood]
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
      await pool.query('DELETE FROM journal_entries WHERE id = $1 AND name = $2', [id, AUTHOR]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not delete the entry.' });
    }
  });

  // ---------- prologue (the intro page) ----------

  app.get('/api/prologue', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT intro, quote, loves, goals FROM journal_prologue WHERE name = $1',
        [AUTHOR]
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
        `INSERT INTO journal_prologue (name, intro, quote, loves, goals)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name) DO UPDATE
           SET intro = EXCLUDED.intro, quote = EXCLUDED.quote, loves = EXCLUDED.loves,
               goals = EXCLUDED.goals, updated_at = now()`,
        [AUTHOR, intro, quote, loves, goals]
      );
      res.json({ intro, quote, loves, goals });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not save the prologue.' });
    }
  });

  app.listen(PORT, () => {
    console.log(`Sparse Musings is open at http://localhost:${PORT}  (journal of "${AUTHOR}", stored in Supabase)`);
  });
}

main().catch((err) => {
  console.error('Failed to start. Check DATABASE_URL in .env\n', err.message);
  process.exit(1);
});
