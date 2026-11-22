// Forgot your password? Set a new one (or a PIN) straight in the database:
//   npm run reset-password -- <username> <new-password>
// Example: npm run reset-password -- leo 1234
require('dotenv').config();
const { Pool } = require('pg');
const local = require('../auth-local');

(async () => {
  const username = String(process.argv[2] || '').trim().toLowerCase();
  const password = process.argv[3];
  if (!username || !local.validPassword(password)) {
    console.error('Usage: npm run reset-password -- <username> <new-password (4+ characters)>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is missing in .env'); process.exit(1); }
  const u = new URL(process.env.DATABASE_URL);
  const pool = new Pool({
    host: u.hostname, port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'postgres', ssl: { rejectUnauthorized: false },
  });
  const r = await pool.query('UPDATE journal_users SET password_hash = $1 WHERE lower(username) = $2',
    [await local.hashPassword(password), username]);
  console.log(r.rowCount ? `Password for "${username}" has been changed.` : `No account named "${username}" was found.`);
  await pool.end();
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
