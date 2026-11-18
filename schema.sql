-- Sparse Musings schema (the server also creates this automatically on start)
CREATE DATABASE IF NOT EXISTS sparse_musings
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE sparse_musings;

CREATE TABLE IF NOT EXISTS journal_entries (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(50)  NOT NULL DEFAULT 'leo',
  `date`     DATE         NOT NULL,
  title      VARCHAR(150) NOT NULL,
  content    TEXT         NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_name_date (name, `date`)  -- one page per day per person
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
