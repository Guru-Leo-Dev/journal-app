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
    // user_id stays empty; it is filled in when OWNER_EMAIL first signs in
    await pg.query(
      `INSERT INTO journal_entries (name, "date", title, content, mood)
       SELECT $1::varchar, $2::date, $3::varchar, $4::text, $5::smallint
       WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE user_id IS NULL AND name = $1 AND "date" = $2::date)`,
      [e.name, e.date, e.title, e.content, e.mood]
    );
  }
  const [pro] = await my.query('SELECT name, intro, quote, loves, goals FROM journal_prologue');
  for (const p of pro) {
    await pg.query(
      `INSERT INTO journal_prologue (name, intro, quote, loves, goals)
       SELECT $1::varchar, $2::text, $3::varchar, $4::text, $5::text
       WHERE NOT EXISTS (SELECT 1 FROM journal_prologue WHERE user_id IS NULL AND name = $1)`,
      [p.name, p.intro, p.quote, p.loves, p.goals]
    );
  }
  console.log(`Copied ${entries.length} journal page(s) and ${pro.length} prologue row(s) to Supabase.`);
  await my.end(); await pg.end();
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
