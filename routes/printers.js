// src/routes/printers.js — the shop's printers (Admin → Printers)
//
// A small "bridge" program runs on a computer in the shop, on the same network as the printers.
// It reads each printer locally and calls this server (it is never called *by* the server):
//   POST /api/printers/bridge/report  → the printers' status (+ a camera snapshot now and then);
//                                       the answer carries the commands waiting for them
//   POST /api/printers/bridge/ack     → a command was carried out (or not)
// The bridge proves itself with the X-Bridge-Token header = BRIDGE_TOKEN (Railway variable).
// The admin side (GET list, snapshot, POST command) uses the normal admin login.
import express from 'express';
import crypto from 'node:crypto';
import { authMiddleware } from '../middleware/auth.js';
import { supabaseAdmin } from '../supabase.js';

const COMMANDS = ['pause', 'resume', 'stop'];
const STALE_MS = 30_000; // no report for this long → the bridge (or the printer) is offline
const COMMAND_TTL_MS = 2 * 60_000; // a command not picked up within 2 minutes is dropped (never run late)
const snapshots = new Map(); // printer id → { buf, at } (latest camera picture, kept in memory only)

// ─────────────────────────── bridge side ───────────────────────────
export const bridgeRouter = express.Router();

function bridgeAuth(req, res, next) {
  const want = process.env.BRIDGE_TOKEN || '';
  const got = String(req.get('x-bridge-token') || '');
  if (!want || want.length < 16) return res.status(503).json({ error: 'BRIDGE_TOKEN is not set on the server' });
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'bad bridge token' });
  next();
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const STATES = ['printing', 'paused', 'idle', 'completed', 'stopped', 'error', 'processing', 'offline'];

function cleanStatus(s = {}) {
  return {
    state: STATES.includes(s.state) ? s.state : 'idle',
    file: str(s.file, 200),
    progress: num(s.progress),
    leftSec: num(s.leftSec),
    jobSec: num(s.jobSec),
    nozzle: num(s.nozzle),
    nozzleTarget: num(s.nozzleTarget),
    bed: num(s.bed),
    bedTarget: num(s.bedTarget),
    model: str(s.model, 60),
    error: str(s.error, 200),
    note: str(s.note, 200), // why the printer can't be reached
    camera: str(s.camera, 200), // why there's no camera picture
  };
}

bridgeRouter.post('/report', bridgeAuth, async (req, res) => {
  try {
    const list = Array.isArray(req.body?.printers) ? req.body.printers.slice(0, 20) : [];
    const now = new Date().toISOString();
    const seenIds = new Set();
    const rows = list
      .filter((p) => /^[a-z0-9_-]{1,40}$/i.test(String(p?.id || '')))
      .filter((p) => !seenIds.has(String(p.id)) && seenIds.add(String(p.id))) // one row per id
      .map((p) => ({
        id: String(p.id),
        name: str(p.name, 60) || String(p.id),
        kind: ['creality', 'bambu'].includes(p.kind) ? p.kind : 'creality',
        online: !!p.online,
        status: cleanStatus(p.status),
        updated_at: now,
      }));
    if (rows.length) {
      const { error } = await supabaseAdmin.from('printers').upsert(rows);
      if (error) throw error;
    }
    // camera pictures: JPEG only, at most ~400 KB each
    for (const p of list) {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(p?.snapshot || ''));
      if (!m) continue;
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length < 400_000 && buf[0] === 0xff && buf[1] === 0xd8) snapshots.set(String(p.id), { buf, at: Date.now() });
    }

    // commands waiting for these printers; old ones are dropped, not run late
    const ids = rows.map((r) => r.id);
    if (!ids.length) return res.json({ commands: [] });
    const { data: pending, error: e2 } = await supabaseAdmin
      .from('printer_commands').select('id, printer_id, command, created_at')
      .in('printer_id', ids).is('done_at', null).order('id');
    if (e2) throw e2;
    const fresh = [];
    const stale = [];
    for (const c of pending || []) (Date.now() - new Date(c.created_at).getTime() > COMMAND_TTL_MS ? stale : fresh).push(c);
    if (stale.length) {
      await supabaseAdmin.from('printer_commands')
        .update({ done_at: now, ok: false, message: 'expired' }).in('id', stale.map((c) => c.id));
    }
    res.json({ commands: fresh.map(({ id, printer_id, command }) => ({ id, printer_id, command })) });
  } catch (err) {
    console.error('bridge report error:', err.message);
    // the bridge has proved itself with its token, so it may see why (shown in its window)
    res.status(500).json({ error: `report failed: ${err.message}` });
  }
});

bridgeRouter.post('/ack', bridgeAuth, async (req, res) => {
  try {
    const id = parseInt(req.body?.id, 10);
    if (!id) return res.status(400).json({ error: 'bad id' });
    const { error } = await supabaseAdmin.from('printer_commands')
      .update({ done_at: new Date().toISOString(), ok: !!req.body?.ok, message: str(req.body?.message, 300) || null })
      .eq('id', id).is('done_at', null);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('bridge ack error:', err.message);
    res.status(500).json({ error: `ack failed: ${err.message}` });
  }
});

// ─────────────────────────── admin side ───────────────────────────
const router = express.Router();

async function requireAdmin(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', req.id).maybeSingle();
    if (error) throw error;
    if (!data?.is_admin) return res.status(403).json({ error: 'Admin access only' });
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/printers — every printer with its latest status
router.get('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('printers').select('*').order('name');
    if (error) throw error;
    const { data: last } = await supabaseAdmin.from('printer_commands')
      .select('id, printer_id, command, created_at, done_at, ok, message').order('id', { ascending: false }).limit(30);
    const now = Date.now();
    res.json((data || []).map((p) => {
      const age = now - new Date(p.updated_at).getTime();
      const snap = snapshots.get(p.id);
      return {
        ...p,
        stale: age > STALE_MS,
        seenSecondsAgo: Math.round(age / 1000),
        snapshotAt: snap ? snap.at : null,
        lastCommand: (last || []).find((c) => c.printer_id === p.id) || null,
      };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/printers/:id/snapshot — the latest camera picture
router.get('/:id/snapshot', authMiddleware, requireAdmin, (req, res) => {
  const snap = snapshots.get(String(req.params.id));
  if (!snap) return res.status(404).json({ error: 'No picture yet' });
  res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'no-store').send(snap.buf);
});

// POST /api/printers/:id/command { command: pause | resume | stop }
router.post('/:id/command', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const command = String(req.body?.command || '');
    if (!COMMANDS.includes(command)) return res.status(400).json({ error: 'Bad command' });
    const { data: p } = await supabaseAdmin.from('printers').select('id, updated_at').eq('id', String(req.params.id)).maybeSingle();
    if (!p) return res.status(404).json({ error: 'Printer not found' });
    if (Date.now() - new Date(p.updated_at).getTime() > STALE_MS) return res.status(409).json({ error: 'المكنة مش متّصلة هلّق' });
    const { data, error } = await supabaseAdmin.from('printer_commands')
      .insert({ printer_id: p.id, command, created_by: req.id }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
