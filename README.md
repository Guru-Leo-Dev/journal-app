# Sparse Musings - journal app

A retro, book-style journal. HTML + CSS + JS in the browser, a small Node server in the middle, entries saved to a free **Supabase** (PostgreSQL) database in the cloud.

## 1. Set up Supabase (free, ~5 minutes)

1. Go to https://supabase.com and sign up (GitHub login is fine). No credit card needed for the Free plan.
2. Click **New project**. Pick a name (e.g. `sparse-musings`), choose the region closest to you (e.g. Mumbai / ap-south-1), and set a **Database password**. Use letters and numbers only (avoids URL-encoding problems) and save it somewhere. Create the project and wait ~1-2 minutes.
3. Click the **Connect** button at the top of the project page. Under **Connection string**, choose **Session pooler** (this one works over IPv4 on home networks; the "Direct connection" is IPv6-only on the free plan). Copy the URI. It looks like:
   `postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
4. Replace `[YOUR-PASSWORD]` with your real database password (remove the square brackets).
5. (Optional) Open **SQL Editor -> New query**, paste `supabase-schema.sql`, and Run. If you skip this, the server creates the tables itself on first start.

## 2. Run the app

```bash
npm install
cp .env.example .env      # then paste your DATABASE_URL into .env
npm start
```

Open http://localhost:3000. Check **Table Editor** in Supabase and you will see `journal_entries` and `journal_prologue` filling up as you write.

### Moving your old local MySQL pages (optional, one time)

Uncomment the `MYSQL_*` lines in `.env`, fill them in, then run `npm run migrate`. It copies every page and your prologue into Supabase and can be re-run safely.

### Free plan things to know

- A free project is **paused after 7 days of no activity**. Open the Supabase dashboard and click **Restore project** (your data is kept). Using the app regularly avoids this.
- Free storage is 500 MB, which is far more than a text journal will ever need.
- Keep `.env` private. Never commit it or share your `DATABASE_URL`: it is the key to your database.
- The tables have Row Level Security enabled, so the public Supabase API cannot read your journal; only your server (via the connection string) can.

On start the server creates the tables if they don't exist (same SQL as `supabase-schema.sql`).

## Book layout

| page | what it is |
|------|------------|
| Cover | your cover image (themed: orange or green) |
| i - Prologue | intro, a quote you live by, things you love, dreams & goals (pencil button edits it) |
| ii - Mood Tracker | line of colourful faces over your last 14 moods, this month's calendar of faces, and totals |
| 1, 2, 3 ... | one A4 page per day, sorted by date (long entries continue on the next page, nothing scrolls) |
| last | blank page reminding you to press **+** |

Left/right round buttons (or the arrow keys) turn the pages.

## Mood tracker

Pick how you feel in the popup when you add a day (click a face again to clear it):

| value | face | colour |
|-------|------|--------|
| 5 | Joyful | green |
| 4 | Good | light green |
| 3 | Okay | yellow |
| 2 | Low | orange |
| 1 | Angry | red |

The mood shows as a badge on that day's page and as a point on the tracker line.

## Themes

The palette button (top right of the book) switches between:

- **Sunset** - the original orange cover
- **Meadow** - the same design with green predominant (and an orange accent), including a recoloured cover (`cover-meadow.png`)

Your choice is remembered in the browser.

## Database

`journal_entries`

| column  | type            | notes                                   |
|---------|-----------------|-----------------------------------------|
| id      | INTEGER, PK, identity |                                   |
| name    | VARCHAR(50)     | hardcoded to `leo` (`JOURNAL_NAME` in .env) |
| date    | DATE            | one page per day (unique with name)     |
| title   | VARCHAR(150)    |                                         |
| content | TEXT            |                                         |
| mood    | SMALLINT NULL   | 1-5, see above                          |
| created_at / updated_at | TIMESTAMPTZ | extras                     |

`journal_prologue` - one row per `name`: `intro`, `quote`, `loves`, `goals` (loves/goals are one item per line).

## API

```
GET    /api/entries         all pages for the journal owner
POST   /api/entries         create or update a day  { date, title, content, mood }
DELETE /api/entries/:id
GET    /api/prologue
PUT    /api/prologue        { intro, quote, loves, goals }
```

## Files

```
server.js                 Express + pg (Supabase) API
supabase-schema.sql       table definitions (PostgreSQL)
scripts/migrate-from-mysql.js  one-time copy from your old local MySQL
public/index.html         page shell, popups, face + flower SVG symbols
public/style.css          both themes (CSS variables) and all page styles
public/app.js             book, page turning, pagination, mood tracker, prologue, date picker, themes
public/cover.png/.jpg     your cover (Sunset)
public/cover-meadow.*     green cover (Meadow)
```

Fonts (Shrikhand for headings, Kalam for the handwriting) load from Google Fonts, so the first load needs internet. Without it the app falls back to system cursive fonts.
