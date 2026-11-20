# Sparse Musings - journal app

A retro, book-style journal. HTML + CSS + JS in the browser, a small Node server in the middle, entries saved to your local MySQL.

## Run it

1. Install Node 18+ and make sure MySQL is running locally.
2. In this folder:
   ```bash
   npm install
   cp .env.example .env      # then put your MySQL user/password in .env
   npm start
   ```
3. Open http://localhost:3000

On start the server creates the `sparse_musings` database and tables if they don't exist, and **upgrades an existing v1 table** by adding the new `mood` column automatically (the same SQL is in `schema.sql` if you prefer to run it yourself).

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
| id      | INT, PK, auto   |                                         |
| name    | VARCHAR(50)     | hardcoded to `leo` (`JOURNAL_NAME` in .env) |
| date    | DATE            | one page per day (unique with name)     |
| title   | VARCHAR(150)    |                                         |
| content | TEXT            |                                         |
| mood    | TINYINT NULL    | 1-5, see above                          |
| created_at / updated_at | TIMESTAMP | extras                       |

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
server.js                 Express + mysql2 API
schema.sql                table definitions
public/index.html         page shell, popups, face + flower SVG symbols
public/style.css          both themes (CSS variables) and all page styles
public/app.js             book, page turning, pagination, mood tracker, prologue, date picker, themes
public/cover.png/.jpg     your cover (Sunset)
public/cover-meadow.*     green cover (Meadow)
```

Fonts (Shrikhand for headings, Kalam for the handwriting) load from Google Fonts, so the first load needs internet. Without it the app falls back to system cursive fonts.
