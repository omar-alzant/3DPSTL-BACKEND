// Puts the brand logos from the Brands folder on the website ("They trusted us" on the home page).
// Reads Brands/brands.json ({ file, name, aliases }), uploads each logo to Supabase Storage
// (bucket "brands-images", folder "logos") and links it to the brand with the same name
// (case, spaces and dots ignored; aliases count too). Brands that don't exist yet are added.
//
//   cd 3DPSTL-BACKEND
//   node scripts/importBrandLogos.js            → shows what it WOULD do, changes nothing
//   node scripts/importBrandLogos.js --apply    → uploads and saves
//   node scripts/importBrandLogos.js --apply --keep   → don't replace a brand's existing picture
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (same as the server).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseAdmin } from '../supabase.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(here, '../../Brands');
const APPLY = process.argv.includes('--apply');
const KEEP = process.argv.includes('--keep');
const BUCKET = 'brands-images';
const norm = (s) => String(s || '').toLowerCase().replace(/[\s._\-'’]/g, '');

async function main() {
  const list = JSON.parse(fs.readFileSync(path.join(DIR, 'brands.json'), 'utf8'));
  const { data: brands, error } = await supabaseAdmin.from('brands').select('id, name, image');
  if (error) throw error;
  console.log(`${brands.length} brands on the site, ${list.length} logos in ${DIR}${APPLY ? '' : '  (dry run: nothing is changed)'}\n`);

  // the bucket the admin uses for brand pictures; make it (public) if this Supabase project doesn't have it yet
  if (APPLY) {
    const { data: b } = await supabaseAdmin.storage.getBucket(BUCKET);
    if (!b) {
      const { error: e } = await supabaseAdmin.storage.createBucket(BUCKET, { public: true });
      if (e && !/already exists/i.test(e.message)) throw new Error(`could not create bucket "${BUCKET}": ${e.message}`);
      console.log(`(created the public storage bucket "${BUCKET}")\n`);
    }
  }

  let added = 0, updated = 0, kept = 0;
  const matched = new Set();
  for (const it of list) {
    const keys = [it.name, ...(it.aliases || [])].map(norm);
    const match = brands.find((b) => keys.includes(norm(b.name)));
    if (match) matched.add(match.id);
    const hasPic = match && Array.isArray(match.image) && match.image.length > 0;
    if (match && hasPic && KEEP) { kept++; console.log(`= ${it.name.padEnd(26)} keeps its picture (${match.name})`); continue; }
    console.log(`${match ? '~' : '+'} ${it.name.padEnd(26)} ${match ? `logo → existing brand "${match.name}"` : 'new brand'}`);
    if (!APPLY) { match ? updated++ : added++; continue; }

    const buf = fs.readFileSync(path.join(DIR, it.file));
    const key = `logos/${path.basename(it.file)}`;
    const up = await supabaseAdmin.storage.from(BUCKET).upload(key, buf, { contentType: 'image/png', upsert: true });
    if (up.error) { console.warn(`   ✗ upload failed: ${up.error.message}`); continue; }
    const url = `${supabaseAdmin.storage.from(BUCKET).getPublicUrl(key).data.publicUrl}?v=${Date.now()}`;
    const now = new Date().toISOString();
    const res = match
      ? await supabaseAdmin.from('brands').update({ image: [url], updated_at: now }).eq('id', match.id)
      : await supabaseAdmin.from('brands').insert({ name: it.name, image: [url], isdisabled: false });
    if (res.error) { console.warn(`   ✗ save failed: ${res.error.message}`); continue; }
    match ? updated++ : added++;
  }
  const others = brands.filter((b) => !matched.has(b.id));
  if (others.length) {
    console.log(`\nBrands already on the site that got no logo (if one of them is the same as a "new brand" above,`);
    console.log(`rename it in the admin or add its name to "aliases" in Brands/brands.json, then run again):`);
    for (const b of others) console.log(`   · ${b.name}`);
  }
  console.log(`\n${APPLY ? 'Done' : 'Would do'}: ${added} new, ${updated} updated, ${kept} kept.${APPLY ? '' : '\nRun again with --apply to save.'}`);
}

main().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
