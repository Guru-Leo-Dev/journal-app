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

On start the server creates the `sparse_musings` database and the `journal_entries` table if they don't exist (the same SQL is in `schema.sql` if you prefer to run it yourself).

## Table

| column  | type            | notes                                   |
|---------|-----------------|-----------------------------------------|
| id      | INT, PK, auto   |                                         |
| name    | VARCHAR(50)     | hardcoded to `leo` (`JOURNAL_NAME` in .env) |
| date    | DATE            | one page per day (unique with name)     |
| title   | VARCHAR(150)    |                                         |
| content | TEXT            |                                         |
| created_at / updated_at | TIMESTAMP | extras, handy later          |

Saving a date that already has a page updates that page.

## Using the journal

- Page 1 is the cover. The small round buttons on the left/right turn to the previous/next page (arrow keys work too).
- Each day is one A4 page, sorted by date. Nothing scrolls: if an entry is longer than one page, it continues onto the next page automatically.
- The yellow **+** button opens the popup: pick a date (themed calendar, dots mark days that already have a page), add a title and write.
- The little pencil at the bottom-left of a page edits it; the popup also has Delete.

## Files

```
server.js          Express + mysql2 API  (GET/POST /api/entries, DELETE /api/entries/:id)
schema.sql         table definition
public/index.html  page shell + popup
public/style.css   theme (palette sampled from your cover)
public/app.js      book, page turning, pagination, date picker
public/cover.png   your cover (cover.jpg is used as a fallback)
```

Fonts (Shrikhand for headings, Kalam for the handwriting) load from Google Fonts, so the first load needs internet. Without it the app falls back to system cursive fonts.
