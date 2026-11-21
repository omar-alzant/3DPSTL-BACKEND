// Photo search for "Our works".
// Every item photo gets an AI fingerprint (CLIP image embedding, 512 numbers) stored in
// item_image_embeddings. A customer's photo gets the same kind of fingerprint, and the items
// whose photos are closest (cosine similarity) come back first.
//
// The model (~90 MB, quantized) downloads from Hugging Face the first time it is needed and is
// kept in memory. Indexing runs a minute after start-up, every 6 hours, and shortly after an
// item is added or edited. Turn it all off with IMAGE_SEARCH=off.
import { supabaseAdmin } from '../supabase.js';

const MODEL = process.env.IMAGE_SEARCH_MODEL || 'Xenova/clip-vit-base-patch32';
// bump the tag whenever the way photos are prepared changes → everything is fingerprinted again
const DTYPE = process.env.IMAGE_SEARCH_DTYPE || 'fp32'; // full-precision model; set q8 on a small server (less accurate)
const MODEL_TAG = `clip-b32-${DTYPE}-trim-v2`;
const PHOTOS_PER_ITEM = 3;
// CLIP photo-to-photo similarity: ~0.9+ near-identical, ~0.75–0.85 same kind of object, ≤0.7 unrelated.
const MIN_SCORE = Number(process.env.IMAGE_SEARCH_MIN || 0.9);
const KEEP_WITHIN = 0.12; // and never far below the best match
export const imageSearchEnabled = () => process.env.IMAGE_SEARCH !== 'off';

let modelPromise = null;
function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const t0 = Date.now();
      const T = await import('@huggingface/transformers');
      T.env.cacheDir = process.env.HF_CACHE_DIR || '/tmp/hf-cache';
      T.env.allowLocalModels = false;
      const processor = await T.AutoProcessor.from_pretrained(MODEL);
      const model = await T.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: DTYPE });
      console.log(`[image-search] model ready in ${Math.round((Date.now() - t0) / 1000)}s`);
      return { T, processor, model };
    })().catch((err) => {
      modelPromise = null; // try again next time
      throw err;
    });
  }
  return modelPromise;
}

/** prepare a photo the same way for items and for customers: upright, without black/white bars
 *  (reel frames have big letterbox bars), on white, and square-padded so the AI sees the whole object */
async function preparePhoto(buffer) {
  const sharp = (await import('sharp')).default;
  let img = sharp(buffer, { failOn: 'none' }).rotate();
  try {
    const trimmed = await img.clone().trim({ threshold: 28 }).toBuffer({ resolveWithObject: true });
    const meta = await img.metadata();
    // only keep the trim when it removed bars, not half the picture
    if (trimmed.info.width * trimmed.info.height > 0.25 * (meta.width || 1) * (meta.height || 1)) img = sharp(trimmed.data);
  } catch {
    // nothing to trim
  }
  const { data, info } = await img
    .resize(320, 320, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true });
  return data;
}

/** fingerprint of one picture (Buffer of a jpeg/png/webp) → unit-length number array */
export async function embedImage(buffer) {
  const { T, processor, model } = await loadModel();
  const image = await T.RawImage.fromBlob(new Blob([await preparePhoto(buffer)]));
  const inputs = await processor(image);
  const { image_embeds } = await model(inputs);
  const v = Array.from(image_embeds.data);
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

// ---------- the stored fingerprints, kept in memory ----------
let vectors = null; // [{ item_id, v: Float32Array }]
let vectorsAt = 0;

async function loadVectors(force = false) {
  if (!force && vectors && Date.now() - vectorsAt < 10 * 60 * 1000) return vectors;
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('item_image_embeddings')
      .select('item_id, embedding')
      .eq('model', MODEL_TAG)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  vectors = rows.map((r) => ({ item_id: r.item_id, v: Float32Array.from(r.embedding) }));
  vectorsAt = Date.now();
  return vectors;
}

/** items most similar to the picture: [{ id, score }] best first (visible items only) */
export async function searchByImage(buffer, limit = 20) {
  const [q, rows] = await Promise.all([embedImage(buffer), loadVectors()]);
  const best = new Map();
  for (const r of rows) {
    let s = 0;
    for (let i = 0; i < q.length; i++) s += q[i] * r.v[i];
    if (s > (best.get(r.item_id) ?? -1)) best.set(r.item_id, s);
  }
  const sorted = [...best.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.length ? sorted[0][1] : 0;
  const ranked = sorted.filter(([, s]) => s >= MIN_SCORE && s >= top - KEEP_WITHIN);
  console.log(`[image-search] best ${top.toFixed(3)}, ${ranked.length} kept`, sorted.slice(0, 5).map(([, s]) => s.toFixed(3)).join(' '));
  if (!ranked.length) return [];
  // drop hidden items
  const ids = ranked.slice(0, limit * 3).map(([id]) => id);
  const { data, error } = await supabaseAdmin.from('items').select('id').in('id', ids).not('isdisabled', 'is', true);
  if (error) throw error;
  const visible = new Set(data.map((d) => d.id));
  return ranked.filter(([id]) => visible.has(id)).slice(0, limit).map(([id, score]) => ({ id, score: +score.toFixed(3) }));
}

// ---------- indexing ----------
let indexing = false;
let lastIndex = null;

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** fingerprints every item photo that does not have one yet; removes ones for photos that are gone */
export async function indexMissing() {
  if (indexing || !imageSearchEnabled()) return lastIndex;
  indexing = true;
  const t0 = Date.now();
  let added = 0, failed = 0, removed = 0;
  try {
    const items = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin.from('items').select('id, galleryurls').range(from, from + 999);
      if (error) throw error;
      items.push(...data);
      if (data.length < 1000) break;
    }
    const have = new Set();
    const existing = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from('item_image_embeddings').select('item_id, image_url').eq('model', MODEL_TAG).range(from, from + 999);
      if (error) throw error;
      for (const r of data) { have.add(`${r.item_id}|${r.image_url}`); existing.push(r); }
      if (data.length < 1000) break;
    }

    const wanted = new Set();
    for (const it of items) {
      const urls = (Array.isArray(it.galleryurls) ? it.galleryurls : []).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, PHOTOS_PER_ITEM);
      for (const url of urls) {
        const key = `${it.id}|${url}`;
        wanted.add(key);
        if (have.has(key)) continue;
        try {
          const embedding = await embedImage(await fetchImage(url));
          const { error } = await supabaseAdmin.from('item_image_embeddings')
            .upsert({ item_id: it.id, image_url: url, embedding, model: MODEL_TAG }, { onConflict: 'item_id,image_url' });
          if (error) throw error;
          added++;
        } catch (err) {
          failed++;
          console.warn(`[image-search] ${it.id} ${url}: ${err.message}`);
          if (/fetch failed|from_pretrained|Could not locate/i.test(err.message) && added === 0 && failed === 1) {
            // the model itself could not load: no point trying every photo
            const probe = await loadModel().then(() => null, (e) => e);
            if (probe) throw probe;
          }
        }
      }
    }
    // fingerprints made the old way are dropped
    await supabaseAdmin.from('item_image_embeddings').delete().neq('model', MODEL_TAG);
    for (const r of existing) {
      if (wanted.has(`${r.item_id}|${r.image_url}`)) continue;
      await supabaseAdmin.from('item_image_embeddings').delete().eq('item_id', r.item_id).eq('image_url', r.image_url);
      removed++;
    }
    if (added || removed) await loadVectors(true);
    lastIndex = { at: new Date().toISOString(), added, removed, failed, seconds: Math.round((Date.now() - t0) / 1000) };
    if (added || removed || failed) console.log('[image-search] index', lastIndex);
  } catch (err) {
    lastIndex = { at: new Date().toISOString(), error: err.message };
    console.error('[image-search] index failed:', err.message);
  } finally {
    indexing = false;
  }
  return lastIndex;
}

let soonTimer = null;
/** call after an item is saved: indexes its new photos half a minute later */
export function indexSoon() {
  if (!imageSearchEnabled()) return;
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => { indexMissing(); }, 30 * 1000);
}

export function startImageSearchSchedule() {
  if (!imageSearchEnabled()) return;
  setTimeout(() => { indexMissing(); }, 60 * 1000);
  setInterval(() => { indexMissing(); }, 6 * 60 * 60 * 1000);
}

export async function imageSearchStatus() {
  const rows = await loadVectors().catch(() => []);
  return {
    enabled: imageSearchEnabled(),
    photos: rows.length,
    items: new Set(rows.map((r) => r.item_id)).size,
    modelLoaded: !!modelPromise,
    indexing,
    lastIndex,
  };
}
