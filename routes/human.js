// POST /api/human/verify  { token }  →  { pass, exp }
import express from 'express';
import { verifyTurnstile, issuePass, humanEnabled, clientIp } from '../middleware/human.js';

const router = express.Router();

// حدّ بسيط للمحاولات لكل IP (ضد إغراق نقطة التحقق نفسها)
const hits = new Map();
const LIMIT = 20, WINDOW = 10 * 60 * 1000;
function limited(ip) {
  const now = Date.now();
  const h = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  h.push(now);
  hits.set(ip, h);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW)) hits.delete(k);
  return h.length > LIMIT;
}

router.get('/status', (_req, res) => res.json({ enabled: humanEnabled() }));

router.post('/verify', async (req, res) => {
  if (!humanEnabled()) return res.json(issuePass());
  const ip = clientIp(req);
  if (limited(ip)) return res.status(429).json({ error: 'too_many_attempts', message: 'محاولات كثيرة، حاول بعد قليل' });
  try {
    const result = await verifyTurnstile(req.body?.token, ip);
    if (!result.success) return res.status(403).json({ error: 'verification_failed', codes: result['error-codes'] || [] });
    return res.json(issuePass());
  } catch (e) {
    console.error('turnstile verify error', e);
    return res.status(502).json({ error: 'verification_unavailable' });
  }
});

export default router;
