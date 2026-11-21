-- Make every item visible (isdisabled = false)
-- Run in Supabase > SQL Editor.

-- 1) How many are hidden right now?
SELECT count(*) AS hidden_items FROM items WHERE isdisabled = true;

-- 2) Enable them all
UPDATE items
SET isdisabled = false,
    updated_at = now()
WHERE isdisabled = true;

-- 3) Optional: the Instagram-imported items sit under a hidden
--    category/type/model called "Instagram" / "Instagram posts" / "Imported".
--    Remove the "--" below if you also want that group to show in the menu.
-- UPDATE categories SET isdisabled = false, updated_at = now() WHERE name = 'Instagram';
-- UPDATE types      SET isdisabled = false, updated_at = now() WHERE name = 'Instagram posts';
-- UPDATE models     SET isdisabled = false, updated_at = now() WHERE name = 'Imported';

-- 4) Check
SELECT count(*) FILTER (WHERE isdisabled = false) AS visible,
       count(*) FILTER (WHERE isdisabled = true)  AS hidden
FROM items;
