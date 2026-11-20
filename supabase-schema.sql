-- Sparse Musings schema for Supabase (PostgreSQL)
-- Optional: the server creates these automatically on start, but you can also paste this
-- into Supabase -> SQL Editor -> New query -> Run.

CREATE TABLE IF NOT EXISTS journal_entries (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       VARCHAR(50)  NOT NULL DEFAULT 'leo',
  "date"     DATE         NOT NULL,
  title      VARCHAR(150) NOT NULL,
  content    TEXT         NOT NULL,
  mood       SMALLINT     NULL CHECK (mood BETWEEN 1 AND 5),  -- 5 joyful, 4 good, 3 okay, 2 low, 1 angry
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_name_date UNIQUE (name, "date")               -- one page per day per person
);

CREATE TABLE IF NOT EXISTS journal_prologue (
  name       VARCHAR(50)  PRIMARY KEY,
  intro      TEXT         NULL,
  quote      VARCHAR(300) NULL,
  loves      TEXT         NULL,   -- one item per line
  goals      TEXT         NULL,   -- one item per line
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Keep the journal private: block Supabase's public Data API (anon key) from these tables.
-- The Node server connects directly as the database owner, which is not affected by RLS.
ALTER TABLE journal_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_prologue ENABLE ROW LEVEL SECURITY;
