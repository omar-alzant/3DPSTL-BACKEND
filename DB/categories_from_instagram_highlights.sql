-- Categories matching the Instagram highlights of @3dpstl
-- Run once in Supabase > SQL Editor. Safe to re-run: existing names are skipped.
-- "Feedback" highlight is left out on purpose (customer reviews, not a product category).

INSERT INTO categories (name, sort_order, isdisabled) VALUES
  ('Names',              1,  false),
  ('Souvenir',           2,  false),
  ('Decor',              3,  false),
  ('Candies',            4,  false),
  ('Repairing',          5,  false),
  ('Engineering',        6,  false),
  ('Brands',             7,  false),
  ('NFC-QR',             8,  false),
  ('Maps',               9,  false),
  ('Education',          10, false),
  ('Tools',              11, false),
  ('Keychains',          12, false),
  ('Lighting Logo',      13, false),
  ('Back to School',     14, false),
  ('Toys',               15, false),
  ('Electronic',         16, false),
  ('Sport',              17, false),
  ('Coffee',             18, false),
  ('Seedlings and Soil', 19, false)
ON CONFLICT (name) DO NOTHING;

-- Check the result
SELECT name, slug, sort_order, isdisabled FROM categories ORDER BY sort_order, name;
