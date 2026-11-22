// services/backup.js — extra database backups (pg_dump → gzip → private Storage bucket "backups").
// The project is on Supabase Pro, which already keeps a daily backup for 7 days
// (Supabase → Database → Backups), so our own daily copy is OFF by default.
// The "Backup now" button (Admin → System) still makes a copy on demand — handy before big changes.
//
// Railway variables: SUPABASE_DB_URL (needed for any copy)
//                    BACKUP_DAILY=on   → also make our own copy every day after 03:00 Beirut (emails you if it fails)
//                    BACKUP_KEEP=14    → how many copies to keep
// Pictures and files in Supabase Storage are NOT in any database backup: run `npm run backup:storage`
// on your computer to copy them (see scripts/backupStorage.js).
import { spawn } from 'node:child_process';
import zlib from 'node:zlib';
import { supabaseAdmin } from '../supabase.js';
import { notifyBackupFailed } from './notify.js';

export const BUCKET = 'backups';
const KEEP = () => Math.max(3, Number(process.env.BACKUP_KEEP) || 14);
const HOUR = 3; // Beirut time

const beirut = (d = new Date()) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map((x) => [x.type, x.value])
  );
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  bucketReady = true;
}

/** pg_dump → gzip → Buffer */
function dumpGzip() {
  return new Promise((resolve, reject) => {
    if (!process.env.SUPABASE_DB_URL) return reject(new Error('SUPABASE_DB_URL not set'));
    const dump = spawn('pg_dump', [process.env.SUPABASE_DB_URL, '--no-owner', '--no-acl']);
    const gz = zlib.createGzip({ level: 9 });
    const chunks = [];
    let errText = '';
    dump.stdout.pipe(gz);
    gz.on('data', (c) => chunks.push(c));
    dump.stderr.on('data', (d) => { errText += d; });
    dump.on('error', (err) => reject(
      err.code === 'ENOENT'
        ? new Error('pg_dump is not installed on this server (on Railway the Dockerfile installs it; on your own computer install PostgreSQL client tools)')
        : err
    ));
    let code = null;
    let gzDone = false;
    const finish = () => {
      if (code === null || !gzDone) return;
      if (code !== 0) return reject(new Error(`pg_dump exit ${code}: ${errText.slice(0, 300)}`));
      resolve(Buffer.concat(chunks));
    };
    dump.on('close', (c) => { code = c; finish(); });
    gz.on('end', () => { gzDone = true; finish(); });
  });
}

export async function listBackups() {
  await ensureBucket();
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list('', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
  if (error) throw error;
  return (data || [])
    .filter((f) => f.name.endsWith('.sql.gz'))
    .map((f) => ({ name: f.name, size: f.metadata?.size || 0, created_at: f.created_at }));
}

/** makes a backup now. name: db-YYYY-MM-DD.sql.gz (manual ones add the time) */
export async function runBackup({ manual = false } = {}) {
  await ensureBucket();
  const started = Date.now();
  const buf = await dumpGzip();
  if (buf.length < 200) throw new Error('backup file is empty');
  const { day } = beirut();
  const name = manual ? `db-${day}-${new Date().toISOString().slice(11, 16).replace(':', '')}.sql.gz` : `db-${day}.sql.gz`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(name, buf, { contentType: 'application/gzip', upsert: true });
  if (error) throw error;

  // keep only the newest KEEP files
  const all = await listBackups();
  const old = all.slice(KEEP()).map((f) => f.name);
  if (old.length) await supabaseAdmin.storage.from(BUCKET).remove(old);

  console.log(`backup: ${name} ${(buf.length / 1024).toFixed(0)} KB in ${Date.now() - started} ms`);
  return { name, size: buf.length };
}

let running = false;
async function tick() {
  if (running) return;
  const { day, hour } = beirut();
  if (hour < HOUR) return;
  running = true;
  try {
    const files = await listBackups();
    if (files.some((f) => f.name === `db-${day}.sql.gz`)) return; // already done today
    await runBackup();
  } catch (err) {
    console.error('backup failed:', err.message);
    notifyBackupFailed(err.message).catch(() => {});
  } finally {
    running = false;
  }
}

export const onRailway = () => !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID);

export function startBackupSchedule() {
  if (process.env.BACKUP_DAILY !== 'on')
    return console.log('backup: our own daily copy is off (Supabase Pro keeps daily backups; set BACKUP_DAILY=on to add ours)');
  if (!process.env.SUPABASE_DB_URL) return console.warn('backup: SUPABASE_DB_URL not set — daily backup skipped');
  setTimeout(tick, 60_000); // a minute after start
  setInterval(tick, 30 * 60_000).unref?.();
}

/** is the daily backup active on this server? (shown on the admin System page) */
export const dailyBackupOn = () => process.env.BACKUP_DAILY === 'on' && !!process.env.SUPABASE_DB_URL;
