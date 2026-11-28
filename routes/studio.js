// src/routes/studio.js — 3DSTL Studio (custom 3D designs): pricing settings + print orders
import express from 'express';
import crypto from 'node:crypto';
import { authMiddleware } from '../middleware/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { notifyStudioOrder, confirmStudioOrder, readyStudioOrder } from '../services/notify.js';
import { normalizeMapLink } from '../util/mapLink.js';

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
  showPrices: false, // show the estimated price to customers (the admin always sees it)
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
  const showPrices = b.showPrices === true;
  return { value: { currency, pricePerGram, minPrice, colorFee, pricePerHour, printFlow, swapSeconds, startupMinutes, whatsapp, creditsPerDownload, showPrices, payment, tools } };
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

// ---------- Shared design links: the pictures in them ----------
// A design link can't carry an uploaded picture (too big), so "Copy design link" first stores each
// picture here and puts its address in the link. Public bucket, named by the picture's own hash
// (the same picture is stored once). Only PNG / JPEG / WebP, at most 1.5 MB, a few per minute per visitor.
const SHARE_BUCKET = 'studio-shared';
const SHARE_MAX = 1.5 * 1024 * 1024;
const shareHits = new Map();
let shareBucketReady = false;
async function ensureShareBucket() {
  if (shareBucketReady) return;
  const { data } = await supabaseAdmin.storage.getBucket(SHARE_BUCKET);
  if (!data) {
    const { error } = await supabaseAdmin.storage.createBucket(SHARE_BUCKET, { public: true, fileSizeLimit: SHARE_MAX, allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] });
    if (error && !/exist/i.test(error.message)) throw error;
  }
  shareBucketReady = true;
}
const MAGIC = {
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
  webp: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP',
};

// POST /api/studio/share-image  { data: "data:image/png;base64,…" } → { url }
router.post('/share-image', async (req, res) => {
  try {
    const now = Date.now();
    const list = (shareHits.get(req.ip) || []).filter((t) => now - t < 10 * 60e3);
    if (list.length >= 60) return res.status(429).json({ error: 'كتير محاولات، جرّب بعد شوي' });
    list.push(now);
    shareHits.set(req.ip, list);

    const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
    if (!m) return res.status(400).json({ error: 'صورة غير صالحة' });
    const type = m[1] === 'jpg' ? 'jpeg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > SHARE_MAX) return res.status(413).json({ error: 'الصورة كبيرة' });
    if (!MAGIC[type](buf)) return res.status(400).json({ error: 'صورة غير صالحة' });

    await ensureShareBucket();
    const key = `img/${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 40)}.${type === 'jpeg' ? 'jpg' : type}`;
    const up = await supabaseAdmin.storage.from(SHARE_BUCKET).upload(key, buf, { contentType: `image/${type}`, upsert: true, cacheControl: '31536000' });
    if (up.error) throw up.error;
    const { data } = supabaseAdmin.storage.from(SHARE_BUCKET).getPublicUrl(key);
    res.json({ url: data.publicUrl });
  } catch (err) {
    console.error('studio share image error:', err.message);
    res.status(500).json({ error: 'تعذّر تجهيز الرابط' });
  }
});

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
    const rawLocation = str(b.customer?.location, 600);
    const location = normalizeMapLink(rawLocation);
    if (rawLocation && !location)
      return res.status(400).json({ error: 'رابط الموقع غير صالح — الصق رابطاً من Google Maps أو Apple Maps' });
    if (address.length < 5 && !location)
      return res.status(400).json({ error: 'اكتب عنوان السكن أو أضف موقعك على الخريطة' });

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
      customer_address: address || null,
      customer_location: location || null,
      qty: Math.min(500, Math.max(1, parseInt(b.qty, 10) || 1)),
      notes: str(b.notes, 1000),
      estimate: est && { grams: num(est.grams), minutes: num(est.minutes), price: num(est.price), currency: str(est.currency, 8) },
      size: Array.isArray(b.size) ? b.size.slice(0, 3).map(Number) : null,
    };
    const { error } = await supabaseAdmin.from(TABLE).insert(row);
    if (error) throw error;

    // إيميل للمحل (لا ينتظر الرد ولا يُفشل الطلب)
    notifyStudioOrder({ ...row, email: req.email }).catch(() => {});
    confirmStudioOrder({ ...row, email: req.email }).catch(() => {});

    res.status(201).json({ id });
  } catch (err) {
    console.error('studio order error:', err.message);
    res.status(500).json({ error: 'تعذّر حفظ الطلب، حاول مجدداً أو راسلنا على واتساب' });
  }
});


// ---------- Order files ----------
// Tools that use the customer's own 3D file (the mold maker) can't be rebuilt from the design link,
// so right after ordering the customer's browser sends the finished 3MF. Kept in a private bucket.
const FILES_BUCKET = 'studio-files';
const MAX_FILE = 60 * 1024 * 1024;
let filesBucketReady = false;
async function ensureFilesBucket() {
  if (filesBucketReady) return;
  const { data } = await supabaseAdmin.storage.getBucket(FILES_BUCKET);
  if (!data) {
    const { error } = await supabaseAdmin.storage.createBucket(FILES_BUCKET, { public: false });
    if (error && !/exist/i.test(error.message)) throw error;
  }
  filesBucketReady = true;
}
const fileKey = (id) => `orders/${id}.3mf`;
const validId = (id) => /^ST-\d{6}-[0-9A-F]{4}$/.test(id);

// POST /api/studio/orders/:id/file — the customer who placed the order, within an hour of ordering
router.post('/orders/:id/file', authMiddleware, rateLimit,
  express.raw({ type: 'application/octet-stream', limit: MAX_FILE }),
  async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!validId(id)) return res.status(400).json({ error: 'رقم الطلب غير صالح' });
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length < 100) return res.status(400).json({ error: 'الملف فارغ' });
      // a 3MF is a zip file: it starts with "PK"
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) return res.status(400).json({ error: 'الملف غير صالح' });

      const { data: order, error } = await supabaseAdmin
        .from(TABLE).select('id, user_id, created_at').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!order || order.user_id !== req.id) return res.status(404).json({ error: 'الطلب غير موجود' });
      if (Date.now() - new Date(order.created_at).getTime() > 60 * 60e3)
        return res.status(403).json({ error: 'انتهت مدة رفع الملف لهذا الطلب' });

      await ensureFilesBucket();
      const up = await supabaseAdmin.storage.from(FILES_BUCKET)
        .upload(fileKey(id), buf, { contentType: 'model/3mf', upsert: true });
      if (up.error) throw up.error;
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('studio order file error:', err.message);
      res.status(500).json({ error: 'تعذّر حفظ الملف' });
    }
  });

// ---------- Admin attachments (any file: STL, 3MF, photo, PDF…) on any order ----------
// kept in the same private bucket, under orders/<id>/
// storage keys must be plain ASCII, so the original name (Arabic too) is kept base64url-encoded in the key
const keyName = (raw) => {
  let n = '';
  try { n = decodeURIComponent(String(raw || '')); } catch { n = String(raw || ''); }
  n = n.split(/[\\/]/).pop().normalize('NFC').replace(/[\u0000-\u001f]/g, '').slice(-80) || 'file';
  return Buffer.from(n, 'utf8').toString('base64url');
};
const nameFromKey = (k) => {
  const enc = k.replace(/^[0-9a-z]+-/, '');
  try { return Buffer.from(enc, 'base64url').toString('utf8') || k; } catch { return k; }
};

// POST /api/studio/orders/admin/:id/files — body = the file, header X-Filename = its name (a header the CORS setup already allows)
router.post('/orders/admin/:id/files', authMiddleware, requireAdmin,
  express.raw({ type: () => true, limit: MAX_FILE }),
  async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!validId(id)) return res.status(400).json({ error: 'رقم الطلب غير صالح' });
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'الملف فارغ' });
      const { data: order, error } = await supabaseAdmin.from(TABLE).select('id').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
      await ensureFilesBucket();
      const key = `orders/${id}/${Date.now().toString(36)}-${keyName(req.get('x-filename'))}`;
      const up = await supabaseAdmin.storage.from(FILES_BUCKET)
        .upload(key, buf, { contentType: req.get('content-type') || 'application/octet-stream', upsert: false });
      if (up.error) throw up.error;
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('studio admin file error:', err.message);
      res.status(500).json({ error: 'تعذّر رفع الملف' });
    }
  });

// GET /api/studio/orders/admin/:id/files — the order's attachments, each with a 10-minute download link
router.get('/orders/admin/:id/files', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!validId(id)) return res.status(400).json({ error: 'Bad order id' });
    await ensureFilesBucket();
    const { data: list, error } = await supabaseAdmin.storage.from(FILES_BUCKET).list(`orders/${id}`, { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });
    if (error) throw error;
    const files = (list || []).filter((f) => f.name && f.id);
    if (!files.length) return res.json([]);
    const paths = files.map((f) => `orders/${id}/${f.name}`);
    const { data: links, error: e2 } = await supabaseAdmin.storage.from(FILES_BUCKET).createSignedUrls(paths, 600);
    if (e2) throw e2;
    res.json(files.map((f, i) => ({
      name: nameFromKey(f.name),
      size: f.metadata?.size ?? null,
      url: links?.[i]?.signedUrl || null,
    })));
  } catch (err) {
    console.error('studio admin files list error:', err.message);
    res.status(500).json({ error: 'Failed to list the files' });
  }
});

// GET /api/studio/orders/admin/:id/file — admin: a download link that works for 10 minutes
router.get('/orders/admin/:id/file', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!validId(id)) return res.status(400).json({ error: 'Bad order id' });
    const { data, error } = await supabaseAdmin.storage.from(FILES_BUCKET)
      .createSignedUrl(fileKey(id), 600, { download: `${id}-mold.3mf` });
    if (error || !data?.signedUrl) return res.status(404).json({ error: 'No file was sent with this order' });
    res.json({ url: data.signedUrl });
  } catch (err) {
    console.error('studio order file link error:', err.message);
    res.status(500).json({ error: 'Failed to get the file' });
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

// POST /api/studio/orders/admin — admin adds an order by hand (phone call, WhatsApp, in the shop).
// Not linked to a customer account; no emails are sent.
router.post('/orders/admin', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const name = str(b.customer?.name, 80);
    const phone = str(b.customer?.phone, 30);
    if (!name || !/^[+\d\s()-]{6,30}$/.test(phone))
      return res.status(400).json({ error: 'الاسم ورقم الهاتف مطلوبان' });
    const rawLocation = str(b.customer?.location, 600);
    const location = rawLocation ? normalizeMapLink(rawLocation) : null;
    if (rawLocation && !location)
      return res.status(400).json({ error: 'رابط الموقع غير صالح — الصق رابطاً من Google Maps أو Apple Maps' });
    const toolId = str(b.toolId, 60) || 'manual';
    const params = b.params && typeof b.params === 'object' && !Array.isArray(b.params) ? b.params : {};
    if (JSON.stringify(params).length > 800_000) return res.status(413).json({ error: 'التصميم كبير جداً' });
    const status = STATUSES.includes(b.status) ? b.status : 'new';
    const price = num(b.price);

    const d = new Date();
    const id = `ST-${d.toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const row = {
      id,
      user_id: null,
      status,
      tool_id: toolId,
      tool_name: str(b.toolName, 80) || null,
      params: { ...params, manual: true },
      customer_name: name,
      customer_phone: phone,
      customer_address: str(b.customer?.address, 300) || null,
      customer_location: location,
      qty: Math.min(500, Math.max(1, parseInt(b.qty, 10) || 1)),
      notes: str(b.notes, 1000),
      estimate: price != null && price >= 0 ? { grams: null, minutes: null, price, currency: str(b.currency, 8) || 'USD' } : null,
    };
    const { data, error } = await supabaseAdmin.from(TABLE).insert(row).select('*').single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('studio admin order error:', err.message);
    res.status(500).json({ error: 'تعذّر حفظ الطلب' });
  }
});

// POST /api/studio/orders/admin/:id/notify-ready — admin: email the customer that the order is ready
// (only orders placed from a customer account have an email; WhatsApp is opened from the admin's browser)
router.post('/orders/admin/:id/notify-ready', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!validId(id)) return res.status(400).json({ error: 'Bad order id' });
    const { data: o, error } = await supabaseAdmin.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!o) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!o.user_id) return res.status(400).json({ error: 'هالطلب مش مربوط بحساب، فما في إيميل' });
    const { data: u, error: e2 } = await supabaseAdmin.auth.admin.getUserById(o.user_id);
    if (e2) throw e2;
    const email = u?.user?.email;
    if (!email) return res.status(400).json({ error: 'ما في إيميل لهالزبون' });
    const ok = await readyStudioOrder({ ...o, email }, str(req.body?.message, 1000));
    if (!ok) return res.status(502).json({ error: 'ما انبعت الإيميل، جرّب كمان شوي' });
    res.json({ ok: true, email });
  } catch (err) {
    console.error('studio ready email error:', err.message);
    res.status(500).json({ error: 'تعذّر إرسال الإيميل' });
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
    const b = req.body || {};
    const patch = {};
    // only the fields that were sent change
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
      patch.status = b.status;
    }
    if (b.customer) {
      const c = b.customer;
      if (c.name !== undefined) {
        const name = str(c.name, 80);
        if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
        patch.customer_name = name;
      }
      if (c.phone !== undefined) {
        const phone = str(c.phone, 30);
        if (!/^[+\d\s()-]{6,30}$/.test(phone)) return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
        patch.customer_phone = phone;
      }
      if (c.address !== undefined) patch.customer_address = str(c.address, 300) || null;
      if (c.location !== undefined) {
        const raw = str(c.location, 600);
        const loc = raw ? normalizeMapLink(raw) : null;
        if (raw && !loc) return res.status(400).json({ error: 'رابط الموقع غير صالح — الصق رابطاً من Google Maps أو Apple Maps' });
        patch.customer_location = loc;
      }
    }
    if (b.qty !== undefined) patch.qty = Math.min(500, Math.max(1, parseInt(b.qty, 10) || 1));
    if (b.notes !== undefined) patch.notes = str(b.notes, 1000);
    if (b.toolId !== undefined) patch.tool_id = str(b.toolId, 60) || 'manual';
    if (b.toolName !== undefined) patch.tool_name = str(b.toolName, 80) || null;

    // price and the "what" line live inside JSON columns: merge with what is there
    if (b.price !== undefined || b.what !== undefined) {
      const { data: cur, error: e0 } = await supabaseAdmin.from(TABLE).select('estimate, params').eq('id', req.params.id).maybeSingle();
      if (e0) throw e0;
      if (!cur) return res.status(404).json({ error: 'Order not found' });
      if (b.price !== undefined) {
        const price = b.price === null || b.price === '' ? null : num(b.price);
        const est = cur.estimate || {};
        patch.estimate = price == null ? (est.grams || est.minutes ? { ...est, price: null } : null) : { ...est, price, currency: est.currency || 'USD' };
      }
      if (b.what !== undefined) {
        const what = str(b.what, 200);
        const params = { ...(cur.params || {}) };
        if (what) params.what = what; else delete params.what;
        patch.params = params;
      }
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .update(patch)
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

// DELETE /api/studio/orders/admin/:id — admin: remove an order for good, with its files
router.delete('/orders/admin/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!validId(id)) return res.status(400).json({ error: 'Bad order id' });
    // files first (attachments under orders/<id>/ and the mold file orders/<id>.3mf); a missing bucket is fine
    try {
      const { data: list } = await supabaseAdmin.storage.from(FILES_BUCKET).list(`orders/${id}`, { limit: 1000 });
      const paths = (list || []).filter((f) => f.name).map((f) => `orders/${id}/${f.name}`);
      paths.push(fileKey(id));
      await supabaseAdmin.storage.from(FILES_BUCKET).remove(paths);
    } catch (e) {
      console.warn('studio order delete: files', e.message);
    }
    const { data, error } = await supabaseAdmin.from(TABLE).delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Order not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('studio order delete error:', err.message);
    res.status(500).json({ error: 'تعذّر حذف الطلب' });
  }
});

export default router;
