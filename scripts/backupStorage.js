// Copies every file in Supabase Storage (item pictures, order files…) to a folder on this computer.
// Supabase's daily backups cover the database only — not these files.
//
//   cd 3DPSTL-BACKEND
//   npm run backup:storage                 → copies into ./storage-backup/<bucket>/...
//   npm run backup:storage -- D:\Backups    → copies into another folder (an external drive, OneDrive…)
//
// Run it again any time: only new or changed files are downloaded. Nothing is ever deleted
// (from Supabase or from the folder). Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
import fs from 'node:fs';
import path from 'node:path';
import { supabaseAdmin } from '../supabase.js';

const SKIP = new Set(['backups']); // our own database copies
const target = path.resolve(process.argv[2] || 'storage-backup');

async function listAll(bucket, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const f of data || []) {
      const p = prefix ? `${prefix}/${f.name}` : f.name;
      if (f.id === null) out.push(...(await listAll(bucket, p))); // a folder
      else out.push({ path: p, size: f.metadata?.size ?? -1, updated: f.updated_at || f.created_at });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();
  if (error) throw error;
  let copied = 0, kept = 0, failed = 0, bytes = 0;
  for (const b of buckets.filter((x) => !SKIP.has(x.name))) {
    const files = await listAll(b.name);
    console.log(`${b.name}: ${files.length} files`);
    for (const f of files) {
      const dest = path.join(target, b.name, ...f.path.split('/'));
      const st = fs.existsSync(dest) ? fs.statSync(dest) : null;
      if (st && (f.size < 0 || st.size === f.size) && (!f.updated || st.mtime >= new Date(f.updated))) { kept++; continue; }
      const { data, error: e } = await supabaseAdmin.storage.from(b.name).download(f.path);
      if (e) { failed++; console.warn(`  ✗ ${b.name}/${f.path}: ${e.message}`); continue; }
      const buf = Buffer.from(await data.arrayBuffer());
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      copied++; bytes += buf.length;
      if (copied % 25 === 0) console.log(`  … ${copied} copied`);
    }
  }
  console.log(`\nDone → ${target}\n  new/changed: ${copied} (${(bytes / 1048576).toFixed(1)} MB)\n  already there: ${kept}\n  failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error('Storage backup failed:', err.message); process.exit(1); });
