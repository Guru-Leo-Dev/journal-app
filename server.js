// Sparse Musings - Express + MySQL backend
require('dotenv').config();
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');

const PORT = Number(process.env.PORT) || 3000;
const AUTHOR = (process.env.JOURNAL_NAME || 'leo').trim() || 'leo'; // hardcoded owner
const DB_NAME = process.env.DB_NAME || 'sparse_musings';

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
};

const MAX_TITLE = 150;
const MAX_CONTENT = 5000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

async function initDatabase() {
  // Create the database and tables if they don't exist yet
  const boot = await mysql.createConnection(dbConfig);
  await boot.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await boot.end();

  const pool = mysql.createPool({
    ...dbConfig,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    dateStrings: true, // return DATE columns as 'YYYY-MM-DD' strings (no timezone shifts)
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name       VARCHAR(50)  NOT NULL DEFAULT 'leo',
      \`date\`     DATE         NOT NULL,
      title      VARCHAR(150) NOT NULL,
      content    TEXT         NOT NULL,
      mood       TINYINT UNSIGNED NULL,
      created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_name_date (name, \`date\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Upgrade an older table (created before the mood tracker existed)
  const [cols] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'journal_entries' AND COLUMN_NAME = 'mood'`,
    [DB_NAME]
  );
  if (!cols[0].n) {
    await pool.query('ALTER TABLE journal_entries ADD COLUMN mood TINYINT UNSIGNED NULL AFTER content');
    console.log('Added the mood column to journal_entries.');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal_prologue (
      name       VARCHAR(50)  NOT NULL,
      intro      TEXT         NULL,
      quote      VARCHAR(300) NULL,
      loves      TEXT         NULL,
      goals      TEXT         NULL,
      updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
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
      const [rows] = await pool.query(
        'SELECT id, name, `date`, title, content, mood FROM journal_entries WHERE name = ? ORDER BY `date` ASC, id ASC',
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
      await pool.query(
        `INSERT INTO journal_entries (name, \`date\`, title, content, mood)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content), mood = VALUES(mood)`,
        [AUTHOR, date, title, content, mood]
      );
      const [rows] = await pool.query(
        'SELECT id, name, `date`, title, content, mood FROM journal_entries WHERE name = ? AND `date` = ?',
        [AUTHOR, date]
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
      await pool.query('DELETE FROM journal_entries WHERE id = ? AND name = ?', [id, AUTHOR]);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not delete the entry.' });
    }
  });

  // ---------- prologue (the intro page) ----------

  app.get('/api/prologue', async (_req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT intro, quote, loves, goals FROM journal_prologue WHERE name = ?',
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
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE intro = VALUES(intro), quote = VALUES(quote), loves = VALUES(loves), goals = VALUES(goals)`,
        [AUTHOR, intro, quote, loves, goals]
      );
      res.json({ intro, quote, loves, goals });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not save the prologue.' });
    }
  });

  app.listen(PORT, () => {
    console.log(`Sparse Musings is open at http://localhost:${PORT}  (journal of "${AUTHOR}")`);
  });
}

main().catch((err) => {
  console.error('Failed to start. Check your MySQL settings in .env\n', err.message);
  process.exit(1);
});
