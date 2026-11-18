// src/routes/studio.js — 3DSTL Studio (custom 3D designs): pricing settings + print orders
import express from 'express';
import crypto from 'node:crypto';
import { authMiddleware } from '../middleware/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { notifyStudioOrder } from '../services/notify.js';

const router = express.Router();

// Admin check for Studio routes. The profiles column is `is_admin` (lowercase), as in routes/auth.js.
async function requireAdmin(req, res, next) {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('is_admin')
      .eq('id', req.id)
      .maybeSingle();
    if (error) throw error;
    if (!profile?.is_admin) return res.status(403).json({ error: 'Admin access only' });
    next();
  } catch (err) {
    console.error('studio admin check error:', err.message);
    res.status(500).json({ error: 'Failed to verify admin status: ' + err.message });
  }
}
const TABLE = 'studio_orders';
const STATUSES = ['new', 'printing', 'ready', 'delivered', 'cancelled'];

// ---------- Pricing settings ----------
// Defaults (Railway variables can still override them); the admin's saved settings
// in the `studio_settings` table take priority over both.
const DEFAULTS = () => ({
  shopName: process.env.STUDIO_SHOP_NAME || '3DSTL',
  currency: process.env.STUDIO_CURRENCY || 'USD',
  pricePerGram: Number(process.env.STUDIO_PRICE_PER_GRAM) || 0.12,
  minPrice: Number(process.env.STUDIO_MIN_PRICE) || 3,
  colorFee: 0, // added for every colour after the first
  pricePerHour: 0, // added per estimated print hour
  printFlow: 7, // average mm³/s used to estimate print time
  swapSeconds: 70, // seconds per filament swap (AMS)
  startupMinutes: 5, // heating + calibration
  whatsapp: process.env.STUDIO_WHATSAPP || '96176118290',
  creditsPerDownload: 0, // كريدت لكل تنزيل ملف (إذا لم تُحدَّد قيمة للأداة)
  payment: { whish: { number: '', name: '' }, neo: { number: '', name: '' }, note: '' }, // بيانات الدفع لشحن الكريدت
  tools: {}, // { [toolId]: { enabled, pricePerGram, minPrice, setupFee, credits } }
});

let cache = { at: 0, value: null };

export async function loadSettings() {
  if (cache.value && Date.now() - cache.at < 60e3) return cache.value;
  let saved = {};
  try {
    const { data, error } = await supabaseAdmin.from('studio_settings').select('data').eq('id', 1).maybeSingle();
    if (error) throw error;
    saved = data?.data || {};
  } catch (err) {
    console.error('studio settings load error:', err.message);
  }
  const def = DEFAULTS();
  const value = { ...def, ...saved, payment: { ...def.payment, ...(saved.payment || {}) }, tools: { ...(saved.tools || {}) } };
  cache = { at: Date.now(), value };
  return value;
}

const money = (v, max = 10000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10000) / 10000 : null;
};

// Validates what the admin sends; returns { value } or { error }
function cleanSettings(b = {}) {
  const pricePerGram = money(b.pricePerGram, 100);
  const minPrice = money(b.minPrice);
  const colorFee = money(b.colorFee ?? 0);
  const pricePerHour = money(b.pricePerHour ?? 0);
  if (pricePerGram === null || minPrice === null || colorFee === null || pricePerHour === null)
    return { error: 'Prices must be positive numbers' };
  const range = (v, def, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : def;
  };
  const printFlow = range(b.printFlow, 7, 0.5, 60);
  const swapSeconds = range(b.swapSeconds, 70, 0, 900);
  const startupMinutes = range(b.startupMinutes, 5, 0, 60);
  const currency = String(b.currency || '').trim().toUpperCase().slice(0, 8);
  if (!currency) return { error: 'Currency is required' };
  const whatsapp = String(b.whatsapp || '').replace(/\D/g, '').slice(0, 20);

  const tools = {};
  for (const [id, t] of Object.entries(b.tools || {}).slice(0, 50)) {
    if (!/^[a-z0-9-]{1,60}$/.test(id) || !t || typeof t !== 'object') continue;
    const opt = (v, max) => (v === '' || v === null || v === undefined ? null : money(v, max));
    tools[id] = {
      enabled: t.enabled !== false,
      pricePerGram: opt(t.pricePerGram, 100),
      minPrice: opt(t.minPrice),
      setupFee: money(t.setupFee ?? 0) ?? 0,
      credits: t.credits === '' || t.credits === null || t.credits === undefined ? null : Math.max(0, Math.min(1e6, parseInt(t.credits, 10) || 0)),
    };
  }
  const creditsPerDownload = Math.max(0, Math.min(1e6, parseInt(b.creditsPerDownload, 10) || 0));
  const acct = (a = {}) => ({ number: String(a.number || '').trim().slice(0, 40), name: String(a.name || '').trim().slice(0, 60) });
  const payment = { whish: acct(b.payment?.whish), neo: acct(b.payment?.neo), note: String(b.payment?.note || '').trim().slice(0, 500) };
  return { value: { currency, pricePerGram, minPrice, colorFee, pricePerHour, printFlow, swapSeconds, startupMinutes, whatsapp, creditsPerDownload, payment, tools } };
}

// Public: what the Studio uses to show prices
router.get('/config', async (req, res) => res.json(await loadSettings()));

// GET /api/studio/settings/admin — admin only
router.get('/settings/admin', authMiddleware, requireAdmin, async (req, res) => {
  cache.at = 0;
  res.json(await loadSettings());
});

// PUT /api/studio/settings/admin — admin only
router.put('/settings/admin', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { value, error: invalid } = cleanSettings(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const { error } = await supabaseAdmin
      .from('studio_settings')
      .upsert({ id: 1, data: value, updated_at: new Date().toISOString(), updated_by: req.id });
    if (error) throw error;
    cache.at = 0;
    res.json(await loadSettings());
  } catch (err) {
    console.error('studio settings save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Simple in-memory limit: 20 orders / 10 minutes / IP
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const list = (hits.get(req.ip) || []).filter((t) => now - t < 10 * 60e3);
  if (list.length >= 20) return res.status(429).json({ error: 'طلبات كثيرة، حاول لاحقاً' });
  list.push(now);
  hits.set(req.ip, list);
  next();
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// POST /api/studio/orders — logged-in customers
// login required (like shop orders): the order is linked to the customer's account
router.post('/orders', authMiddleware, rateLimit, async (req, res) => {
  try {
    const b = req.body || {};
    const name = str(b.customer?.name, 80);
    const phone = str(b.customer?.phone, 30);
    if (!name || !/^[+\d\s()-]{6,30}$/.test(phone))
      return res.status(400).json({ error: 'الاسم ورقم الهاتف مطلوبان' });
    const address = str(b.customer?.address, 300);
    if (address.length < 5) return res.status(400).json({ error: 'عنوان السكن مطلوب' });

    const toolId = str(b.toolId, 60);
    if (!toolId || !b.params || typeof b.params !== 'object' || Array.isArray(b.params))
      return res.status(400).json({ error: 'التصميم غير صالح' });
    if (JSON.stringify(b.params).length > 800_000)
      return res.status(413).json({ error: 'الشعار كبير جداً' });

    const d = new Date();
    const id = `ST-${d.toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const est = b.estimate && typeof b.estimate === 'object' ? b.estimate : null;

    const row = {
      id,
      user_id: req.id,
      tool_id: toolId,
      tool_name: str(b.toolName, 80),
      params: b.params,
      customer_name: name,
      customer_phone: phone,
      customer_address: address,
      qty: Math.min(500, Math.max(1, parseInt(b.qty, 10) || 1)),
      notes: str(b.notes, 1000),
      estimate: est && { grams: num(est.grams), minutes: num(est.minutes), price: num(est.price), currency: str(est.currency, 8) },
      size: Array.isArray(b.size) ? b.size.slice(0, 3).map(Number) : null,
    };
    const { error } = await supabaseAdmin.from(TABLE).insert(row);
    if (error) throw error;

    // إيميل للمحل (لا ينتظر الرد ولا يُفشل الطلب)
    notifyStudioOrder({ ...row, email: req.email }).catch(() => {});

    res.status(201).json({ id });
  } catch (err) {
    console.error('studio order error:', err.message);
    res.status(500).json({ error: 'تعذّر حفظ الطلب، حاول مجدداً أو راسلنا على واتساب' });
  }
});

// GET /api/studio/orders/my — the logged-in customer's own Studio orders (shown in Profile → My Orders)
router.get('/orders/my', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('id, status, tool_id, tool_name, params, qty, estimate, size, created_at, updated_at')
      .eq('user_id', req.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/studio/orders/admin — admin only
router.get('/orders/admin', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/studio/orders/admin/:id — admin only (status)
router.patch('/orders/admin/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const status = req.body?.status;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Order not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
