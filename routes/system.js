// routes/system.js
//   POST /api/log/error            — the website reports a crash (public, rate-limited)
//   GET  /api/system/errors        — admin: list errors
//   POST /api/system/errors/:id/resolve, POST /api/system/errors/resolve-all
//   GET  /api/system/backups       — admin: list daily backups
//   POST /api/system/backups/run   — admin: back up now
//   GET  /api/system/backups/:name — admin: download link (valid 10 minutes)
import express from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { supabaseAdmin } from '../supabase.js';
import { logError } from '../services/errorLog.js';
import { BUCKET, listBackups, runBackup, dailyBackupOn } from '../services/backup.js';

export const logRouter = express.Router();
export const systemRouter = express.Router();

// ── public: error reports from browsers ──
const hits = new Map();
const NOISE = /ResizeObserver loop|Script error\.?$|Non-Error promise rejection|chrome-extension:|moz-extension:|safari-extension:|AbortError|The operation was aborted|Load failed$|Failed to fetch$|NetworkError when attempting/i;

logRouter.post('/error', (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  if (list.length >= 20) return res.status(429).end();
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();

  const b = req.body || {};
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  res.status(204).end(); // answer right away; saving happens after
  if (!message || NOISE.test(message)) return;

  let userId = null;
  const token = String(req.headers.authorization || '').split(' ')[1];
  if (token) {
    try { userId = jwt.verify(token, process.env.JWT_SECRET)?.id || null; } catch { /* expired — fine */ }
  }
  logError({
    source: 'client',
    message,
    stack: typeof b.stack === 'string' ? b.stack : null,
    url: typeof b.url === 'string' ? b.url : null,
    userAgent: req.headers['user-agent'] || null,
    userId,
  });
});

// ── admin ──
systemRouter.use(authMiddleware, requireAdmin);

systemRouter.get('/errors', async (req, res) => {
  const resolved = req.query.resolved === 'true';
  const { data, error } = await supabaseAdmin.from('app_errors')
    .select('id, source, message, stack, url, user_agent, user_id, count, first_at, last_at, resolved')
    .eq('resolved', resolved).order('last_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

systemRouter.post('/errors/resolve-all', async (req, res) => {
  const { error } = await supabaseAdmin.from('app_errors').update({ resolved: true }).eq('resolved', false);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

systemRouter.post('/errors/:id/resolve', async (req, res) => {
  const { error } = await supabaseAdmin.from('app_errors').update({ resolved: true }).eq('id', Number(req.params.id) || 0);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

systemRouter.get('/backups', async (req, res) => {
  try {
    res.json({ files: await listBackups(), daily: dailyBackupOn() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let manualRunning = false;
systemRouter.post('/backups/run', async (req, res) => {
  if (manualRunning) return res.status(409).json({ error: 'Backup already running' });
  manualRunning = true;
  try {
    res.json(await runBackup({ manual: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    manualRunning = false;
  }
});

systemRouter.get('/backups/:name', async (req, res) => {
  const name = String(req.params.name);
  if (!/^db-[0-9-]+\.sql\.gz$/.test(name)) return res.status(400).json({ error: 'Bad name' });
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(name, 600, { download: name });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: data.signedUrl });
});
