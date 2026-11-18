// scripts/importInstagram.js — add Instagram posts/reels to the shop as products.
//
// Run from the 3DPSTL-BACKEND folder (it uses the same .env / Supabase as the server):
//   node scripts/importInstagram.js ../instagram-import --dry-run      (shows what would be added)
//   node scripts/importInstagram.js ../instagram-import                (adds them)
//
// Options:
//   --visible          show the products in the shop right away (default: hidden until you edit them)
//   --model-id=<uuid>  put them under an existing model (default: category/type/model "Instagram")
//   --price=<number>   starting price (default 0)
//   --dry-run          print what would happen, change nothing
//   --create-bucket    create the public "item-images" storage bucket if it does not exist yet
//
// The folder comes from prepare_instagram.py (manifest.json + images/). Already imported
// posts are remembered in <folder>/imported.json, so running it again only adds new ones.

import fs from 'node:fs';
import path from 'node:path';
import { supabaseAdmin } from '../supabase.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : fallback;
};

const folder = path.resolve(args.find((a) => !a.startsWith('--')) || '../instagram-import');
const DRY = flag('dry-run');
const VISIBLE = flag('visible');
const PRICE = Number(opt('price', 0)) || 0;
const MODEL_ID = opt('model-id', null);
const BUCKET = 'item-images';
const CREATE_BUCKET = flag('create-bucket');

const manifestFile = path.join(folder, 'manifest.json');
const stateFile = path.join(folder, 'imported.json');
if (!fs.existsSync(manifestFile)) {
  console.error(`manifest.json not found in ${folder}`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const saveState = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Product name: first line of the caption without hashtags/mentions, max 60 chars
function nameFrom(entry, index) {
  const first = (entry.caption || '')
    .split('\n')
    .map((l) => l.replace(/[#@][\p{L}\p{N}_.]+/gu, '').trim())
    .find((l) => l.length > 1);
  const label = entry.kind === 'reel' ? 'Instagram reel' : 'Instagram post';
  if (!first) return `${label} ${entry.date || index + 1}`;
  return first.length > 60 ? first.slice(0, 57).trimEnd() + '…' : first;
}

const descriptionFrom = (entry) =>
  (entry.caption || '')
    .split('\n')
    .map((l) => `<p>${esc(l) || '<br>'}</p>`)
    .join('') +
  `<p><small>Imported from Instagram (${entry.kind}${entry.date ? `, ${entry.date}` : ''}) — edit before publishing.</small></p>`;

async function findOrCreate(table, match, extra = {}) {
  // dry run: a parent that does not exist yet has no real id -> its children are new too
  if (Object.values(match).some((v) => typeof v === 'string' && v.startsWith('(new '))) return `(new ${table})`;
  let q = supabaseAdmin.from(table).select('id');
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (data) return data.id;
  if (DRY) return `(new ${table})`;
  const ins = await supabaseAdmin.from(table).insert({ ...match, ...extra }).select('id').single();
  if (ins.error) throw ins.error;
  return ins.data.id;
}

async function resolveModel() {
  if (MODEL_ID) {
    const { data, error } = await supabaseAdmin.from('models').select('id, name').eq('id', MODEL_ID).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`Model ${MODEL_ID} not found`);
    console.log(`Model: ${data.name}`);
    return data.id;
  }
  // Holding place for the imports; hidden from the shop menu unless --visible
  const hidden = { isdisabled: !VISIBLE };
  const cat = await findOrCreate('categories', { name: 'Instagram' }, hidden);
  const type = await findOrCreate('types', { category_id: cat, name: 'Instagram posts' }, hidden);
  const model = await findOrCreate('models', { type_id: type, name: 'Imported' }, hidden);
  console.log('Model: Instagram → Instagram posts → Imported');
  return model;
}

// The product images bucket must exist (the admin panel uploads to it too)
async function ensureBucket() {
  const { data, error } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (data && !error) return true;
  if (!CREATE_BUCKET) {
    console.error(`Storage bucket "${BUCKET}" does not exist in this Supabase project.`);
    console.error(`Run again with --create-bucket to create it (public, images only), or create it in Supabase → Storage.`);
    return false;
  }
  if (DRY) {
    console.log(`[dry run] would create the public storage bucket "${BUCKET}"`);
    return true;
  }
  const res = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,                         // product images are shown on the website
    fileSizeLimit: '10MB',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  });
  if (res.error) {
    console.error(`Could not create bucket "${BUCKET}": ${res.error.message}`);
    return false;
  }
  console.log(`Created public storage bucket "${BUCKET}".`);
  return true;
}

async function uploadImage(file) {
  const buffer = fs.readFileSync(path.join(folder, 'images', file));
  const key = `instagram/${Date.now()}-${Math.random().toString(36).slice(2)}-${file}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(key, buffer, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`upload ${file}: ${error.message}`);
  return supabaseAdmin.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
}

async function main() {
  const todo = manifest.filter((m) => !state[m.id]);
  console.log(`${manifest.length} items in the export, ${manifest.length - todo.length} already imported, ${todo.length} to add.`);
  console.log(`Products will be ${VISIBLE ? 'VISIBLE' : 'HIDDEN (enable them after editing)'}, price ${PRICE}.${DRY ? '  [dry run]' : ''}\n`);
  if (!todo.length) return;
  if (!(await ensureBucket())) process.exit(1);

  const modelId = await resolveModel();
  let ok = 0;
  for (const [i, entry] of todo.entries()) {
    const name = nameFrom(entry, i);
    try {
      if (DRY) {
        console.log(`• [${entry.kind}] ${name}  (${entry.images.length} image${entry.images.length === 1 ? '' : 's'})`);
        continue;
      }
      const galleryurls = [];
      for (const img of entry.images) galleryurls.push(await uploadImage(img));

      const { data: item, error } = await supabaseAdmin
        .from('items')
        .insert({
          model_id: modelId,
          name,
          description: descriptionFrom(entry),
          galleryurls,
          issimple: true,
          isdisabled: !VISIBLE,
        })
        .select('id')
        .single();
      if (error) throw error;

      const { error: vErr } = await supabaseAdmin.from('variants').insert({
        item_id: item.id,
        sku: `${item.id.slice(0, 8).toUpperCase()}-STD`,
        size: 'Standard',
        color: '#6a4dff',
        price: PRICE,
        stock: 0,
      });
      if (vErr) throw vErr;

      state[entry.id] = { itemId: item.id, name, at: new Date().toISOString() };
      saveState();
      ok++;
      console.log(`✓ ${name}`);
    } catch (err) {
      console.error(`✗ ${name}: ${err.message}`);
    }
  }
  if (!DRY) console.log(`\nDone: ${ok}/${todo.length} added. Imported list: ${stateFile}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
