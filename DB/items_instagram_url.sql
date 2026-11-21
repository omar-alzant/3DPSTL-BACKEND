-- Link from an item to the same post/reel on Instagram (shown as "Watch on Instagram" on the item page).
-- Run once in Supabase → SQL Editor.
ALTER TABLE items ADD COLUMN IF NOT EXISTS instagram_url text;
