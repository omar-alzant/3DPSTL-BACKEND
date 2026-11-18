// src/routes/credits.js — 3DSTL Studio credits: packages, top-up requests (Whish / Neo), spending on downloads
import express from 'express';
import crypto from 'node:crypto';
import { authMiddleware } from '../middleware/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { loadSettings } from './studio.js';
import { notifyCreditRequest } from '../services/notify.js';

const router = express.Router();
const METHODS = ['whish', 'neo'];
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function isAdmin(userId) {
  const { data } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', userId).maybeSingle();
  return !!data?.is_admin;
}

async function requireAdmin(req, res, next) {
  try {
    if (!(await isAdmin(req.id))) return res.status(403).json({ error: 'Admin access only' });
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify admin status' });
  }
}

async function balanceOf(userId) {
  const { data, error } = await supabaseAdmin.from('credit_balances').select('balance').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data?.balance || 0;
}

/** كلفة تنزيل ملف من أداة: قيمة الأداة، وإلا القيمة الافتراضية */
export function toolCredits(settings, toolId) {
  const v = settings?.tools?.[toolId]?.credits;
  if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) return Math.max(0, Math.round(Number(v)));
  return Math.max(0, Math.round(Number(settings?.creditsPerDownload) || 0));
}

// Simple in-memory limit per user
const hits = new Map();
const limit = (max, windowMs) => (req, res, next) => {
  const key = `${req.path}|${req.id || req.ip}`;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) return res.status(429).json({ error: 'طلبات كثيرة، حاول لاحقاً' });
  list.push(now);
  hits.set(key, list);
  next();
};

// ---------------- Public ----------------

// GET /api/credits/packages — active packages + payment details
router.get('/packages', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('credit_packages')
      .select('id, name, credits, price, currency')
      .eq('active', true)
      .order('sort')
      .order('price');
    if (error) throw error;
    const s = await loadSettings();
    res.json({ packages: data, payment: s.payment || {} });
  } catch (err) {
    console.error('credit packages error:', err.message);
    res.status(500).json({ error: 'تعذّر تحميل الباقات' });
  }
});

// ---------------- Customer ----------------

// GET /api/credits/me — balance, recent movements and top-up requests
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [admin, balance, ledger, requests] = await Promise.all([
      isAdmin(req.id),
      balanceOf(req.id),
      supabaseAdmin.from('credit_ledger').select('id, delta, balance_after, kind, tool_id, ref, note, created_at')
        .eq('user_id', req.id).order('created_at', { ascending: false }).limit(30),
      supabaseAdmin.from('credit_requests').select('id, credits, price, currency, method, reference, status, admin_note, created_at, decided_at')
        .eq('user_id', req.id).order('created_at', { ascending: false }).limit(20),
    ]);
    if (ledger.error) throw ledger.error;
    if (requests.error) throw requests.error;
    res.json({ balance, isAdmin: admin, ledger: ledger.data, requests: requests.data });
  } catch (err) {
    console.error('credits me error:', err.message);
    res.status(500).json({ error: 'تعذّر تحميل رصيدك' });
  }
});

// POST /api/credits/requests — "I paid via Whish/Neo, here is the transaction number"
router.post('/requests', authMiddleware, limit(5, 10 * 60e3), async (req, res) => {
  try {
    const b = req.body || {};
    const method = str(b.method, 10);
    const reference = str(b.reference, 80);
    const sender = str(b.sender, 80);
    if (!METHODS.includes(method)) return res.status(400).json({ error: 'اختر طريقة الدفع' });
    if (reference.length < 3) return res.status(400).json({ error: 'اكتب رقم العملية' });

    const { data: pkg, error: pe } = await supabaseAdmin
      .from('credit_packages').select('*').eq('id', Number(b.packageId)).eq('active', true).maybeSingle();
    if (pe) throw pe;
    if (!pkg) return res.status(400).json({ error: 'الباقة غير موجودة' });

    const { count } = await supabaseAdmin
      .from('credit_requests').select('id', { count: 'exact', head: true })
      .eq('user_id', req.id).eq('status', 'pending');
    if ((count || 0) >= 3) return res.status(429).json({ error: 'لديك 3 طلبات بانتظار المراجعة — انتظر الموافقة عليها أولاً' });

    // نفس رقم العملية لا يُستعمل مرتين
    const { data: dup } = await supabaseAdmin
      .from('credit_requests').select('id').eq('method', method).ilike('reference', reference).neq('status', 'rejected').limit(1);
    if (dup?.length) return res.status(409).json({ error: 'رقم العملية هذا مستعمل في طلب سابق' });

    const d = new Date();
    const id = `CR-${d.toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const row = {
      id, user_id: req.id, package_id: pkg.id, credits: pkg.credits, price: pkg.price, currency: pkg.currency,
      method, reference, sender,
    };
    const { error } = await supabaseAdmin.from('credit_requests').insert(row);
    if (error) throw error;

    // إيميل للمحل حتى يراجع التحويل
    supabaseAdmin.from('profiles').select('full_name').eq('id', req.id).maybeSingle()
      .then(({ data }) => notifyCreditRequest({ ...row, email: req.email, full_name: data?.full_name }))
      .catch(() => {});
    res.status(201).json({ id });
  } catch (err) {
    console.error('credit request error:', err.message);
    res.status(500).json({ error: 'تعذّر إرسال الطلب' });
  }
});

// POST /api/credits/spend — before downloading a Studio file.
// Body: { toolId, hash, params, toolName, label, downloadId? }
// - admin: free
// - a design this customer already paid for (same hash, or reopened from "My files"): free, forever
// - otherwise the tool's credits are deducted and the design is saved to "My files"
const shrink = (params) => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  if (JSON.stringify(params).length <= 800_000) return params;
  // صورة كبيرة جداً: نحفظ الإعدادات بدونها
  return Object.fromEntries(Object.entries(params).filter(([, v]) => !(typeof v === 'string' && v.startsWith('data:'))));
};

router.post('/spend', authMiddleware, limit(60, 10 * 60e3), async (req, res) => {
  try {
    const b = req.body || {};
    const toolId = str(b.toolId, 60);
    const hash = str(b.hash, 128);
    if (!toolId || !/^[a-f0-9]{16,128}$/.test(hash)) return res.status(400).json({ error: 'طلب غير صالح' });

    if (await isAdmin(req.id)) return res.json({ ok: true, charged: 0, admin: true });

    const now = new Date().toISOString();
    const dry = b.dry === true; // فحص فقط: هل دُفع سابقاً؟ وكم الكلفة؟
    // أعاد فتح ملف من «ملفاتي»
    const reopenId = Number(b.downloadId) || 0;
    if (reopenId) {
      const { data: own } = await supabaseAdmin.from('credit_downloads').select('id')
        .eq('id', reopenId).eq('user_id', req.id).eq('tool_id', toolId).maybeSingle();
      if (own) {
        if (!dry) await supabaseAdmin.from('credit_downloads').update({ last_at: now }).eq('id', own.id);
        return res.json({ ok: true, charged: 0, already: true, balance: await balanceOf(req.id) });
      }
    }
    const { data: prev } = await supabaseAdmin.from('credit_downloads').select('id')
      .eq('user_id', req.id).eq('design_hash', hash).maybeSingle();
    if (prev) {
      if (!dry) await supabaseAdmin.from('credit_downloads').update({ last_at: now }).eq('id', prev.id);
      return res.json({ ok: true, charged: 0, already: true, balance: await balanceOf(req.id) });
    }

    const settings = await loadSettings();
    const cost = toolCredits(settings, toolId);
    if (dry) return res.json({ ok: true, dry: true, cost, balance: await balanceOf(req.id) });
    let balance;
    if (cost > 0) {
      const { data, error } = await supabaseAdmin.rpc('credit_apply', {
        p_user: req.id, p_delta: -cost, p_kind: 'download', p_tool: toolId, p_hash: hash,
      });
      if (error) {
        if (/insufficient_credits/.test(error.message))
          return res.status(402).json({ error: 'رصيدك لا يكفي', cost, balance: await balanceOf(req.id) });
        throw error;
      }
      balance = data;
    } else balance = await balanceOf(req.id);

    const { error: se } = await supabaseAdmin.from('credit_downloads').upsert({
      user_id: req.id, tool_id: toolId, tool_name: str(b.toolName, 80) || null, label: str(b.label, 80) || null,
      design_hash: hash, params: shrink(b.params), charged: cost, last_at: now,
    }, { onConflict: 'user_id,design_hash' });
    if (se) console.error('save download error:', se.message);

    res.json({ ok: true, charged: cost, balance });
  } catch (err) {
    console.error('credit spend error:', err.message);
    res.status(500).json({ error: 'تعذّر خصم الكريدت، حاول مجدداً' });
  }
});

// GET /api/credits/downloads?page=1 — "My files"
router.get('/downloads', authMiddleware, async (req, res) => {
  try {
    const size = 20;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const { data, count, error } = await supabaseAdmin.from('credit_downloads')
      .select('id, tool_id, tool_name, label, charged, created_at, last_at', { count: 'exact' })
      .eq('user_id', req.id).order('last_at', { ascending: false })
      .range((page - 1) * size, page * size - 1);
    if (error) throw error;
    res.json({ items: data, total: count || 0, page, pages: Math.max(1, Math.ceil((count || 0) / size)) });
  } catch (err) {
    res.status(500).json({ error: 'تعذّر تحميل ملفاتك' });
  }
});

// GET /api/credits/downloads/:id — the saved design, to reopen it in the Studio
router.get('/downloads/:id', authMiddleware, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('credit_downloads')
    .select('id, tool_id, params').eq('id', Number(req.params.id)).eq('user_id', req.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'الملف غير موجود' });
  res.json(data);
});

// ---------------- Admin ----------------

const withEmails = async (rows) => {
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  if (!ids.length) return rows;
  const { data } = await supabaseAdmin.from('profiles').select('id, email, full_name').in('id', ids);
  const map = Object.fromEntries((data || []).map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, email: map[r.user_id]?.email, full_name: map[r.user_id]?.full_name }));
};

// GET /api/credits/admin/requests?status=pending|approved|rejected|all
router.get('/admin/requests', authMiddleware, requireAdmin, async (req, res) => {
  try {
    let q = supabaseAdmin.from('credit_requests').select('*').order('created_at', { ascending: false }).limit(200);
    const st = str(req.query.status, 12);
    if (st && st !== 'all') q = q.eq('status', st);
    const { data, error } = await q;
    if (error) throw error;
    res.json(await withEmails(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/requests/:id/approve', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('credit_approve', {
      p_id: req.params.id, p_by: req.id, p_note: str(req.body?.note, 300) || null,
    });
    if (error) {
      if (/not_pending/.test(error.message)) return res.status(409).json({ error: 'Request already handled' });
      if (/not_found/.test(error.message)) return res.status(404).json({ error: 'Request not found' });
      throw error;
    }
    res.json({ ok: true, balance: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/requests/:id/reject', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('credit_requests')
      .update({ status: 'rejected', admin_note: str(req.body?.note, 300) || null, decided_at: new Date().toISOString(), decided_by: req.id })
      .eq('id', req.params.id).eq('status', 'pending').select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'Request already handled' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Packages
router.get('/admin/packages', authMiddleware, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('credit_packages').select('*').order('sort').order('price');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const cleanPackage = (b = {}) => {
  const credits = parseInt(b.credits, 10);
  const price = Number(b.price);
  if (!(credits > 0 && credits <= 10_000_000)) return { error: 'Credits must be a positive number' };
  if (!(price >= 0 && price <= 100000)) return { error: 'Price must be a positive number' };
  return {
    value: {
      name: str(b.name, 60) || null,
      credits,
      price: Math.round(price * 100) / 100,
      currency: str(b.currency, 8).toUpperCase() || 'USD',
      active: b.active !== false,
      sort: parseInt(b.sort, 10) || 0,
    },
  };
};

router.post('/admin/packages', authMiddleware, requireAdmin, async (req, res) => {
  const { value, error: bad } = cleanPackage(req.body);
  if (bad) return res.status(400).json({ error: bad });
  const { data, error } = await supabaseAdmin.from('credit_packages').insert(value).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/admin/packages/:id', authMiddleware, requireAdmin, async (req, res) => {
  const { value, error: bad } = cleanPackage(req.body);
  if (bad) return res.status(400).json({ error: bad });
  const { data, error } = await supabaseAdmin.from('credit_packages').update(value).eq('id', Number(req.params.id)).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Package not found' });
  res.json(data);
});

router.delete('/admin/packages/:id', authMiddleware, requireAdmin, async (req, res) => {
  // الطلبات القديمة تبقى (package_id → null)
  const { error } = await supabaseAdmin.from('credit_packages').delete().eq('id', Number(req.params.id));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Users: search by email/name, with balances
router.get('/admin/users', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const q = str(req.query.q, 80).replace(/[%,()]/g, '');
    let query = supabaseAdmin.from('profiles').select('id, email, full_name, is_admin').limit(30);
    if (q) query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);
    else {
      // بدون بحث: أصحاب الأرصدة الأعلى
      const { data: top } = await supabaseAdmin.from('credit_balances').select('user_id').order('balance', { ascending: false }).limit(30);
      const ids = (top || []).map((t) => t.user_id);
      if (!ids.length) return res.json([]);
      query = query.in('id', ids);
    }
    const { data: users, error } = await query;
    if (error) throw error;
    const { data: bal } = await supabaseAdmin.from('credit_balances').select('user_id, balance').in('user_id', users.map((u) => u.id));
    const map = Object.fromEntries((bal || []).map((b) => [b.user_id, b.balance]));
    res.json(users.map((u) => ({ ...u, balance: map[u.id] || 0 })).sort((a, b) => b.balance - a.balance));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/users/:id/ledger', authMiddleware, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('credit_ledger').select('*').eq('user_id', req.params.id).order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Manual adjustment (cash, gift, refund...). Body: { userId, delta, note }
router.post('/admin/adjust', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const delta = parseInt(req.body?.delta, 10);
    const userId = str(req.body?.userId, 60);
    if (!userId || !delta || Math.abs(delta) > 10_000_000) return res.status(400).json({ error: 'Invalid amount' });
    const { data, error } = await supabaseAdmin.rpc('credit_apply', {
      p_user: userId, p_delta: delta, p_kind: 'admin',
      p_note: str(req.body?.note, 300) || null, p_by: req.id,
    });
    if (error) {
      if (/insufficient_credits/.test(error.message)) return res.status(400).json({ error: 'Balance cannot go below zero' });
      throw error;
    }
    res.json({ ok: true, balance: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
