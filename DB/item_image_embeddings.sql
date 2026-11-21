-- Photo search on "Our works": one AI fingerprint (CLIP, 512 numbers) per item photo.
-- Filled automatically by the server (services/imageSearch.js). Run once in Supabase → SQL Editor.
CREATE TABLE IF NOT EXISTS item_image_embeddings (
  item_id    uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  image_url  text NOT NULL,
  embedding  real[] NOT NULL,
  model      text NOT NULL DEFAULT 'clip-vit-base-patch32',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, image_url)
);
-- only the server (service role) reads/writes it
ALTER TABLE item_image_embeddings ENABLE ROW LEVEL SECURITY;
