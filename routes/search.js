// POST /api/search/image  { image: "data:image/jpeg;base64,..." }  →  { results: [{ id, score }] }
// GET  /api/search/status                                            (admin) how many photos are indexed
// POST /api/search/reindex                                           (admin) index new photos now
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { clientIp } from '../middleware/human.js';
import { searchByImage, imageSearchEnabled, imageSearchStatus, indexMissing } from '../services/imageSearch.js';

const router = express.Router();

// at most 20 photo searches per visitor every 10 minutes
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 20;
}

router.post('/image', async (req, res) => {
  if (!imageSearchEnabled()) return res.status(503).json({ error: 'Photo search is turned off' });
  if (tooMany(clientIp(req))) return res.status(429).json({ error: 'Too many photo searches — try again in a few minutes' });
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
  if (!m) return res.status(400).json({ error: 'Send a JPEG, PNG or WebP photo' });
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'Photo is too big' });
  try {
    const results = await searchByImage(buffer, 20);
    res.json({ results });
  } catch (err) {
    console.error('[image-search]', err);
    res.status(500).json({ error: 'Photo search failed' });
  }
});

router.get('/status', authMiddleware, requireAdmin, async (req, res) => {
  res.json(await imageSearchStatus());
});

router.post('/reindex', authMiddleware, requireAdmin, async (req, res) => {
  indexMissing(); // runs in the background
  res.json({ started: true });
});

export default router;
