-- Optional per-pet favicon for the public wiki page (file name in the upload dir).
ALTER TABLE pet_wikis ADD COLUMN IF NOT EXISTS icon text;
