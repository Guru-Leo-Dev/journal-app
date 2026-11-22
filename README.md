# Sparse Musings - journal app

A retro, book-style journal. HTML + CSS + JS in the browser, a small Node server in the middle, entries saved to a free **Supabase** (PostgreSQL) database in the cloud.

## 1. Set up Supabase (free, ~5 minutes)

1. Go to https://supabase.com and sign up (GitHub login is fine). No credit card needed for the Free plan.
2. Click **New project**. Pick a name (e.g. `sparse-musings`), choose the region closest to you (e.g. Mumbai / ap-south-1), and set a **Database password**. Use letters and numbers only (avoids URL-encoding problems) and save it somewhere. Create the project and wait ~1-2 minutes.
3. Click the **Connect** button at the top of the project page. Under **Connection string**, choose **Session pooler** (this one works over IPv4 on home networks; the "Direct connection" is IPv6-only on the free plan). Copy the URI. It looks like:
   `postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
4. Replace `[YOUR-PASSWORD]` with your real database password (remove the square brackets).
5. (Optional) Open **SQL Editor -> New query**, paste `supabase-schema.sql`, and Run. If you skip this, the server creates the tables itself on first start.

## 2. Choose how people sign in (`AUTH_MODE` in `.env`)

| AUTH_MODE | what you get | extra setup |
|-----------|--------------|-------------|
| `local` (default) | username + password accounts stored (hashed) in your Supabase database | none |
| `google` | "Continue with Google" via Supabase Auth | the Google steps below |
| `both` | both options on the login card | the Google steps below |

**Local mode:** run the app, click **Create account**, pick a username and password (4+ characters). To get your old `leo` pages, register the username set in `OWNER_USERNAME` (default `leo`). Once your own account exists you can set `ALLOW_SIGNUP=false` so nobody else can register. Login tokens last 30 days and are signed with `SESSION_SECRET` (auto-created in `.session-secret` if you leave it blank); there are limits on repeated wrong passwords.

### Google sign-in setup (only for `google` / `both`; free)

Supabase handles the login; Google only needs a free OAuth client.

1. **Google Cloud Console** (https://console.cloud.google.com) -> create a project (any name).
2. **APIs & Services -> OAuth consent screen** (shown as *Google Auth Platform* in newer consoles): choose **External**, fill in the app name (Sparse Musings) and your email, save. Under **Audience**, leave it in *Testing* and add your own and friends' Google emails as **test users**, or click **Publish app** so anyone can sign in (basic Google sign-in needs no review).
3. **Credentials -> Create credentials -> OAuth client ID -> Web application.**
   - *Authorized JavaScript origins:* `http://localhost:3000`
   - *Authorized redirect URIs:* `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` (Supabase shows the exact URL on its Google provider page)
   - Create, then copy the **Client ID** and **Client secret**.
4. **Supabase -> Authentication -> Sign In / Providers -> Google:** switch it on, paste the Client ID and secret, Save.
5. **Supabase -> Authentication -> URL Configuration:** set **Site URL** to `http://localhost:3000` and add `http://localhost:3000/**` under **Redirect URLs**.
6. **Supabase -> Project Settings -> API Keys:** copy the **Project URL** and the **anon / publishable key** into `.env` as `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Put your own Google email in `OWNER_EMAIL` so your old "leo" pages move into your account on first sign-in.

## 3. Run the app

```bash
npm install
cp .env.example .env      # then paste your DATABASE_URL into .env
npm start
```

Open http://localhost:3000, click **Continue with Google**, and your profile picture appears at the top (click it for **Sign out**). Check **Table Editor** in Supabase and you will see `journal_entries` and `journal_prologue` filling up as you write.

### Moving your old local MySQL pages (optional, one time)

Uncomment the `MYSQL_*` lines in `.env`, fill them in, then run `npm run migrate`. It copies every page and your prologue into Supabase (safe to re-run). They are attached to your account the first time you sign in with `OWNER_EMAIL`. If you already used the earlier Supabase version of this app, your `leo` pages are in the database already and are handled the same way.

### Free plan things to know

- A free project is **paused after 7 days of no activity**. Open the Supabase dashboard and click **Restore project** (your data is kept). Using the app regularly avoids this.
- Free storage is 500 MB, which is far more than a text journal will ever need.
- Keep `.env` private. Never commit it or share your `DATABASE_URL`: it is the key to your database.
- The tables have Row Level Security enabled, so the public Supabase API cannot read your journal; only your server (via the connection string) can.

On start the server creates the tables if they don't exist (same SQL as `supabase-schema.sql`).

## Deploy to Vercel (free)

1. Put the project on GitHub (the `.env` file is git-ignored, so it is **not** uploaded) and import the repo in Vercel. Leave the build settings as detected.
2. In Vercel -> **Project -> Settings -> Environment Variables**, add the values you have in `.env`:

   | name | value |
   |------|-------|
   | `DATABASE_URL` | Supabase -> Connect -> **Transaction pooler** string (port **6543**), with your password. Serverless works best with this one. |
   | `AUTH_MODE` | `local` (or `google` / `both`) |
   | `SESSION_SECRET` | any long random text (20+ characters); signs the login tokens |
   | `OWNER_USERNAME` | `leo` (receives your old pages) |
   | `ALLOW_SIGNUP` | `true` for now; set to `false` after you've created your account |
   | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OWNER_EMAIL` | only for Google sign-in |

3. **Redeploy** (environment variables only apply to new deployments).
4. Google sign-in only: add your Vercel address (e.g. `https://your-app.vercel.app`) to Google's *Authorized JavaScript origins* and to Supabase -> Authentication -> URL Configuration (Site URL / Redirect URLs).

Vercel's disk is read-only, so nothing is saved to files there; everything lives in Supabase. The wrong-password lockout is counted per server instance, so on Vercel it is a soft limit.

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

## Accounts

Each person who signs in (with a local account or Google) gets their own private journal (their own pages, prologue and mood tracker). The server checks the login token on every request and only ever reads or writes the signed-in person's rows.

## Database

`journal_entries`

| column  | type            | notes                                   |
|---------|-----------------|-----------------------------------------|
| id      | INTEGER, PK, identity |                                   |
| user_id | UUID            | the signed-in Supabase user (unique with date) |
| name    | VARCHAR(50)     | display name, for reference             |
| date    | DATE            | one page per day (unique with name)     |
| title   | VARCHAR(150)    |                                         |
| content | TEXT            |                                         |
| mood    | SMALLINT NULL   | 1-5, see above                          |
| created_at / updated_at | TIMESTAMPTZ | extras                     |

`journal_prologue` - one row per `user_id`: `intro`, `quote`, `loves`, `goals` (loves/goals are one item per line).

## API

```
GET    /api/config          public: Supabase URL + anon key for the login button
(all routes below need an Authorization: Bearer <token> header)
GET    /api/entries         all pages for the signed-in user
POST   /api/entries         create or update a day  { date, title, content, mood }
DELETE /api/entries/:id
GET    /api/prologue
PUT    /api/prologue        { intro, quote, loves, goals }
```

## Files

```
server.js                 Express + pg (Supabase) API, sign-in routes
auth-local.js             password hashing + signed login tokens (no extra packages)
supabase-schema.sql       table definitions (PostgreSQL)
scripts/migrate-from-mysql.js  one-time copy from your old local MySQL
public/index.html         page shell, popups, face + flower SVG symbols
public/style.css          both themes (CSS variables) and all page styles
public/app.js             book, page turning, pagination, mood tracker, prologue, date picker, themes
public/cover.png/.jpg     your cover (Sunset)
public/cover-meadow.*     green cover (Meadow)
```

Fonts (Shrikhand for headings, Kalam for the handwriting) load from Google Fonts, so the first load needs internet. Without it the app falls back to system cursive fonts.
