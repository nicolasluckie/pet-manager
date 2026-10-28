-- Public, Wikipedia-style profile page per pet. Off by default; every field that
-- is shown publicly must be switched on explicitly (`show`). Content only holds
-- free text written for the public page, never copies of private pet data.

CREATE TABLE IF NOT EXISTS pet_wikis (
  pet_id     integer PRIMARY KEY REFERENCES pets (id) ON DELETE CASCADE,
  slug       text NOT NULL,
  published  boolean NOT NULL DEFAULT false,
  content    jsonb NOT NULL DEFAULT '{}',
  show       jsonb NOT NULL DEFAULT '{}',
  -- [{ "file": "<uuid>.jpg", "caption": "..." }]
  gallery    jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_wikis_slug_idx ON pet_wikis (slug);
