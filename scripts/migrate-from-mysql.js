// One-time helper: copy your existing local MySQL journal into Supabase.
//   1. Put the MYSQL_* lines (see .env.example) and DATABASE_URL in .env
//   2. npm run migrate
// Safe to re-run: existing days are updated, nothing is duplicated.
require('dotenv').config();
const mysql = require('mysql2/promise');
const { Pool, types } = require('pg');
types.setTypeParser(1082, (v) => v);

(async () => {
  const my = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'sparse_musings',
    dateStrings: true,
  });
  const u = new URL(process.env.DATABASE_URL);
  const pg = new Pool({
    host: u.hostname, port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'postgres',
    ssl: { rejectUnauthorized: false },
  });

  const [entries] = await my.query('SELECT name, `date`, title, content, mood FROM journal_entries ORDER BY `date`');
  for (const e of entries) {
    await pg.query(
      `INSERT INTO journal_entries (name, "date", title, content, mood) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name, "date") DO UPDATE SET title=EXCLUDED.title, content=EXCLUDED.content, mood=EXCLUDED.mood`,
      [e.name, e.date, e.title, e.content, e.mood]
    );
  }
  const [pro] = await my.query('SELECT name, intro, quote, loves, goals FROM journal_prologue');
  for (const p of pro) {
    await pg.query(
      `INSERT INTO journal_prologue (name, intro, quote, loves, goals) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name) DO UPDATE SET intro=EXCLUDED.intro, quote=EXCLUDED.quote, loves=EXCLUDED.loves, goals=EXCLUDED.goals`,
      [p.name, p.intro, p.quote, p.loves, p.goals]
    );
  }
  console.log(`Copied ${entries.length} journal page(s) and ${pro.length} prologue row(s) to Supabase.`);
  await my.end(); await pg.end();
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
