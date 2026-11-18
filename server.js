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
  // Create the database and table if they don't exist yet
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
      created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_name_date (name, \`date\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  return pool;
}

async function main() {
  const pool = await initDatabase();
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // All pages, oldest first (the book reads front to back)
  app.get('/api/entries', async (_req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT id, name, `date`, title, content FROM journal_entries WHERE name = ? ORDER BY `date` ASC, id ASC',
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

    if (!isRealDate(date)) return res.status(400).json({ error: 'Please pick a valid date.' });
    if (!title) return res.status(400).json({ error: 'Please give the page a title.' });
    if (!content) return res.status(400).json({ error: 'The page is empty - write something!' });
    if (title.length > MAX_TITLE) return res.status(400).json({ error: `Title is too long (max ${MAX_TITLE}).` });
    if (content.length > MAX_CONTENT) return res.status(400).json({ error: `Entry is too long (max ${MAX_CONTENT}).` });

    try {
      await pool.query(
        `INSERT INTO journal_entries (name, \`date\`, title, content)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content)`,
        [AUTHOR, date, title, content]
      );
      const [rows] = await pool.query(
        'SELECT id, name, `date`, title, content FROM journal_entries WHERE name = ? AND `date` = ?',
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

  app.listen(PORT, () => {
    console.log(`Sparse Musings is open at http://localhost:${PORT}  (journal of "${AUTHOR}")`);
  });
}

main().catch((err) => {
  console.error('Failed to start. Check your MySQL settings in .env\n', err.message);
  process.exit(1);
});
