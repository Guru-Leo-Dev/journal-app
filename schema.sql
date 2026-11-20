-- Sparse Musings schema (the server also creates / upgrades this automatically on start)
CREATE DATABASE IF NOT EXISTS sparse_musings
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE sparse_musings;

CREATE TABLE IF NOT EXISTS journal_entries (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(50)  NOT NULL DEFAULT 'leo',
  `date`     DATE         NOT NULL,
  title      VARCHAR(150) NOT NULL,
  content    TEXT         NOT NULL,
  mood       TINYINT UNSIGNED NULL,          -- 5 joyful, 4 good, 3 okay, 2 low, 1 angry
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_name_date (name, `date`)     -- one page per day per person
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- If you created journal_entries with the first version, add the mood column:
--   ALTER TABLE journal_entries ADD COLUMN mood TINYINT UNSIGNED NULL AFTER content;

-- The prologue page (one row per journal owner)
CREATE TABLE IF NOT EXISTS journal_prologue (
  name       VARCHAR(50)  NOT NULL,
  intro      TEXT         NULL,
  quote      VARCHAR(300) NULL,
  loves      TEXT         NULL,              -- one item per line
  goals      TEXT         NULL,              -- one item per line
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
